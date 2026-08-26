// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    coverage.test.ts
 * @brief   How much of the shipped corpus compiles — a number that may only rise.
 *
 * @details Without this the subset can quietly stop growing, or shrink under a
 *          refactor, and nothing says so: every other test here
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
 *          The breakdown counts ONE refusal per system: lowering stops at the
 *          first thing it cannot take, so the list says what systems hit FIRST,
 *          not everything that would have to be built to compile them. Clearing
 *          the top line usually reveals the next one rather than raising the
 *          number.
 *
 *          Which is also why the CEILING falls as pending work lands. It counts
 *          a system reachable when every refusal against it is pending, and it
 *          can only see the first — so it is an optimistic estimate that gets
 *          less optimistic as systems get further and meet what is permanent.
 *          A drop there is the number becoming true, not the corpus losing
 *          ground; the floor below it moves with a reason in the commit.
 *
 *          It also reports the CEILING: how much of the corpus the contract could
 *          ever take, counting a system as reachable when every refusal against
 *          it is `pending` rather than `permanent`. That number is what says the
 *          remaining work is a finite list rather than an open hunt.
 *
 *          The floors are committed. Raising them is the point; lowering one
 *          needs a reason in the commit message, because the corpus lost ground.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brokenPromises, lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { builtinShapes } from '../src/builtins';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Per-frame systems only. See the file header before lowering these. */
const FRAME_FLOOR = 15;
/** Per-frame systems the contract could take once the pending work is done. */
const CEILING_FLOOR = 84;

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
const results = [...projects.entries()].map(([project, fs]) => ({
    project, lowered: lowerProgram(fs, builtinShapes()),
}));

/**
 * A system is identified by its PROJECT and its name, never by the name alone.
 * Two projects both call a system `MoveSystem`, and counting by name merges
 * them: one project's compiling would have reported the other's as compiled
 * too. The same shape as the two different `Health` components, one layer up.
 */
const key = (project: string, name: string): string => `${project}::${name}`;

const seen = results.flatMap(({ project, lowered }) => lowered.seen.map((n) => key(project, n)));
const diagnostics = results.flatMap(({ project, lowered }) => lowered.diagnostics.map((d) => ({
    ...d, system: d.system === undefined ? undefined : key(project, d.system),
})));
const verifiedNames = new Set(results.flatMap(({ project, lowered }) => lowered.module.systems
    .filter((s) => verifySystem(s, lowered.module.comps, lowered.module.fns).length === 0)
    .map((s) => key(project, s.name))));
const unverified = results.flatMap(({ project, lowered }) => lowered.module.systems
    .map((s) => ({ name: key(project, s.name), errors: verifySystem(s, lowered.module.comps, lowered.module.fns) }))
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
    for (const { project, lowered } of results) {
        for (const f of projects.get(project)!.filter((p) => p.endsWith('main.ts'))) {
            const src = readFileSync(f, 'utf8');
            for (const re of [SCHEDULED, BARE_ADD]) {
                for (const m of src.matchAll(re)) {
                    frame.add(key(project, lowered.systemBindings.get(m[1]!) ?? m[1]!));
                }
            }
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

    it('counts a system per project, because two projects share a system name', () => {
        const projectsByName = new Map<string, Set<string>>();
        for (const { project, lowered } of results) {
            for (const n of lowered.seen) {
                if (!projectsByName.has(n)) projectsByName.set(n, new Set());
                projectsByName.get(n)!.add(project);
            }
        }
        const shared = [...projectsByName].filter(([, ps]) => ps.size > 1);
        // Without a duplicate in the corpus the distinction is untested, and
        // counting by name alone would pass while merging two systems into one.
        expect(shared.length).toBeGreaterThan(0);
        for (const [name, ps] of shared) {
            for (const project of ps) expect(seen).toContain(key(project, name));
        }
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

    it('reports the contract ceiling, not just today', () => {
        const permanentlyOut = new Set(
            diagnostics.filter((d) => d.kind === 'permanent' && d.system).map((d) => d.system!));
        const reachable = seen.filter((n) => !permanentlyOut.has(n));
        const reachableFrame = reachable.filter((n) => perFrame.has(n));
        const seenFrame = seen.filter((n) => perFrame.has(n));
        const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1);
        console.log([
            '',
            `contract ceiling, per-frame : ${reachableFrame.length}/${seenFrame.length}`
                + ` (${pct(reachableFrame.length, seenFrame.length)}%)  <- reachable, pending work only`,
            `permanently out, per-frame  : ${seenFrame.length - reachableFrame.length}`
                + '  <- needs something the contract does not have',
        ].join('\n'));
        const why = new Map<string, number>();
        for (const d of diagnostics) {
            if (d.kind !== 'permanent' || !d.system || !perFrame.has(d.system)) continue;
            const key = d.message.replace(/'[^']*'/g, "'…'").slice(0, 64);
            why.set(key, (why.get(key) ?? 0) + 1);
        }
        for (const [k, n] of [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
            console.log(`  ${String(n).padStart(3)}x  ${k}`);
        }
        expect(reachableFrame.length).toBeGreaterThanOrEqual(CEILING_FLOOR);
        // A ceiling equal to the corpus would mean nothing was ever classified
        // permanent, which would make the split decorative.
        expect(reachableFrame.length).toBeLessThan(seenFrame.length);
    });

    it('every refusal says whether it is permanent or pending', () => {
        expect(diagnostics.every((d) => d.kind === 'permanent' || d.kind === 'pending')).toBe(true);
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

/**
 * The coverage number above measures a corpus nobody promised anything about.
 * This one measures the promises: a system carrying `@compiled` must compile and
 * verify, and a refusal against one is an error rather than a quiet fallback.
 * It is the number that can be 100% and STAY 100%.
 */
describe('systems the corpus promises to compile', () => {
    const promised = results.flatMap(({ project, lowered }) => lowered.required.map((n) => key(project, n)));

    it('finds the marker in the corpus at all', () => {
        // At zero this whole block asserts nothing, which is the failure a gate
        // is least able to notice about itself.
        expect(promised.length).toBeGreaterThan(0);
        console.log(`@compiled promises: ${promised.length} — ${promised.join(', ')}`);
    });

    it('keeps every one of them', () => {
        expect(results.flatMap(({ lowered }) => brokenPromises(lowered))).toEqual([]);
    });

    it('and each also verifies, not merely lowers', () => {
        expect(promised.filter((n) => !verifiedNames.has(n))).toEqual([]);
    });
});
