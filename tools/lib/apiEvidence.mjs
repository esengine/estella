// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  apiEvidence.mjs — the three things that hold a promise about a symbol up.
 *
 * A stability claim is only worth the evidence under it: documentation, because
 * the freeze is the moment the contract stops being readable from the code; a
 * test, because a shape nothing pins moves with the first thing that touches it;
 * and a real game, because a symbol no chain ever calls has never been tried.
 *
 * One definition, because two now ask: `check-freeze-bar` about a @public symbol
 * and `check-tier-bar` about the entry a subsystem publishes its verdict on. Two
 * copies would be two bars called by one name.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SDK, ts, ENTRIES, createSdkProgram, leadingDoc, docProseLines } from './sdkProgram.mjs';
import { GOLDEN, projectDir } from '../goldenProjects.mjs';

/** Snapshot kinds a game calls at runtime; the rest are shapes. */
export const VALUE_KINDS = new Set(['class', 'enum', 'function', 'const', 'value', 'namespace']);

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

/** A leading doc block carrying at least one line that is not a tag. */
export function hasDocProse(decl) {
    return docProseLines(leadingDoc(decl)).length > 0;
}

/** A `describe('X', …)` title is prose that happens to sit inside a string. */
const TITLE = /\b(?:describe|it|test|bench)(?:\.\w+)*\s*\(\s*(['"`])(?:[^\\]|\\.)*?\1/g;

/**
 * Every identifier a test names IN CODE. Comments and test titles are stripped
 * first: a symbol whose only appearance is `describe('TextOverflow', …)` has
 * nothing pinning its shape, and that one was @public.
 *
 * A string that is not a title still counts — naming a component by its string
 * is how several APIs are called, and a rename breaks that as loudly.
 */
export function testedIdentifiers() {
    const seen = new Set();
    const skip = (p, name) => name === 'node_modules' || name === 'dist';
    walk(join(SDK, 'src'), collect, skip);
    walk(join(SDK, 'tests'), collect, skip);
    function collect(p) {
        if (!/\.test\.ts$/.test(p)) return;
        const code = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .split('\n').map((l) => l.replace(/(^|[^:'"`\\\w])\/\/.*$/, '$1')).join('\n')
            .replace(TITLE, (m, q) => m.slice(0, m.indexOf(q)) + q + q);
        for (const id of code.match(/[A-Za-z_$][\w$]*/g) ?? []) seen.add(id);
    }
    return seen;
}

// Every entry, not just the root one: the SDK ships nine, and a symbol reached
// through `esengine/spine` is as exercised as one reached through `esengine`.
const ESENGINE_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]esengine(?:\/[^'"]+)?['"]/g;

/** Symbols each golden project imports from an `esengine` entry, as `name -> [projectId]`. */
export function exercisedByGolden() {
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

/**
 * Where each of `wanted` is declared, across every SDK entry, aliases resolved.
 * A name that resolves to nothing is absent from the map — a caller has to treat
 * that as "cannot tell", not as "meets the bar".
 */
export function declarationsOf(wanted, program, checker) {
    const out = new Map();
    for (const entryPath of Object.values(ENTRIES)) {
        const sourceFile = program.getSourceFile(join(SDK, entryPath));
        const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) continue;
        for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
            if (out.has(symbol.name) || !wanted.has(symbol.name)) continue;
            const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            const decl = resolved.declarations?.[0];
            if (decl) out.set(symbol.name, decl);
        }
    }
    return out;
}

export { createSdkProgram };

/**
 * Symbols the evidence above cannot see, and why. Each is handed to a system body
 * by a declared parameter, or built by the engine on a game's behalf: a golden
 * project runs one every frame and no import list ever names it. A bar asking
 * about these is blind, not unmet, which is a different answer.
 */
const RECEIVED = 'received from a declared parameter, never imported — golden projects run it, no import list names it';
const HANDED_BACK = 'answered by a frozen factory, never imported — a game names the factory, not this';
export const BLIND = {
    InputMap: HANDED_BACK,
    // Same blindness, from the other direction: the map's rebind scan builds one
    // when a player binds a mouse button, so a certified game runs it without any
    // import list ever naming it.
    MouseButton: 'built by InputMap\'s rebind scan on the game\'s behalf — run by a golden project, named by none',
    // Same shape of blindness: the engine maintains this one from Parent, so a
    // game reads it and every golden project's layout walks it every frame, but
    // nothing imports the name.
    Children: 'engine-maintained from Parent — walked every frame, named in no import list',
    CommandsInstance: RECEIVED,
    EntityCommands: RECEIVED,
    EventReaderInstance: RECEIVED,
    EventWriterInstance: RECEIVED,
    QueryInstance: RECEIVED,
    RemovedQueryInstance: RECEIVED,
    ResMutInstance: RECEIVED,
};
