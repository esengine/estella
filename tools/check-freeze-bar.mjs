#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-freeze-bar.mjs — what a symbol must have before it may be @public.
 *
 * @public says 1.0 is expected not to break it. A symbol nobody documented, no
 * test pins and no game ever called cannot honour that: there is nothing holding
 * its shape, so the first thing to move it moves the promise with it.
 *
 * So the tag has to be earned:
 *   documented   a doc comment with prose, since the freeze is the moment the
 *                contract stops being readable from the implementation
 *   tested       named by at least one SDK test
 *   exercised    imported from 'esengine' by at least one golden project, so a
 *                real game's chain covers it (values only — a type carries no
 *                runtime behaviour for a package to certify, and the compiler
 *                already checks its shape everywhere it is used)
 *
 * A symbol that cannot meet the bar and should still be frozen goes in
 * {@link EXEMPT} with a reason, the same bargain goldenProjects strikes: the
 * hole stays visible instead of passing for coverage.
 *
 *   node tools/check-freeze-bar.mjs
 *   node tools/check-freeze-bar.mjs --why A,B,C   what freezing these would cost
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, SDK, ETC, ts, ENTRIES, createSdkProgram, leadingDoc, docProseLines } from './lib/sdkProgram.mjs';
import { parseSnapshot } from './lib/apiSnapshot.mjs';
import { GOLDEN, projectDir } from './goldenProjects.mjs';

/**
 * Frozen symbols that cannot meet part of the bar, and why. Every one here is a
 * class a system body is HANDED by a declared parameter, so a game never writes
 * its name and no import list can show it — while every golden project runs one
 * every frame. The criterion is blind to them, not unmet by them.
 */
const RECEIVED = 'received from a declared parameter, never imported — golden projects run it, no import list names it';
export const EXEMPT = {
    CommandsInstance: RECEIVED,
    EntityCommands: RECEIVED,
    EventReaderInstance: RECEIVED,
    EventWriterInstance: RECEIVED,
    QueryInstance: RECEIVED,
    RemovedQueryInstance: RECEIVED,
    ResMutInstance: RECEIVED,
};

/** Snapshot kinds that a game calls at runtime; the rest are shapes. */
const VALUE_KINDS = new Set(['class', 'enum', 'function', 'const', 'value', 'namespace']);

// ---------------------------------------------------------------------------
// What the snapshots froze
// ---------------------------------------------------------------------------

/** Every @public symbol across every entry, as `name -> kind`. */
function frozenSymbols() {
    const out = new Map();
    for (const entryName of Object.keys(ENTRIES)) {
        const file = join(ETC, `${entryName}.api.md`);
        if (!existsSync(file)) continue;
        for (const [name, s] of parseSnapshot(readFileSync(file, 'utf8'))) {
            if (s.tier === 'public') out.set(name, s.kind);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Documented
// ---------------------------------------------------------------------------

/** A leading doc block carrying at least one line that is not a tag. */
function hasDocProse(decl) {
    return docProseLines(leadingDoc(decl)).length > 0;
}

// ---------------------------------------------------------------------------
// Tested / exercised
// ---------------------------------------------------------------------------

function walk(dir, onFile, skip) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const p = join(dir, e.name);
        if (skip(p, e.name)) continue;
        if (e.isDirectory()) walk(p, onFile, skip);
        else onFile(p);
    }
}

/** Every identifier named anywhere in the SDK's tests. */
function testedIdentifiers() {
    const seen = new Set();
    const skip = (p, name) => name === 'node_modules' || name === 'dist';
    walk(join(SDK, 'src'), collect, skip);
    walk(join(SDK, 'tests'), collect, skip);
    function collect(p) {
        if (!/\.test\.ts$/.test(p)) return;
        for (const id of readFileSync(p, 'utf8').match(/[A-Za-z_$][\w$]*/g) ?? []) seen.add(id);
    }
    return seen;
}

const ESENGINE_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]esengine['"]/g;

/** Symbols each golden project imports from 'esengine', as `name -> [projectId]`. */
function exercisedByGolden() {
    const out = new Map();
    for (const g of GOLDEN) {
        const dir = projectDir(g.id);
        if (!existsSync(dir)) continue;
        walk(dir, (p) => {
            if (!/\.ts$/.test(p) || /\.d\.ts$/.test(p)) return;
            const src = readFileSync(p, 'utf8');
            for (const m of src.matchAll(ESENGINE_IMPORT)) {
                for (const raw of m[1].split(',')) {
                    const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
                    if (!name) continue;
                    if (!out.has(name)) out.set(name, new Set());
                    out.get(name).add(g.id);
                }
            }
        }, (p, name) => name === '.esengine' || name === 'node_modules' || name === 'dist');
    }
    return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const askFlag = process.argv.find((a) => a.startsWith('--why'));
const asked = askFlag
    ? (askFlag.includes('=') ? askFlag.split('=')[1] : process.argv[process.argv.indexOf(askFlag) + 1] ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean)
    : [];

const frozen = asked.length ? new Map() : frozenSymbols();
if (asked.length) {
    // Planning a wave asks the bar about symbols that are not tagged yet, so the
    // kind comes from the snapshot the same way it does for a frozen one.
    const all = new Map();
    for (const entryName of Object.keys(ENTRIES)) {
        const file = join(ETC, `${entryName}.api.md`);
        if (!existsSync(file)) continue;
        for (const [name, s] of parseSnapshot(readFileSync(file, 'utf8'))) if (!all.has(name)) all.set(name, s.kind);
    }
    for (const name of asked) {
        if (all.has(name)) frozen.set(name, all.get(name));
        else console.error(`  ${name} — not an exported symbol`);
    }
}

if (frozen.size === 0) {
    console.log('check-freeze-bar: nothing is @public yet — no promise to hold up.');
    process.exit(0);
}

const { program, checker } = createSdkProgram();
const declarations = new Map();
for (const entryPath of Object.values(ENTRIES)) {
    const sourceFile = program.getSourceFile(join(SDK, entryPath));
    const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
        if (declarations.has(symbol.name) || !frozen.has(symbol.name)) continue;
        const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        const decl = resolved.declarations?.[0];
        if (decl) declarations.set(symbol.name, decl);
    }
}

const tested = testedIdentifiers();
const exercised = exercisedByGolden();

const failures = [];
for (const [name, kind] of [...frozen].sort()) {
    const excuse = EXEMPT[name];
    const missing = [];
    const decl = declarations.get(name);
    if (!decl) {
        failures.push({ name, say: 'is @public in a snapshot but resolves to no declaration' });
        continue;
    }
    if (!hasDocProse(decl)) missing.push('undocumented');
    if (!tested.has(name)) missing.push('named by no SDK test');
    if (VALUE_KINDS.has(kind) && !exercised.has(name)) missing.push('called by no golden project');
    if (!missing.length) {
        if (excuse) failures.push({ name, say: `meets the bar but is still listed in EXEMPT — drop the excuse` });
        continue;
    }
    if (excuse) continue;
    const where = relative(ROOT, decl.getSourceFile().fileName).replace(/\\/g, '/');
    failures.push({ name, say: `${missing.join(', ')}`, where });
}

// Not in --why: that mode is asked about a chosen few, so every other exemption
// would read as an inconsistency it did not ask about.
if (!asked.length) {
    for (const [name, why] of Object.entries(EXEMPT)) {
        if (!frozen.has(name)) failures.push({ name, say: `is exempt from the freeze bar but is not @public — ${why}` });
    }
}

if (asked.length) {
    const short = (n) => `${n}${' '.repeat(Math.max(0, 22 - n.length))}`;
    for (const [name, kind] of frozen) {
        const f = failures.find((x) => x.name === name);
        console.log(`  ${short(name)} ${kind.padEnd(10)} ${f ? f.say : 'meets the bar'}`);
    }
    console.log(`\n${frozen.size} asked, ${frozen.size - failures.length} would pass as they stand.`);
    process.exit(0);
}

const values = [...frozen].filter(([, k]) => VALUE_KINDS.has(k)).length;
if (failures.length === 0) {
    const exempt = Object.keys(EXEMPT).length;
    console.log(`check-freeze-bar: ${frozen.size} @public symbol(s) (${values} called at runtime) — documented, tested, exercised.`);
    for (const [name, why] of Object.entries(EXEMPT)) console.log(`  exempt: ${name} — ${why}`);
    if (exempt) console.log(`  ${exempt} exemption(s) — each is a symbol the corpus does not hold up.`);
    process.exit(0);
}

for (const f of failures.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    console.error(`  ${f.name} — ${f.say}${f.where ? `  (${f.where})` : ''}`);
}
console.error(`\ncheck-freeze-bar: ${failures.length} symbol(s) carry @public without earning it.`);
console.error('Document it, pin it with a test, use it in a golden project — or drop the tag.');
process.exit(1);
