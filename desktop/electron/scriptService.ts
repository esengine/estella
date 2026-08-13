// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  scriptService.ts — the open project's TypeScript language service.
 *
 * A project's scripts are TypeScript and the SDK ships `.d.ts`, so the compiler
 * already knows what an author can only guess at: whether this file compiles,
 * what `Res(Input)` hands you, which overload `screenToWorld` has. Nothing was
 * asking it. An agent writing a system had one way to check its work — enter
 * play and read the log — and one way to learn an API: page a 50k-line `.d.ts`
 * a hundred lines at a time.
 *
 * TypeScript's own LanguageService, not an LSP server subprocess: the consumers
 * here are tool calls that want three answers (diagnostics, what is this symbol,
 * where is this text), and LSP would add a process, a protocol and a document
 * sync layer to wrap the very API tsserver itself is built on.
 *
 * Files are read from disk and versioned by mtime, which is the whole of the
 * sync story because every write in this editor lands on disk first.
 */
import ts from 'typescript';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** One diagnostic, in the shape a caller can act on without a compiler in hand. */
export interface ScriptDiagnostic {
  file: string;
  line: number;
  column: number;
  code: number;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  message: string;
}

/** What the compiler knows about a name, for someone who cannot read the .d.ts. */
/** A name and what kind of thing it is — the answer to "what is there", which
 *  comes before "what is this one". */
export interface SymbolBrief {
  name: string;
  kind: string;
  file: string;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  /** The declaration's own text — the signature, as TypeScript renders it. */
  signature: string;
  /** Its doc comment, if it carries one. */
  doc?: string;
  file: string;
  line: number;
}

const SCRIPT_EXT = /\.(ts|tsx|mts|cts)$/;

/**
 * The compiler options a project gets when it has no tsconfig of its own. The
 * `esengine` path mirrors what `ensureSdkTypes` stages, so a scratch project
 * still resolves the SDK rather than reporting every import as missing — a
 * service that answers "cannot find module 'esengine'" 40 times is worse than
 * no service at all.
 */
const fallbackOptions = (root: string): ts.CompilerOptions => ({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: false,
  // Absolute, and no baseUrl: TypeScript 6 deprecates baseUrl, and a relative
  // path in `paths` resolves against the tsconfig that declared it — which is
  // exactly what a project WITHOUT one does not have.
  paths: {
    esengine: [path.join(root, '.esengine', 'sdk', 'index.d.ts')],
    'esengine/*': [path.join(root, '.esengine', 'sdk', '*')],
  },
});

/**
 * The staged SDK types, which belong in the compilation whether or not a project
 * file happens to import them yet.
 *
 * A fresh project's `src/main.ts` imports only `./components`, so nothing pulled
 * `esengine` in — and the moment someone most needs to ask what `Input` is (the
 * one before they have written the import) `lookup_symbol` answered with an
 * empty list. Naming them as roots costs one parse and makes the SDK askable
 * from the first turn.
 */
function sdkTypeRoots(root: string): string[] {
  const index = path.join(root, '.esengine', 'sdk', 'index.d.ts');
  return existsSync(index) ? [index] : [];
}

function loadConfig(root: string): { options: ts.CompilerOptions; fileNames: string[] } {
  const configPath = path.join(root, 'tsconfig.json');
  if (!existsSync(configPath)) {
    const src = path.join(root, 'src');
    const fileNames = existsSync(src)
      ? ts.sys.readDirectory(src, ['.ts', '.tsx'], undefined, undefined)
      : [];
    return { options: fallbackOptions(root), fileNames: [...fileNames, ...sdkTypeRoots(root)] };
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, root);
  // A project tsconfig is written for `tsc` runs, so it may name an outDir and
  // emit; the service only ever answers questions.
  return {
    options: { ...parsed.options, noEmit: true },
    fileNames: [...parsed.fileNames, ...sdkTypeRoots(root)],
  };
}

class ProjectScripts {
  private readonly service: ts.LanguageService;
  private readonly options: ts.CompilerOptions;
  private fileNames: string[];
  /** Bumped for a file whose mtime we cannot read (deleted, or mid-write). */
  private readonly versions = new Map<string, string>();

  constructor(readonly root: string) {
    const { options, fileNames } = loadConfig(root);
    this.options = options;
    this.fileNames = fileNames;

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => this.fileNames,
      getScriptVersion: (fileName) => {
        try {
          return String(statSync(fileName).mtimeMs);
        } catch {
          return this.versions.get(fileName) ?? '0';
        }
      },
      getScriptSnapshot: (fileName) => {
        try {
          return ts.ScriptSnapshot.fromString(readFileSync(fileName, 'utf8'));
        } catch {
          return undefined;
        }
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => this.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
    };
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  /** Re-read the file list: a script created since the service started is not in it. */
  rescan(): void {
    this.fileNames = loadConfig(this.root).fileNames;
  }

  private toDiagnostic(d: ts.Diagnostic): ScriptDiagnostic {
    const file = d.file ? path.relative(this.root, d.file.fileName) : '(project)';
    const pos = d.file && d.start !== undefined
      ? d.file.getLineAndCharacterOfPosition(d.start)
      : { line: 0, character: 0 };
    const category = d.category === ts.DiagnosticCategory.Error ? 'error'
      : d.category === ts.DiagnosticCategory.Warning ? 'warning'
        : d.category === ts.DiagnosticCategory.Suggestion ? 'suggestion' : 'message';
    return {
      file,
      line: pos.line + 1,
      column: pos.character + 1,
      code: d.code,
      category,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    };
  }

  /** Errors in one file, or across every script the project compiles. */
  diagnostics(relPath?: string): ScriptDiagnostic[] {
    this.rescan();
    const wanted = relPath
      ? [path.resolve(this.root, relPath)]
      : this.fileNames.filter((f) => SCRIPT_EXT.test(f) && !f.endsWith('.d.ts'));
    const out: ScriptDiagnostic[] = [];
    for (const file of wanted) {
      if (!existsSync(file)) continue;
      for (const d of [
        ...this.service.getSyntacticDiagnostics(file),
        ...this.service.getSemanticDiagnostics(file),
      ]) out.push(this.toDiagnostic(d));
    }
    return out;
  }

  /**
   * What the compiler knows about a name — the answer that used to cost a
   * hundred paged reads of the SDK's .d.ts.
   *
   * Exact-name matches first: someone asking for `Input` wants the class, not
   * the thirty things whose names contain it.
   */
  /**
   * The declaration as it is WRITTEN, from its line to the end of its body.
   *
   * quickInfo at a navigate-to hit degrades to the bare kind and name for
   * declared functions, interfaces and type aliases — `function defineComponent`,
   * `interface QueryBuilder` — which answers nothing and sends the asker back for
   * another round trip. The source text always says the whole thing.
   */
  private declarationText(source: ts.SourceFile, start: number): string {
    const text = source.getFullText();
    const from = text.lastIndexOf('\n', start) + 1;
    let depth = 0;
    let end = from;
    for (; end < text.length && end - from < 1200; end++) {
      const ch = text[end];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth <= 0) { end++; break; } }
      else if (ch === ';' && depth === 0) { end++; break; }
    }
    return text.slice(from, end).replace(/\s+/g, ' ').trim().slice(0, 800);
  }

  /** The innermost class/interface a position falls inside, if any. */
  private enclosingType(
    source: ts.SourceFile,
    start: number,
  ): ts.ClassDeclaration | ts.InterfaceDeclaration | undefined {
    let found: ts.ClassDeclaration | ts.InterfaceDeclaration | undefined;
    const visit = (node: ts.Node): void => {
      if (start < node.getStart(source) || start >= node.getEnd()) return;
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) found = node;
      node.forEachChild(visit);
    };
    source.forEachChild(visit);
    return found;
  }

  /**
   * A type rendered as WHAT YOU CAN CALL ON IT: its public members, signatures only.
   *
   * The declaration text is the wrong answer for a class, and silently so. Every
   * real class opens with its private state, so the first 800 characters of
   * `AudioAPI` are a dozen `private readonly` fields and a comment — the asker
   * learns nothing and cannot even tell they were cut off. The one question a
   * class is ever asked is which methods it has, and the members answer it in
   * less space than the fields wasted.
   */
  private memberSummary(source: ts.SourceFile, start: number): string | null {
    const node = this.enclosingType(source, start);
    if (!node?.name) return null;
    const hidden = (m: ts.ClassElement | ts.TypeElement): boolean => {
      const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : [];
      if (mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword
        || x.kind === ts.SyntaxKind.ProtectedKeyword)) return true;
      const name = m.name ? m.name.getText(source) : '';
      // `_id` / `world_` are the two spellings the engine uses for "not yours".
      return !name || name.startsWith('_') || name.endsWith('_');
    };
    const rendered: string[] = [];
    let dropped = 0;
    for (const m of node.members as ts.NodeArray<ts.ClassElement | ts.TypeElement>) {
      if (hidden(m)) continue;
      if (rendered.length >= 40) { dropped++; continue; }
      const body = (m as ts.MethodDeclaration).body;
      const text = body
        ? m.getText(source).slice(0, body.getStart(source) - m.getStart(source))
        : m.getText(source);
      rendered.push(text.replace(/\s+/g, ' ').trim().replace(/[;,]$/, ''));
    }
    if (!rendered.length) return null;
    const kind = ts.isClassDeclaration(node) ? 'class' : 'interface';
    const heritage = node.heritageClauses?.map((h) => h.getText(source).replace(/\s+/g, ' ')).join(' ');
    const head = `${kind} ${node.name.getText(source)}${heritage ? ` ${heritage}` : ''}`;
    const tail = dropped ? `; … ${dropped} more` : '';
    return `${head} { ${rendered.join('; ')}${tail} }`.slice(0, 2400);
  }

  /**
   * WHICH names exist, without rendering any of them. `lookup` answers what one
   * symbol is and costs a quickInfo per hit; this answers what there is to ask
   * about, which is the question you have when you do not know the name yet.
   */
  list(query: string, limit = 40): SymbolBrief[] {
    this.rescan();
    const items = this.service.getNavigateToItems(query, Math.min(limit * 4, 256), undefined, false, true);
    const seen = new Set<string>();
    const out: SymbolBrief[] = [];
    for (const item of items) {
      const key = `${item.name}:${item.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: item.name, kind: item.kind, file: path.relative(this.root, item.fileName) });
      if (out.length >= limit) break;
    }
    return out;
  }

  lookup(name: string, limit = 8): SymbolInfo[] {
    this.rescan();
    const items = this.service.getNavigateToItems(name, 64, undefined, false, true);
    const ranked = [...items].sort((a, b) => {
      const exact = (i: ts.NavigateToItem) => (i.name === name ? 0 : i.name.toLowerCase() === name.toLowerCase() ? 1 : 2);
      return exact(a) - exact(b) || a.name.length - b.name.length;
    });
    const out: SymbolInfo[] = [];
    for (const item of ranked.slice(0, limit)) {
      const info = this.service.getQuickInfoAtPosition(item.fileName, item.textSpan.start);
      const program = this.service.getProgram();
      const source = program?.getSourceFile(item.fileName);
      const line = source ? source.getLineAndCharacterOfPosition(item.textSpan.start).line + 1 : 0;
      const quick = info ? ts.displayPartsToString(info.displayParts) : '';
      // A quickInfo that names no parameters and no type is the degenerate form
      // ("function Query"); the source text is then the only real answer. Where it
      // IS complete it is better than raw source — it carries the owning type
      // ("(method) InputState.isMouseButtonPressed(button: number): boolean").
      const useQuick = quick.includes('(') || quick.includes(':');
      // A class or interface answers with its members, whatever quickInfo said:
      // for `AudioAPI` quickInfo is "class AudioAPI", and the declaration text
      // is its private fields.
      const members = source && (item.kind === 'class' || item.kind === 'interface')
        ? this.memberSummary(source, item.textSpan.start) : null;
      const declared = source ? this.declarationText(source, item.textSpan.start) : '';
      out.push({
        name: item.name,
        kind: item.kind,
        signature: members || (useQuick ? quick : declared) || quick || `${item.kind} ${item.name}`,
        doc: info?.documentation?.length ? ts.displayPartsToString(info.documentation) : undefined,
        file: path.relative(this.root, item.fileName),
        line,
      });
    }
    return out;
  }

  dispose(): void {
    this.service.dispose();
  }
}

let current: ProjectScripts | null = null;

/** Point the service at a project (idempotent for the one already open). */
export function adoptProjectScripts(root: string): void {
  if (current?.root === root) return;
  current?.dispose();
  current = null;
  // Built lazily: opening a project must not pay for a service nobody asked a
  // question of, and the first question pays for the SDK's .d.ts either way.
  pendingRoot = root;
}

let pendingRoot: string | null = null;

function service(): ProjectScripts {
  if (!current) {
    if (!pendingRoot) throw new Error('no project open — script diagnostics need one');
    current = new ProjectScripts(pendingRoot);
  }
  return current;
}

export function scriptDiagnostics(relPath?: string): ScriptDiagnostic[] {
  return service().diagnostics(relPath);
}

export function lookupScriptSymbol(name: string, limit?: number): SymbolInfo[] {
  return service().lookup(name, limit);
}

/** Which symbols exist whose name looks like `query` — see {@link ScriptService.list}. */
export function searchScriptSymbols(query: string, limit?: number): SymbolBrief[] {
  return service().list(query, limit);
}

/** Whether a path is something the service has an opinion about. */
export const isScriptPath = (relPath: string): boolean => SCRIPT_EXT.test(relPath);
