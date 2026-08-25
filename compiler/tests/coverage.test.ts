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
 *          It counts PER-FRAME systems. A startup system runs once, so compiling
 *          it buys no frame time, and a gate counting it would measure the wrong
 *          thing — the failure a gate is least able to notice about itself. The
 *          all-systems number is printed beside it, for information.
 *
 *          Each example is lowered as its OWN program, because that is the unit
 *          pipeline/ cooks. Compiling all of examples/ at once merged two
 *          different components both named 'Health' and silently gave one
 *          project the other's shape.
 *
 *          The floor is committed. Raising it is the point; lowering it needs a
 *          reason in the commit message, because the corpus lost ground.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { builtinShapes } from '../src/builtins';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Per-frame systems only. See the file header before lowering this. */
const FRAME_FLOOR = 9;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

const files = walk(join(ROOT, 'examples')).filter((f) => f.includes('src'));

/** examples/<name>/… -> one program each. */
function byProject(all: readonly string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const f of all) {
        const rest = f.slice(join(ROOT, 'examples').length + 1);
        // path.sep, not a regex: a backslash inside one is too easy to lose,
        // and losing it made every FILE its own program without a word.
        const project = rest.split(sep)[0]!;
        const list = out.get(project);
        if (list) list.push(f); else out.set(project, [f]);
    }
    return out;
}

const projects = byProject(files);
const results = [...projects.values()].map((fs) => lowerProgram(fs, builtinShapes()));
const seen = results.flatMap((r) => r.seen);
const diagnostics = results.flatMap((r) => r.diagnostics);
const systemBindings = new Map(results.flatMap((r) => [...r.systemBindings]));
const verifiedNames = new Set(results.flatMap(
    (r) => r.module.systems.filter((s) => verifySystem(s, r.module.comps).length === 0).map((s) => s.name)));
const unverified = results.flatMap((r) => r.module.systems
    .map((s) => ({ name: s.name, errors: verifySystem(s, r.module.comps) }))
    .filter((x) => x.errors.length > 0));

const SCHEDULED = /addSystemToSchedule\s*\(\s*Schedule\.\w+\s*,\s*(\w+)\s*\)/g;
const BARE_ADD = /\baddSystem\s*\(\s*(\w+)\s*\)/g;

/**
 * Which systems run every frame. main.ts registers by BINDING, so the binding
 * map is what turns `addSystemToSchedule(Schedule.Update, moveSystem)` into the
 * declared name the rest of this file counts.
 */
function perFrameSystems(): Set<string> {
    const frame = new Set<string>();
    for (const f of files.filter((p) => p.endsWith('main.ts'))) {
        const src = readFileSync(f, 'utf8');
        for (const re of [SCHEDULED, BARE_ADD]) {
            for (const m of src.matchAll(re)) frame.add(systemBindings.get(m[1]!) ?? m[1]!);
        }
    }
    return frame;
}
const perFrame = perFrameSystems();

describe('AOT coverage over examples/', () => {
    it('found systems to measure, one program per project', () => {
        expect(projects.size).toBeGreaterThan(20);
        expect(files.length).toBeGreaterThan(20);
        expect(seen.length).toBeGreaterThan(20);
    });

    it('no project declares one component name twice', () => {
        // Across projects the same name is fine and expected; within one it is a
        // shape nobody can pin down.
        expect(diagnostics.filter((d) => d.message.includes('already declared'))).toEqual([]);
    });

    it('classified the corpus by schedule', () => {
        // At zero the regexes have stopped matching, and the gate below would
        // silently be measuring an empty set.
        expect(perFrame.size).toBeGreaterThan(50);
        expect(perFrame.size).toBeLessThan(seen.length);
    });

    it(`compiles at least ${FRAME_FLOOR} of the per-frame systems`, () => {
        const verified = [...verifiedNames];
        const verifiedFrame = verified.filter((n) => perFrame.has(n));
        const seenFrame = seen.filter((n) => perFrame.has(n));

        // The breakdown is the point of running this: the commonest refusal is
        // the next thing worth lowering.
        const reasons = new Map<string, number>();
        for (const d of diagnostics) {
            const key = d.message.startsWith("'") && d.message.includes('parameter intrinsic')
                ? d.message : d.message.replace(/'[^']*'/g, "'…'");
            reasons.set(key, (reasons.get(key) ?? 0) + 1);
        }
        const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1);
        console.log([
            '',
            `AOT coverage, per-frame : ${verifiedFrame.length}/${seenFrame.length}`
                + ` (${pct(verifiedFrame.length, seenFrame.length)}%)   <- what AOT is for`,
            `AOT coverage, all       : ${verified.length}/${seen.length}`
                + ` (${pct(verified.length, seen.length)}%) over ${files.length} files`,
            ...top.map(([why, n]) => `  ${String(n).padStart(3)}x  ${why}`),
        ].join('\n'));

        expect(verifiedFrame.length).toBeGreaterThanOrEqual(FRAME_FLOOR);
    });

    it('every system that compiles also verifies', () => {
        // A system the frontend accepted but the IR verifier rejects is a
        // frontend bug, not a coverage number — it must never be counted.
        expect(unverified).toEqual([]);
    });
});
