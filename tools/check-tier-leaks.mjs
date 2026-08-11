#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-tier-leaks.mjs — a frozen signature that names an unfrozen type.
 *
 * `@public` promises a shape. If that shape is spelled with a type nobody froze,
 * the promise is only as good as the weakest name in it: the symbol survives
 * 1.0 and the type it hands you does not. So a frozen symbol may only name
 * frozen types.
 *
 * Wave 1 froze six symbols whose signatures are spelled in a vocabulary nobody
 * has frozen yet, so this starts as a ratchet rather than a wall: the leaks that
 * exist are named in {@link ACCEPTED} and a new one fails. Each line deleted
 * from that list is a promise that got real.
 *
 *   node tools/check-tier-leaks.mjs            exit 1 on an undeclared leak
 *   node tools/check-tier-leaks.mjs --report   print what freezing would cost
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ETC, ENTRIES } from './lib/sdkProgram.mjs';
import { parseSnapshot } from './lib/apiSnapshot.mjs';

/**
 * Frozen symbols known to name unfrozen types, and what is still missing. Every
 * one is the ECS vocabulary the six Wave 1 symbols are written in — descriptors,
 * defs and the parameter union — none of which has been through the freeze bar.
 */
export const ACCEPTED = {
    Commands: 'the descriptor it returns is unfrozen ECS vocabulary',
    Mut: 'the component-def union and wrapper are unfrozen ECS vocabulary',
    Query: 'the argument union and builder are unfrozen ECS vocabulary',
    Res: 'the resource def and descriptor are unfrozen ECS vocabulary',
    defineComponent: 'the component def and its metadata are unfrozen ECS vocabulary',
    defineSystem: 'the system def, params and options are unfrozen ECS vocabulary',
};

/** Every symbol across every entry, keeping the strongest tier any entry gives it. */
function surface() {
    const rank = { public: 0, beta: 1, experimental: 2, unclaimed: 3 };
    const out = new Map();
    for (const entryName of Object.keys(ENTRIES)) {
        const file = join(ETC, `${entryName}.api.md`);
        if (!existsSync(file)) continue;
        for (const [name, s] of parseSnapshot(readFileSync(file, 'utf8'))) {
            const seen = out.get(name);
            if (!seen) { out.set(name, { ...s }); continue; }
            if ((rank[s.tier] ?? 9) < (rank[seen.tier] ?? 9)) seen.tier = s.tier;
            if (s.body.length > seen.body.length) seen.body = s.body;
        }
    }
    return out;
}

const api = surface();

/** Exported symbols a body names. A type not in the surface is a built-in or private. */
function referenced(name) {
    const body = api.get(name)?.body ?? '';
    const out = new Set();
    for (const id of body.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (id !== name && api.has(id)) out.add(id);
    }
    return out;
}

const frozen = [...api].filter(([, s]) => s.tier === 'public').map(([n]) => n);
if (frozen.length === 0) {
    console.log('check-tier-leaks: nothing is @public yet.');
    process.exit(0);
}

const leaks = new Map();
for (const name of frozen) {
    const weak = [...referenced(name)].filter((r) => api.get(r).tier !== 'public').sort();
    if (weak.length) leaks.set(name, weak);
}

if (process.argv.includes('--report')) {
    // What freezing these WOULD cost: the closure, since each type dragged in
    // names types of its own.
    const closure = new Set();
    const queue = [...leaks.values()].flat();
    while (queue.length) {
        const n = queue.pop();
        if (closure.has(n) || api.get(n)?.tier === 'public') continue;
        closure.add(n);
        for (const r of referenced(n)) if (!closure.has(r) && api.get(r).tier !== 'public') queue.push(r);
    }
    console.log(`# ${frozen.length} @public symbol(s), ${leaks.size} leaking\n`);
    for (const [name, weak] of [...leaks].sort()) {
        console.log(`${name}\n  ${weak.map((w) => `${w} (@${api.get(w).tier})`).join('\n  ')}`);
    }
    const kinds = {};
    for (const n of closure) kinds[api.get(n).kind] = (kinds[api.get(n).kind] ?? 0) + 1;
    console.log(`\n# closure: ${closure.size} symbol(s) would have to be frozen too`);
    console.log(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v} ${k}`).join('\n'));
    process.exit(0);
}

const undeclared = [...leaks].filter(([name]) => !ACCEPTED[name]);
const stale = Object.keys(ACCEPTED).filter((name) => !leaks.has(name));

if (undeclared.length === 0 && stale.length === 0) {
    console.log(`check-tier-leaks: ${frozen.length} @public symbol(s), ${leaks.size} leaking and declared.`);
    for (const [name, weak] of [...leaks].sort()) {
        console.log(`  ${name} — ${weak.map((w) => `${w} @${api.get(w).tier}`).join(', ')}`);
    }
    process.exit(0);
}

for (const [name, weak] of undeclared.sort()) {
    console.error(`  ${name} — names ${weak.map((w) => `${w} (@${api.get(w).tier})`).join(', ')}`);
}
for (const name of stale) {
    console.error(`  ${name} — listed in ACCEPTED but leaks nothing now; delete the line`);
}
console.error(`\ncheck-tier-leaks: ${undeclared.length} undeclared leak(s), ${stale.length} stale exemption(s).`);
console.error('A frozen symbol may only name frozen types. Freeze them, or declare the gap in ACCEPTED.');
process.exit(1);
