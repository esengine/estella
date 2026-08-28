#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-enum-twins.mjs — a TS enum that restates a C++ one is held to it.
 *
 * The engine's enums cross as bare numbers, so a TS spelling that drifts from the
 * C++ one does not fail: it writes 1 where the renderer reads 2, and the picture
 * is merely wrong. `cpp-contract.test.ts` pins the ones somebody remembered —
 * which is the problem, because it is a list somebody remembers.
 *
 * Two shapes are caught, both found by hand before this existed:
 *   - a declaration with the SAME NAME as a generated enum (`MaskMode`,
 *     `ScrollMovement`, `TextAlign`);
 *   - a doc that PROMISES to match one ("values matching the C++
 *     TilemapOrientation"), which is a contract with nothing keeping it.
 *
 * Either way it owes a pin in `cpp-contract.test.ts` — as a re-export whose
 * identity is asserted, or, where the symbol must keep its own tier tag, as a
 * value comparison.
 *
 *   node tools/check-enum-twins.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ETC, ENTRIES } from './lib/sdkProgram.mjs';
import { parseSnapshot } from './lib/apiSnapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(ROOT, 'sdk/src/wasm/wasm.generated.ts');
const CONTRACT = path.join(ROOT, 'sdk/tests/cpp-contract.test.ts');

for (const [what, file] of [['the generated twins', GENERATED], ['the contract test', CONTRACT]]) {
    if (existsSync(file)) continue;
    // Loud: with either half missing this can only report "nothing to hold",
    // which reads exactly like "everything is held".
    console.error(`check-enum-twins: ${what} is not here (${path.relative(ROOT, file)}) — cannot judge.`);
    process.exit(1);
}

const generated = readFileSync(GENERATED, 'utf8');
const GEN_ENUMS = new Set([...generated.matchAll(/^export enum (\w+) \{/gm)].map((m) => m[1]));
const contract = readFileSync(CONTRACT, 'utf8');
const pinned = (name) => new RegExp(`\\b${name}\\b`).test(contract);

/** A doc that says this must agree with something, which only a check can. */
const PROMISE = /\b(?:matching|matches|must match|mirrors|same as|kept in sync)\b/i;

const sources = execFileSync('git', ['ls-files', 'sdk/src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.ts') && !f.includes('.generated.'));

const problems = [];
for (const rel of sources) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const lines = text.split('\n');

    for (const m of text.matchAll(/^export (?:enum|const) (\w+)\b/gm)) {
        const name = m[1];
        // A re-export is the single source, not a restatement of it.
        if (new RegExp(`^export \\{[^}]*\\b${name}\\b[^}]*\\} from`, 'm').test(text)) continue;
        if (!GEN_ENUMS.has(name) || pinned(name)) continue;
        problems.push(`${rel}: ${name} has the name of a generated C++ enum and nothing holds them equal`);
    }

    for (const [i, line] of lines.entries()) {
        if (!PROMISE.test(line)) continue;
        for (const gen of GEN_ENUMS) {
            if (!new RegExp(`\\b${gen}\\b`).test(line) || pinned(gen)) continue;
            problems.push(`${rel}:${i + 1}: promises to match the C++ ${gen}, and nothing checks that`);
        }
    }
}

// ------------------------------------------------------- and how strongly
//
// A shape is MADE of these: an enum weaker than the shape naming it survives a
// release while the values it may hold do not. `ES_ENUM(stability=)` answers it.
const RANK = { public: 0, beta: 1, experimental: 2 };
const api = new Map();
for (const entry of Object.keys(ENTRIES)) {
    const file = path.join(ETC, `${entry}.api.md`);
    if (!existsSync(file)) continue;
    for (const [name, sym] of parseSnapshot(readFileSync(file, 'utf8'))) {
        const seen = api.get(name);
        if (!seen) { api.set(name, { ...sym }); continue; }
        if ((RANK[sym.tier] ?? 9) < (RANK[seen.tier] ?? 9)) seen.tier = sym.tier;
    }
}
for (const [name, sym] of api) {
    if ((RANK[sym.tier] ?? 9) > RANK.beta) continue;   // experimental promises nothing
    const body = (sym.body ?? '').split('\n').filter((l) => !l.startsWith('@internal ')).join('\n');
    for (const gen of GEN_ENUMS) {
        if (!new RegExp(`:\\s*${gen}\\b`).test(body)) continue;
        const theirs = api.get(gen)?.tier ?? 'experimental';
        if ((RANK[theirs] ?? 9) <= (RANK[sym.tier] ?? 9)) continue;
        problems.push(`${name} is @${sym.tier} and its shape is spelled in ${gen}, which is @${theirs}`);
    }
}

if (problems.length) {
    console.error('check-enum-twins: a number that crosses to C++ is restated or under-promised.\n');
    for (const p of [...new Set(problems)]) console.error(`  ${p}`);
    console.error('\nRe-export it from sdk/src/wasm/wasm.generated and pin the identity in'
        + ' sdk/tests/cpp-contract.test.ts, or — where the symbol must keep its own tier tag —'
        + ' keep the declaration and pin its VALUES there. An under-promised enum is answered'
        + ' with ES_ENUM(stability=) at its C++ declaration.');
    process.exit(1);
}
console.log(`check-enum-twins: ${GEN_ENUMS.size} generated C++ enums — every TS restatement held to`
    + ' one, and every shape promised at beta or better spelled in vocabulary at least as strong.');
