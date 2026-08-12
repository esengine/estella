#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  api-surface.mjs — the SDK's public surface, snapshotted and governed.
 *
 * Every exported symbol's signature is snapshotted into sdk/etc/<entry>.api.md,
 * so a surface change is a reviewed diff rather than an accident.
 *
 * A declaration's release tag is the single authority for stability, and there
 * is no stable-by-default: an untagged symbol is @experimental, so freezing is
 * something a maintainer DOES rather than something they forget to prevent.
 *
 *   @public        frozen — 1.0 is expected not to break it
 *   @beta          may still adjust
 *   @experimental  no compatibility claim (the default)
 *   @internal      must not be exported from a public entry; on a MEMBER it is
 *                  allowed and marked, and carries no promise
 *
 *   --check          exit 1 on drift or policy violation
 *   --update         accept surface changes
 *   --check-dts      the built .d.ts still carries the documented surface
 *   --check-baseline the last release's @public promises still hold
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { ROOT, SDK, ETC, ts, ENTRIES, createSdkProgram, leadingDoc } from './lib/sdkProgram.mjs';
import { TIERS, parseSnapshot, baselineFindings } from './lib/apiSnapshot.mjs';

const MODES = ['--check', '--update', '--check-dts', '--check-baseline'];
const mode = process.argv[2];
if (!MODES.includes(mode)) {
    console.error(`usage: node tools/api-surface.mjs ${MODES.join(' | ')}`);
    process.exit(2);
}

const errors = [];

// ---------------------------------------------------------------------------
// Baseline — what the last release promised, and whether it still holds
// ---------------------------------------------------------------------------

/**
 * The snapshots as of the last release tag. Git rather than a committed copy:
 * the tag is already the authority for what shipped, and a second copy would
 * need its own guard to stay honest.
 */
function baselineSnapshots(ref) {
    const out = new Map();
    for (const entryName of Object.keys(ENTRIES)) {
        const spec = `${ref}:sdk/etc/${entryName}.api.md`;
        try {
            const text = execFileSync('git', ['show', spec], {
                cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
            });
            out.set(entryName, parseSnapshot(text));
        } catch {
            // An entry that did not exist at the tag promised nothing.
        }
    }
    return out;
}

function lastReleaseRef() {
    const flag = process.argv.find((a) => a.startsWith('--baseline='));
    if (flag) return flag.slice('--baseline='.length);
    try {
        return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], {
            cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return null;
    }
}

if (mode === '--check-baseline') {
    const ref = lastReleaseRef();
    if (!ref) {
        console.log('api-surface: no release tag to compare against — nothing was promised yet.');
        process.exit(0);
    }
    const baseline = baselineSnapshots(ref);
    let failed = 0;
    let claims = 0;
    for (const [entryName, was] of baseline) {
        const file = join(ETC, `${entryName}.api.md`);
        if (!existsSync(file)) continue;
        const now = parseSnapshot(readFileSync(file, 'utf8'));
        claims += [...was.values()].filter((s) => s.tier === 'public').length;
        const { failures, notes } = baselineFindings(was, now);
        for (const n of notes) console.log(`  note ${entryName}: ${n}`);
        if (!failures.length) continue;
        failed += failures.length;
        console.error(`BROKEN PROMISE: ${entryName} — ${ref} froze these and this tree does not keep them.`);
        for (const f of failures) console.error(`  ${f}`);
    }
    if (failed) {
        console.error(`\napi-surface: ${failed} broken promise(s) against ${ref}.`);
        console.error('Deprecate for a release before removing, or restore the signature.');
        process.exit(1);
    }
    console.log(`api-surface: ${claims} @public symbol(s) promised at ${ref}, all kept.`);
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

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

const { program, checker } = createSdkProgram(entryPaths, { strictLibCheck: fromDts });

/**
 * Every symbol any entry exports, by identity rather than by name. Identity is
 * load-bearing: the asset class is called `Assets` and so is the resource const
 * that holds one, so a name check reads the class as exported when only the const
 * is. The union across entries, since a shape exported from `physics` is nameable.
 */
const exportedSymbols = new Set();
for (const entryPath of Object.values(entryPaths)) {
    const sourceFile = program.getSourceFile(join(SDK, entryPath));
    const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const s of checker.getExportsOfModule(moduleSymbol)) {
        exportedSymbols.add(s);
        if (s.flags & ts.SymbolFlags.Alias) exportedSymbols.add(checker.getAliasedSymbol(s));
    }
}

const FMT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

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

/**
 * Tier from a file's leading `@file` JSDoc header, as a module-wide fallback.
 * A header cannot confer @public: declaration bundlers drop it, so the freeze
 * would be invisible in the `.d.ts` a creator actually reads.
 */
function fileLevelTier(sourceFile) {
    if (fileTagCache.has(sourceFile.fileName)) return fileTagCache.get(sourceFile.fileName);
    let tier = null;
    const text = sourceFile.getFullText();
    for (const range of ts.getLeadingCommentRanges(text, 0) ?? []) {
        const comment = text.slice(range.pos, range.end);
        // Every comment before the first token is "leading", so the doc on a
        // file's first declaration is in here too. `@file` is what makes one a
        // header, and tagging that declaration is not tagging the module.
        if (!comment.startsWith('/**') || !/@file\b/.test(comment)) continue;
        if (/^\s*\*\s*@public\b/m.test(comment)) {
            const where = relative(ROOT, sourceFile.fileName).replace(/\\/g, '/');
            errors.push(`R4: '${where}' claims @public in its @file header — tag the declaration, a header does not reach the .d.ts`);
        }
        for (const t of ['internal', 'beta', 'experimental']) {
            if (new RegExp(`^\\s*\\*\\s*@${t}\\b`, 'm').test(comment)) { tier = t; break; }
        }
    }
    fileTagCache.set(sourceFile.fileName, tier);
    return tier;
}

/** Every JSDoc tag name on a symbol's declarations. */
function tagNames(symbol) {
    const out = new Set();
    for (const decl of symbol.declarations ?? []) {
        for (const tag of ts.getJSDocTags(decl)) out.add(tag.tagName.text);
    }
    return out;
}

/**
 * Tier and deprecation, as separate axes: a symbol can be frozen AND on its way
 * out, and the baseline rule needs to read the second without losing the first.
 * Declaration-site tag wins; else the declaring file's header; else experimental.
 */
function releaseTag(symbol) {
    const tags = tagNames(symbol);
    const deprecated = tags.has('deprecated');
    for (const t of TIERS) if (tags.has(t)) return { tier: t, deprecated };
    for (const decl of symbol.declarations ?? []) {
        const tier = fileLevelTier(decl.getSourceFile());
        if (tier) return { tier, deprecated };
    }
    return { tier: 'experimental', deprecated };
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

/** A well-known symbol member — `__@iterator@16`, whose trailing id is a checker
 *  counter and therefore not stable enough to put in a snapshot. */
const WELL_KNOWN_SYMBOL = /^__@(\w+)@\d+$/;

/** `[Symbol.iterator]`, so `for…of` is part of the recorded surface. */
function memberName(member) {
    const wellKnown = WELL_KNOWN_SYMBOL.exec(member.escapedName?.toString() ?? '');
    return wellKnown ? `[Symbol.${wellKnown[1]}]` : member.name;
}

function isPrivateMember(member) {
    const escaped = member.escapedName?.toString() ?? '';
    if (WELL_KNOWN_SYMBOL.test(escaped)) return false;
    if (escaped.startsWith('__')) return true;
    for (const decl of member.declarations ?? []) {
        if (decl.name && ts.isPrivateIdentifier(decl.name)) return true;
        const mods = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
        if (mods?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
            return true;
        }
    }
    return false;
}

function memberLines(type, location, owner) {
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
        // R1 only ever saw top-level exports, so an @internal member rode out in the
        // public .d.ts unannounced. Marked here, in the shipped .d.ts, and skipped by
        // the leak and baseline rules: it is present, and it promises nothing.
        const mark = tagNames(member).has('internal') ? '@internal ' : '';
        lines.push(`${mark}${memberName(member)}: ${normalizeType(checker.typeToString(memberType, location, FMT))}`);
    }
    return lines.sort();
}

/**
 * The class or interface an alias points at when that target's OWN name is not
 * exported — `export type AssetsData = AssetsClass`, an alias for a class no entry
 * re-exports. Null for anything a reader can look up, or with no members to record.
 */
function hiddenTargetOf(aliasDecl) {
    if (!ts.isTypeReferenceNode(aliasDecl.type)) return null;
    const target = checker.getTypeAtLocation(aliasDecl.type).getSymbol();
    if (!target || !(target.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface))) return null;
    if (exportedSymbols.has(target)) return null;
    // Only our own source: an alias to a lib or @types shape is not ours to record.
    const from = target.declarations?.[0]?.getSourceFile().fileName.replace(/\\/g, '/');
    if (!from || !from.startsWith(SDK.replace(/\\/g, '/')) || from.includes('/node_modules/')) return null;
    return target;
}

function describeSymbol(name, symbol) {
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const decl = resolved.declarations?.[0];
    if (!decl) {
        errors.push(`R2: export '${name}' does not resolve to a declaration`);
        return null;
    }
    const { tier, deprecated } = releaseTag(resolved);
    const owner = { name, tier };
    const flags = resolved.flags;
    const body = [];
    let kind = 'value';

    if (flags & ts.SymbolFlags.Class) {
        kind = 'class';
        const instance = checker.getDeclaredTypeOfSymbol(resolved);
        const statics = checker.getTypeOfSymbolAtLocation(resolved, decl);
        body.push(...memberLines(instance, decl, owner));
        body.push(...memberLines(statics, decl, owner).map((l) => `static ${l}`));
    } else if (flags & ts.SymbolFlags.Interface) {
        kind = 'interface';
        body.push(...memberLines(checker.getDeclaredTypeOfSymbol(resolved), decl, owner));
    } else if (flags & ts.SymbolFlags.TypeAlias) {
        kind = 'type';
        const aliasDecl = resolved.declarations.find(ts.isTypeAliasDeclaration);
        const hidden = aliasDecl && hiddenTargetOf(aliasDecl);
        if (hidden) {
            // Recording the target's unexported NAME records nothing — no member
            // would reach the snapshot, the diff or the baseline rule. The type AT
            // the reference, so a `GraphEdge<FsmTransition>` keeps its instantiation.
            body.push(...memberLines(checker.getTypeAtLocation(aliasDecl.type), aliasDecl, owner));
            if (hidden.flags & ts.SymbolFlags.Class) {
                const statics = checker.getTypeOfSymbolAtLocation(hidden, hidden.declarations[0]);
                body.push(...memberLines(statics, aliasDecl, owner).map((l) => `static ${l}`));
            }
        } else {
            body.push(normalizeType(aliasDecl ? aliasDecl.type.getText() : 'unknown'));
        }
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
    return { name, kind, tier, deprecated, body };
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
    const counts = { public: 0, beta: 0, experimental: 0, deprecated: 0 };
    for (const symbol of exports) {
        const desc = describeSymbol(symbol.name, symbol);
        if (!desc) continue;
        if (desc.tier === 'internal') {
            errors.push(`R1: '${entryName}' exports @internal symbol '${symbol.name}'`);
            continue;
        }
        counts[desc.tier]++;
        if (desc.deprecated) counts.deprecated++;
        const suffix = ` @${desc.tier}${desc.deprecated ? ' @deprecated' : ''}`;
        out.push(`## ${desc.name} — ${desc.kind}${suffix}`);
        if (desc.body.length) {
            out.push('```');
            out.push(...desc.body);
            out.push('```');
        }
        out.push('');
    }
    out.splice(3, 0, `Symbols: ${counts.public} public · ${counts.beta} beta · ${counts.experimental} experimental · ${counts.deprecated} deprecated`);
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
        const declared = new Map();
        for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
            if (symbol.name.startsWith('__')) continue;
            const desc = describeSymbol(symbol.name, symbol);
            if (!desc) continue;
            emitted.set(desc.name, desc.kind);
            const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            if (resolved.declarations?.[0]) declared.set(desc.name, resolved.declarations[0]);
        }

        // Only name and kind are compared: a tier can come from a `@file` header,
        // and a header cannot survive into a bundled .d.ts.
        const snapshot = parseSnapshot(readFileSync(join(ETC, `${entryName}.api.md`), 'utf8'));

        // A freeze the creator's editor cannot show them is not a promise they
        // can act on, and a dropped tag is invisible without something asking.
        for (const [name, s] of snapshot) {
            if (s.tier !== 'public') continue;
            const decl = declared.get(name);
            if (decl && !/@public\b/.test(leadingDoc(decl))) {
                errors.push(`R5: '${name}' is @public but the built ${entryName}.d.ts does not carry the tag`);
            }
        }

        const dropped = [...snapshot.keys()].filter((n) => !emitted.has(n));
        const extra = [...emitted.keys()].filter((n) => !snapshot.has(n));
        const rekinded = [...snapshot].filter(([n, s]) => emitted.has(n) && emitted.get(n) !== s.kind);
        if (!dropped.length && !extra.length && !rekinded.length) continue;

        broken++;
        console.error(`DIVERGED: ${entryName} — the built .d.ts does not carry the documented surface.`);
        for (const n of dropped.slice(0, 15)) console.error(`  missing from .d.ts: ${n}`);
        for (const n of extra.slice(0, 15)) console.error(`  only in .d.ts:      ${n}`);
        for (const [n, s] of rekinded.slice(0, 15)) console.error(`  ${n}: ${s.kind} became ${emitted.get(n)}`);
    }

    // One violation per symbol, not per entry that re-exports it.
for (const e of new Set(errors)) console.error(`POLICY ${e}`);
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

// One violation per symbol, not per entry that re-exports it.
for (const e of new Set(errors)) console.error(`POLICY ${e}`);
if (errors.length || drift) {
    console.error(`\napi-surface: ${new Set(errors).size} policy violation(s), ${drift} drifted snapshot(s).`);
    console.error('Fix violations, then: node tools/api-surface.mjs --update');
    process.exit(1);
}
console.log(`api-surface: ${Object.keys(ENTRIES).length} entries clean.`);
