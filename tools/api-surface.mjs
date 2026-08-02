#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// =============================================================================
// API surface guard (1.0 governance)
//
// The SDK's public surface is a promise: every exported symbol's signature is
// snapshotted into sdk/etc/<entry>.api.md. Any surface change must ship with a
// regenerated snapshot, making API drift a reviewed diff instead of an
// accident. Release tags at the declaration are the single authority for
// stability: untagged = stable, @beta = experimental, @internal = must not be
// exported from a public entry (policy error).
//
// Run: node tools/api-surface.mjs --check     (CI: exit 1 on drift/violation)
//      node tools/api-surface.mjs --update    (accept surface changes)
//      node tools/api-surface.mjs --check-dts (built .d.ts still carries it)
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SDK = join(ROOT, 'sdk');
const ETC = join(SDK, 'etc');
const ts = createRequire(join(SDK, '/'))('typescript');

// Typed public entries (mirrors package.json "exports" + rollup dtsBuilds).
const ENTRIES = {
    'index': 'src/index.ts',
    'index.node': 'src/index.node.ts',
    'index.native': 'src/index.native.ts',
    'physics': 'src/physics/index.ts',
    'spine': 'src/spine/index.ts',
    'dragonbones': 'src/dragonbones/index.ts',
    'wasm': 'src/wasm.ts',
    'wechat': 'src/index.wechat.ts',
    'minigame': 'src/index.minigame.ts',
};

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--update' && mode !== '--check-dts') {
    console.error('usage: node tools/api-surface.mjs --check | --update | --check-dts');
    process.exit(2);
}

// `--check-dts` reads the same entries out of the BUILT declarations. The
// snapshot stays the one authority for what the surface is; this only asks
// whether the `.d.ts` a consumer installs still carries it, which is the one
// thing a source-only guard cannot see. It is a smaller claim than the snapshot
// makes — names, kinds and "it compiles" — because that is what survives being
// re-printed by a declaration bundler. Comparing rendered types across two
// programs compares their printers, not the API.
const fromDts = mode === '--check-dts';
const entryPaths = fromDts
    ? Object.fromEntries(Object.entries(ENTRIES)
        .map(([name, p]) => [name, p.replace(/^src\//, 'dist/').replace(/\.ts$/, '.d.ts')]))
    : ENTRIES;

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

const configPath = join(SDK, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, SDK);
const rootNames = Object.values(entryPaths).map((p) => join(SDK, p));
const absent = rootNames.filter((p) => !existsSync(p));
if (absent.length) {
    console.error('api-surface: the SDK is not built — run `pnpm --filter ./sdk build` first.');
    for (const p of absent) console.error(`  missing ${p.replace(SDK + '/', '')}`);
    process.exit(2);
}
// `rootDir` is src, and in --check-dts the roots live under dist; nothing is
// emitted here, so drop it rather than let TS reject the roots as out of scope.
// `skipLibCheck` has to go with it: it skips checking .d.ts files, which in this
// mode is every file we came to check — left on, a declaration referring to a
// type that did not survive the bundle passes silently.
const options = {
    ...parsed.options,
    noEmit: true,
    rootDir: undefined,
    ...(fromDts ? { skipLibCheck: false } : {}),
};
// typeToString relativizes import("...") type paths against the host cwd — pin
// it so the report is byte-identical no matter where the tool is invoked from.
const host = ts.createCompilerHost(options);
host.getCurrentDirectory = () => SDK;
const program = ts.createProgram({ rootNames, options, host });
const checker = program.getTypeChecker();

const FMT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

const errors = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Absolute source paths leak into typeToString via import("...") — strip them so the
 *  snapshot is machine-independent (a Windows `F:/…` and a Linux `/home/…` for the same
 *  symbol must not read as drift). First collapse our own SDK path to `~`, then drop the
 *  `import("<any path>").` qualifier entirely — the trailing type name is what identifies
 *  the symbol, and the path is environment noise. */
function normalizeType(text) {
    return text
        .split(SDK.replace(/\\/g, '/')).join('~')
        .replace(/import\((['"]).*?\1\)\./g, '');
}

const fileTagCache = new Map();

/** Release tag from a file's leading `@file` JSDoc header (module-wide fallback). */
function fileLevelTag(sourceFile) {
    if (fileTagCache.has(sourceFile.fileName)) return fileTagCache.get(sourceFile.fileName);
    let tag = null;
    const text = sourceFile.getFullText();
    for (const range of ts.getLeadingCommentRanges(text, 0) ?? []) {
        const comment = text.slice(range.pos, range.end);
        if (!comment.startsWith('/**')) continue;
        if (/^\s*\*\s*@beta\b/m.test(comment)) tag = 'beta';
        else if (/^\s*\*\s*@internal\b/m.test(comment)) tag = 'internal';
    }
    fileTagCache.set(sourceFile.fileName, tag);
    return tag;
}

/** Declaration-site tag wins; else the declaring file's header tag; else stable. */
function releaseTag(symbol) {
    for (const decl of symbol.declarations ?? []) {
        for (const tag of ts.getJSDocTags(decl)) {
            const name = tag.tagName.text;
            if (name === 'beta') return 'beta';
            if (name === 'internal') return 'internal';
            if (name === 'deprecated') return 'deprecated';
        }
    }
    for (const decl of symbol.declarations ?? []) {
        const tag = fileLevelTag(decl.getSourceFile());
        if (tag) return tag;
    }
    return 'stable';
}

/** A member inherited from an ambient built-in (the TS lib or @types/node) — e.g. an
 *  `extends Error` class's `message`/`stack`, or `captureStackTrace` on ErrorConstructor.
 *  Its declaration lives in node_modules, so it floats with the installed @types version
 *  (this is what drifted CI: a newer @types/node augments ErrorConstructor). It is not the
 *  SDK's authored surface, so drop it. An SDK-authored override keeps at least one
 *  declaration outside node_modules and therefore survives. */
function isAmbientMember(member) {
    const decls = member.declarations;
    if (!decls || decls.length === 0) return false;
    return decls.every((d) => d.getSourceFile().fileName.replace(/\\/g, '/').includes('/node_modules/'));
}

function isPrivateMember(member) {
    if (member.escapedName?.toString().startsWith('__')) return true;
    for (const decl of member.declarations ?? []) {
        if (decl.name && ts.isPrivateIdentifier(decl.name)) return true;
        const mods = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
        if (mods?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
            return true;
        }
    }
    return false;
}

function memberLines(type, location) {
    const lines = [];
    for (const sig of type.getCallSignatures()) {
        lines.push(`call ${normalizeType(checker.signatureToString(sig, location, FMT))}`);
    }
    for (const sig of type.getConstructSignatures()) {
        lines.push(`new ${normalizeType(checker.signatureToString(sig, location, FMT))}`);
    }
    for (const member of type.getProperties()) {
        if (isPrivateMember(member)) continue;
        if (isAmbientMember(member)) continue;
        const memberType = checker.getTypeOfSymbolAtLocation(member, location);
        lines.push(`${member.name}: ${normalizeType(checker.typeToString(memberType, location, FMT))}`);
    }
    return lines.sort();
}

function describeSymbol(name, symbol) {
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const decl = resolved.declarations?.[0];
    if (!decl) {
        errors.push(`R2: export '${name}' does not resolve to a declaration`);
        return null;
    }
    const tag = releaseTag(resolved);
    const flags = resolved.flags;
    const body = [];
    let kind = 'value';

    if (flags & ts.SymbolFlags.Class) {
        kind = 'class';
        const instance = checker.getDeclaredTypeOfSymbol(resolved);
        const statics = checker.getTypeOfSymbolAtLocation(resolved, decl);
        body.push(...memberLines(instance, decl));
        body.push(...memberLines(statics, decl).map((l) => `static ${l}`));
    } else if (flags & ts.SymbolFlags.Interface) {
        kind = 'interface';
        body.push(...memberLines(checker.getDeclaredTypeOfSymbol(resolved), decl));
    } else if (flags & ts.SymbolFlags.TypeAlias) {
        kind = 'type';
        const aliasDecl = resolved.declarations.find(ts.isTypeAliasDeclaration);
        body.push(normalizeType(aliasDecl ? aliasDecl.type.getText() : 'unknown'));
    } else if (flags & ts.SymbolFlags.Enum) {
        kind = 'enum';
        for (const m of resolved.exports?.values() ?? []) {
            const v = checker.getConstantValue?.(m.declarations?.[0]);
            body.push(`${m.name}${v !== undefined ? ` = ${JSON.stringify(v)}` : ''}`);
        }
        body.sort();
    } else if (flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable | ts.SymbolFlags.BlockScopedVariable)) {
        kind = flags & ts.SymbolFlags.Function ? 'function' : 'const';
        const type = checker.getTypeOfSymbolAtLocation(resolved, decl);
        const calls = type.getCallSignatures();
        if (calls.length > 0 && kind === 'function') {
            for (const sig of calls) body.push(normalizeType(checker.signatureToString(sig, decl, FMT)));
            body.sort();
        } else {
            body.push(normalizeType(checker.typeToString(type, decl, FMT)));
        }
    } else if (flags & (ts.SymbolFlags.NamespaceModule | ts.SymbolFlags.ValueModule)) {
        kind = 'namespace';
        for (const m of checker.getExportsOfModule(resolved)) body.push(m.name);
        body.sort();
    }
    return { name, kind, tag, body };
}

// ---------------------------------------------------------------------------
// Report generation + policy
// ---------------------------------------------------------------------------

function buildReport(entryName, entryPath) {
    const sourceFile = program.getSourceFile(join(SDK, entryPath));
    if (!sourceFile) throw new Error(`entry not found: ${entryPath}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) throw new Error(`no module symbol: ${entryPath}`);

    const exports = checker.getExportsOfModule(moduleSymbol)
        .filter((s) => !s.name.startsWith('__'))
        .sort((a, b) => (a.name < b.name ? -1 : 1));

    const out = [];
    out.push(`# API surface — esengine/${entryName}`);
    out.push('');
    out.push('<!-- Generated by tools/api-surface.mjs — do not edit. Run --update to accept changes. -->');
    out.push('');
    const counts = { stable: 0, beta: 0, deprecated: 0 };
    for (const symbol of exports) {
        const desc = describeSymbol(symbol.name, symbol);
        if (!desc) continue;
        if (desc.tag === 'internal') {
            errors.push(`R1: '${entryName}' exports @internal symbol '${symbol.name}'`);
            continue;
        }
        counts[desc.tag] = (counts[desc.tag] ?? 0) + 1;
        const tagSuffix = desc.tag === 'stable' ? '' : ` @${desc.tag}`;
        out.push(`## ${desc.name} — ${desc.kind}${tagSuffix}`);
        if (desc.body.length) {
            out.push('```');
            out.push(...desc.body);
            out.push('```');
        }
        out.push('');
    }
    out.splice(3, 0, `Symbols: ${counts.stable} stable · ${counts.beta} beta · ${counts.deprecated} deprecated`);
    // Multi-line declaration bodies are extracted verbatim from source text, so
    // on a CRLF checkout they carry \r — normalize so the snapshot (and the
    // drift compare below) is byte-identical across platforms.
    return (out.join('\n') + '\n').replace(/\r\n?/g, '\n');
}

if (fromDts) {
    let broken = 0;
    // Only our own output: with skipLibCheck off, the installed @types are fair
    // game for the checker too, and their errors are not ours to fix.
    const DIST = join(SDK, 'dist');
    const diagnostics = program.getSemanticDiagnostics().concat(program.getSyntacticDiagnostics())
        .filter((d) => d.file?.fileName.startsWith(DIST.replace(/\\/g, '/')));
    if (diagnostics.length) {
        broken++;
        console.error(`INVALID: the built .d.ts does not compile — ${diagnostics.length} error(s)`);
        for (const d of diagnostics.slice(0, 10)) {
            const where = d.file ? `${d.file.fileName.replace(SDK + '/', '')}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ` : '';
            console.error(`  ${where}${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
        }
    }

    for (const [entryName, entryPath] of Object.entries(entryPaths)) {
        const sourceFile = program.getSourceFile(join(SDK, entryPath));
        const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) {
            broken++;
            console.error(`INVALID: ${entryName} — ${entryPath} is not a module`);
            continue;
        }
        const emitted = new Map();
        for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
            if (symbol.name.startsWith('__')) continue;
            const desc = describeSymbol(symbol.name, symbol);
            if (desc) emitted.set(desc.name, desc.kind);
        }

        // The snapshot's headings are `## <name> — <kind>[ @tag]`; the tag comes
        // from a `@file` header as often as a declaration, and a header cannot
        // survive into a bundled .d.ts, so only name and kind are compared.
        const snapshot = readFileSync(join(ETC, `${entryName}.api.md`), 'utf8');
        const expected = new Map([...snapshot.matchAll(/^## (\S+) — (\S+)/gm)].map((m) => [m[1], m[2]]));

        const dropped = [...expected.keys()].filter((n) => !emitted.has(n));
        const extra = [...emitted.keys()].filter((n) => !expected.has(n));
        const rekinded = [...expected].filter(([n, k]) => emitted.has(n) && emitted.get(n) !== k);
        if (!dropped.length && !extra.length && !rekinded.length) continue;

        broken++;
        console.error(`DIVERGED: ${entryName} — the built .d.ts does not carry the documented surface.`);
        for (const n of dropped.slice(0, 15)) console.error(`  missing from .d.ts: ${n}`);
        for (const n of extra.slice(0, 15)) console.error(`  only in .d.ts:      ${n}`);
        for (const [n, k] of rekinded.slice(0, 15)) console.error(`  ${n}: ${k} became ${emitted.get(n)}`);
    }

    for (const e of errors) console.error(`POLICY ${e}`);
    if (broken || errors.length) {
        console.error('\napi-surface: the declaration build is not shipping the documented surface.');
        process.exit(1);
    }
    console.log(`api-surface: ${Object.keys(ENTRIES).length} entries — built .d.ts carries the documented surface.`);
    process.exit(0);
}

let drift = 0;
mkdirSync(ETC, { recursive: true });
for (const [entryName, entryPath] of Object.entries(entryPaths)) {
    const report = buildReport(entryName, entryPath);
    const file = join(ETC, `${entryName}.api.md`);
    if (mode === '--update') {
        writeFileSync(file, report);
        console.log(`wrote ${file}`);
    } else {
        const existing = existsSync(file)
            ? readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
            : '';
        if (existing !== report) {
            drift++;
            console.error(`DRIFT: ${entryName} — public API changed but sdk/etc/${entryName}.api.md was not updated.`);
            // Show WHICH lines drifted (set difference — order-independent, so it
            // survives insertions) so the guard is self-explanatory in CI logs.
            const was = new Set(existing.split('\n'));
            const now = new Set(report.split('\n'));
            const removed = [...was].filter((l) => !now.has(l) && l.trim());
            const added = [...now].filter((l) => !was.has(l) && l.trim());
            for (const l of removed.slice(0, 25)) console.error(`  - ${l}`);
            for (const l of added.slice(0, 25)) console.error(`  + ${l}`);
            if (removed.length > 25 || added.length > 25) {
                console.error(`  … (${removed.length} removed, ${added.length} added lines total)`);
            }
        }
    }
}

for (const e of errors) console.error(`POLICY ${e}`);
if (errors.length || drift) {
    console.error(`\napi-surface: ${errors.length} policy violation(s), ${drift} drifted snapshot(s).`);
    console.error('Fix violations, then: node tools/api-surface.mjs --update');
    process.exit(1);
}
console.log(`api-surface: ${Object.keys(ENTRIES).length} entries clean.`);
