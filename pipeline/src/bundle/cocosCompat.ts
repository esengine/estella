// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Scripts written for Cocos Creator build against the engine, in every bundle a project's scripts go into.
 *
 * Two things a Cocos script assumes that a plain bundle does not give it:
 *
 *   - `import { Component } from 'cc'` (and `'cc/env'` for its build flags). Both name the compatibility layer, `esengine/cocos`.
 *     The import is handed back to the bundler as that specifier, so it resolves however the build resolves `esengine/*`:
 *     left external for the page's import map, or aliased and inlined.
 *   - Legacy (`experimentalDecorators`) decorators, with fields assigned by the constructor rather than defined. Cocos scripts are
 *     written for that, the layer's `@ccclass` / `@property` have that signature, and esbuild's default for a file whose nearest
 *     tsconfig says nothing is the newer standard form, under which every decorator in the project would run with the wrong
 *     arguments. A Cocos project's own tsconfig usually extends a file the editor generates and the checkout lacks, so it cannot
 *     be relied on to say it.
 *
 * A package's file by its path (`long/umd/index.js`) even where the package's `exports` map does not list it: Cocos resolves
 * files the way node did before `exports`, and the generated protobuf code of a project asks for exactly that.
 *
 * A third, smaller one: Cocos compiles scripts that esbuild refuses. A `const` that is assigned to later is a TypeScript error Cocos
 * builds through (its output is `var`, where the assignment simply works), and esbuild stops the whole bundle on it. Such a
 * declaration is read as `let`, which is what the script meant.
 *
 * Only files that import `cc` are touched: a script that does not is not a Cocos script, and keeps whatever its own tsconfig says.
 * The project's files are read, never written.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { loadEsbuild } from './esbuildRuntime';

/** What `cc` and `cc/env` resolve to. */
export const COCOS_LAYER = 'esengine/cocos';

const CC = /^cc(\/env)?$/;
const IMPORTS_CC = /(?:from|import)\s*\(?\s*['"]cc(?:\/env)?['"]/;
const TS = /\.tsx?$/;

const RESOLVING = Symbol('cocos-compat:resolving');
const PACKAGE_FILE = /^(?:@[^/]+\/[^/]+|[^@./][^/]*)\/.+/;

/** `<dir>/node_modules/<specifier>` for the nearest dir upward that has it, as a file. */
function packageFileFrom(dir: string, specifier: string): string | undefined {
  for (let d = dir; ; d = path.dirname(d)) {
    const candidate = path.join(d, 'node_modules', specifier);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    if (path.dirname(d) === d) return undefined;
  }
}

const CONST_DECL = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=/g;
/** An assignment statement: the name at the start of a statement, then `=` that is not `==` or `=>`, or a compound operator. */
const ASSIGNMENT = /(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])/g;

const NAMED_CC_IMPORT = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])(cc(?:\/env)?)\2\s*;?/gm;

/**
 * `import { A, B as C } from 'cc'` as a read of the layer's namespace. The layer provides part of the Creator API, and Cocos hands a
 * script the rest as `undefined` where a bundler would stop at the first name that is not exported. A name the layer lacks is
 * `undefined` here too, and the script finds out only if it gets as far as using it.
 */
export function readNamedImportsThroughNamespace(source: string): string {
  let n = 0;
  const reads: string[] = [];
  const rest = source.replace(NAMED_CC_IMPORT, (all, list: string, quote: string, from: string) => {
    const bindings = list.split(',').map((x) => x.trim()).filter((x) => x && !/^type\s/.test(x))
      .map((x) => { const [name, alias] = x.split(/\s+as\s+/); return { name: name!.trim(), local: (alias ?? name)!.trim() }; });
    if (bindings.length > 0) {
      const ns = '__cc' + n++;
      // a name the layer lacks is a stand-in that survives being used, so a script that reaches into it while its module loads does not stop the rest
      const each = bindings.map((b) => b.local + ' = ' + ns + '.' + b.name + ' ?? ' + ns + '.unsupported(' + JSON.stringify(b.name) + ')').join(', ');
      reads.push('import * as ' + ns + ' from ' + quote + from + quote + '; const ' + each + ';');
    }
    // the statement leaves its lines behind, so what follows keeps its line numbers
    return all.replace(/[^\n]/g, '');
  });
  // an import is hoisted: a script may use a name above the line that imports it, so the bindings go first, on the first line
  return reads.length > 0 ? reads.join(' ') + ' ' + rest : rest;
}

/**
 * The source with every `const` that the script assigns to again read as `let`; the source itself when there is none. Two passes over the text, not
 * one per declaration: a project's scripts are thousands of files, and this runs on every build, on the editor's main thread.
 */
export function letTheReassignedConsts(source: string): string {
  if (!source.includes('const ')) return source;
  const assigned = new Set<string>();
  for (const m of source.matchAll(ASSIGNMENT)) assigned.add(m[1]!);
  if (assigned.size === 0) return source;
  // a name assigned anywhere makes every const of that name a let: harmless where the assignment was to another variable of the same name
  return source.replace(CONST_DECL, (all: string, name: string) => (assigned.has(name) ? all.replace('const', 'let') : all));
}

export function cocosCompatPlugin(): Plugin {
  return {
    name: 'estella-cocos-compat',
    setup(build) {
      build.onResolve({ filter: CC }, async (args) => {
        if (args.pluginData === RESOLVING) return undefined;
        const layer = await build.resolve(COCOS_LAYER, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: RESOLVING,
        });
        if (layer.errors.length > 0) {
          return { errors: [{ text: `"${args.path}" is the Cocos Creator module, which the engine provides as "${COCOS_LAYER}" — and that did not resolve here: ${layer.errors[0]!.text}` }] };
        }
        return { path: layer.path, external: layer.external, sideEffects: layer.sideEffects };
      });

      // `preview-template/` is the page the Creator editor's preview serves, Node code included; a build never ships it, so what a script
      // reaches for there is nothing.
      build.onResolve({ filter: /(^|\/)preview-template\// }, (args) => ({ path: args.path, namespace: 'cocos-preview-only' }));
      build.onLoad({ filter: /.*/, namespace: 'cocos-preview-only' }, () => ({ contents: 'export {};', loader: 'js' }));

      // Only a path the bundler could not resolve itself falls back to the plain file lookup.
      build.onResolve({ filter: PACKAGE_FILE }, async (args) => {
        if (args.pluginData === RESOLVING || args.kind === 'entry-point') return undefined;
        const tried = await build.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: RESOLVING });
        if (tried.errors.length === 0) return tried;
        const file = packageFileFrom(args.resolveDir, args.path);
        return file ? { path: file } : undefined;
      });

      build.onLoad({ filter: TS }, async (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        let source: string;
        try {
          source = await readFile(args.path, 'utf8');
        } catch {
          return undefined;
        }
        if (!IMPORTS_CC.test(source)) {
          const fixed = letTheReassignedConsts(source);
          return fixed === source ? undefined : { contents: fixed, loader: args.path.endsWith('x') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
        }
        source = readNamedImportsThroughNamespace(letTheReassignedConsts(source));
        const esbuild = await loadEsbuild();
        const out = await esbuild.transform(source, {
          loader: args.path.endsWith('x') ? 'tsx' : 'ts',
          sourcefile: args.path,
          sourcemap: 'inline',
          target: 'es2020',
          tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
        });
        return { contents: out.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}
