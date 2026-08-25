// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    coverage.test.ts
 * @brief   How much of the shipped corpus compiles — a number that may only rise.
 *
 * @details §8.2's coverage gate. Without it the subset can quietly stop growing,
 *          or shrink under a refactor, and nothing says so: every other test here
 *          passes just as well on a compiler that lowers one system.
 *
 *          The floor is committed. Raising it is the point; lowering it needs a
 *          reason in the commit message, because it means the corpus lost ground.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { builtinShapes } from '../src/builtins';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Measured, not aspired to. 3 of 174 is where the subset stands: the remaining
 * blockers are semantic (Commands, GetWorld, EventReader all mutate the world),
 * not syntactic, so the next increment is real work rather than more parsing.
 * Raise this when it grows; see the file header before lowering it.
 */
const FLOOR = 3;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

const files = walk(join(ROOT, 'examples')).filter((f) => f.includes(`${'src'}`));
const { module, diagnostics, seen } = lowerProgram(files, builtinShapes());

describe('AOT coverage over examples/', () => {
    it('found systems to measure', () => {
        expect(files.length).toBeGreaterThan(20);
        expect(seen.length).toBeGreaterThan(20);
    });

    it(`compiles at least ${FLOOR} of the corpus's systems`, () => {
        const verified = module.systems.filter((s) => verifySystem(s, module.comps).length === 0);
        const pct = ((100 * verified.length) / seen.length).toFixed(1);

        // The breakdown is the point of running this: the commonest refusal is
        // the next thing worth lowering.
        const reasons = new Map<string, number>();
        for (const d of diagnostics) {
            const key = d.message.startsWith("'") && d.message.includes('parameter intrinsic')
                ? d.message : d.message.replace(/'[^']*'/g, "'…'");
            reasons.set(key, (reasons.get(key) ?? 0) + 1);
        }
        const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        console.log(`\nAOT coverage: ${verified.length}/${seen.length} systems (${pct}%) over ${files.length} files`);
        for (const [why, n] of top) console.log(`  ${String(n).padStart(3)}x  ${why}`);

        expect(verified.length).toBeGreaterThanOrEqual(FLOOR);
    });

    it('every system that compiles also verifies', () => {
        // A system the frontend accepted but the IR verifier rejects is a
        // frontend bug, not a coverage number — it must never be counted.
        const broken = module.systems
            .map((s) => ({ name: s.name, errors: verifySystem(s, module.comps) }))
            .filter((r) => r.errors.length > 0);
        expect(broken).toEqual([]);
    });
});
