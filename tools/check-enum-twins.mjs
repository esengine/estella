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

if (problems.length) {
    console.error('check-enum-twins: a number that crosses to C++ is restated and unheld.\n');
    for (const p of [...new Set(problems)]) console.error(`  ${p}`);
    console.error('\nRe-export it from sdk/src/wasm/wasm.generated and pin the identity in'
        + ' sdk/tests/cpp-contract.test.ts, or — where the symbol must keep its own tier tag —'
        + ' keep the declaration and pin its VALUES there.');
    process.exit(1);
}
console.log(`check-enum-twins: ${GEN_ENUMS.size} generated C++ enums, every TS restatement of one held to it.`);
