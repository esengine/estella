#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// =============================================================================
// Performance guard
//
// The same bargain as the API surface guard, for the properties that make the
// engine fast rather than the ones that make it correct: a snapshot in the repo,
// drift becomes a reviewed diff instead of an accident.
//
// WHY THIS EXISTS. The UI layout re-derived every node's box every frame for
// months — editing one field cost the whole tree. Nothing was wrong; nobody had
// ever measured it. "Never optimised" and "quietly regressed" are the same thing
// when there is no baseline, and this repo had none: fifteen benchmark files and
// no CI job running any of them. Worse, eleven of them had been importing
// pre-move ECS paths since `src/world.ts` became `src/ecs/world.ts` — and
// `vitest bench` skips a file it cannot resolve and still exits 0, so they read
// as passing while measuring nothing.
//
// WHAT IT ASSERTS. Two things, both chosen because they survive being run on a
// different machine:
//
//   RATIOS, not milliseconds. Every metric is one benchmark divided by another
//   from the same run, so the CPU cancels out. Each one states an architectural
//   invariant — "editing a field is far cheaper than adding a node" is the
//   incremental layout still working, and it reads the same on any laptop.
//
//   COVERAGE. How many cases produced a number. A benchmark that stops running
//   is the failure this guard was written after, and it is invisible in every
//   other signal.
//
// THE STATISTIC IS `min`, not the mean. Noise on a shared CI runner is one-sided
// — scheduling can only ever make a sample slower — so the fastest sample is the
// one closest to what the code actually costs, and the mean is the one that
// moves when the machine is busy. Read as means, this gate's first CI run
// reported four regressions of +33% to +49% in the same direction on a build
// that had changed none of them.
//
// TOLERANCE is deliberately loose on top of that. Run-to-run noise on one
// machine is ~1% median but reaches 14% on the smallest cases, and a ratio
// compounds two of those. At 50% this cannot see a 5% slowdown — it is not meant
// to. It is meant to catch the 2x-and-up kind, which is what an architectural
// property looks like when it breaks.
//
// Run: node tools/perf-guard.mjs --check    (CI: exit 1 on regression)
//      node tools/perf-guard.mjs --update   (accept the new numbers)
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runTool } from './lib/runTool.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SDK = join(ROOT, 'sdk');
const SNAPSHOT = join(SDK, 'etc', 'perf.snapshot.json');

/** Ratio metrics. `over` is the denominator; both must be in the same group. */
const METRICS = [
    {
        name: 'ui-layout: editing a field vs adding a node',
        why: 'The incremental solve. Equal cost means the tree is being re-derived.',
        group: 'UI layout — 2000 nodes',
        of: 'one node resized',
        over: 'one node added',
    },
    {
        name: 'ui-layout: editing a field vs an idle frame',
        why: 'What one edit costs above the floor the gate already skips to.',
        group: 'UI layout — 2000 nodes',
        of: 'one node resized',
        over: 'static frame (nothing changed)',
    },
    {
        name: 'query: materialising vs visiting',
        why: 'forEach visits in place; toArray pays for the array. The gap is that cost.',
        group: 'Query - Iteration (5000 entities, 2 components)',
        of: 'toArray',
        over: 'forEach',
    },
    {
        name: 'change-tracking: tracked vs untracked write-back',
        why: 'Recording a change tick is a map write, not a second pass.',
        group: 'Mut() write-back over 5000 builtin components',
        of: 'Mut write-back, component tracked',
        over: 'Mut write-back, component NOT tracked',
    },
];

/**
 * Both sides of a ratio must take at least this long, or it is not measuring the
 * code. Below roughly ten microseconds a sample is mostly timer and scheduler:
 * a system dispatch with no params is tens of nanoseconds and its fastest sample
 * rounds to 0, and CI reported a 370ns `count` as +90% against a build that had
 * not touched it. Ratios that were only ever measuring the clock are gone —
 * their benchmarks remain, worth reading, with nothing gating on them.
 */
const MIN_TIMEABLE_MS = 0.01;

const DEFAULT_TOLERANCE = 0.50;

const mode = process.argv[2] ?? '--check';
if (mode !== '--check' && mode !== '--update') {
    console.error('usage: node tools/perf-guard.mjs --check | --update');
    process.exit(2);
}

// ---------------------------------------------------------------------------
// Run the benchmarks
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'estella-perf-'));
const out = join(tmp, 'bench.json');
try {
    const run = runTool('npx', ['vitest', 'bench', '--run', '--outputJson', out], {
        cwd: SDK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!existsSync(out)) {
        console.error('perf: benchmarks produced no report.');
        console.error(run.stderr?.slice(-2000) ?? '');
        process.exit(1);
    }
    main(JSON.parse(readFileSync(out, 'utf8')));
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

function main(report) {
    // group + case -> fastest sample, in ms. A case with no timing never ran; it
    // is counted as missing rather than read as a zero.
    const times = new Map();
    let cases = 0;
    for (const file of report.files ?? []) {
        for (const group of file.groups ?? []) {
            const groupName = group.fullName.replace(/^.*bench\.ts > /, '');
            for (const b of group.benchmarks ?? []) {
                if (b.min === undefined || b.mean === undefined) continue;
                cases++;
                times.set(`${groupName} :: ${b.name}`, b.min);
            }
        }
    }

    const measured = { cases, ratios: {} };
    const missing = [];
    for (const m of METRICS) {
        const num = times.get(`${m.group} :: ${m.of}`);
        const den = times.get(`${m.group} :: ${m.over}`);
        if (num === undefined || den === undefined) {
            missing.push(`${m.name} (a benchmark it names did not run)`);
            continue;
        }
        if (num < MIN_TIMEABLE_MS || den < MIN_TIMEABLE_MS) {
            missing.push(`${m.name} (${round(Math.min(num, den))}ms is below the `
                + `${MIN_TIMEABLE_MS}ms a ratio can be measured over — pick a longer benchmark)`);
            continue;
        }
        measured.ratios[m.name] = round(num / den);
    }

    if (mode === '--update') {
        if (missing.length) {
            console.error('perf: cannot update — these metrics measured nothing:');
            for (const n of missing) console.error(`  - ${n}`);
            process.exit(1);
        }
        writeFileSync(SNAPSHOT, `${JSON.stringify({
            note: 'Generated by tools/perf-guard.mjs — run --update to accept changes.',
            tolerance: DEFAULT_TOLERANCE,
            ...measured,
        }, null, 2)}\n`);
        console.log(`perf: wrote ${SNAPSHOT.replace(`${ROOT}/`, '')} (${cases} cases, ${Object.keys(measured.ratios).length} metrics)`);
        return;
    }

    if (!existsSync(SNAPSHOT)) {
        console.error('perf: no snapshot. Create one: node tools/perf-guard.mjs --update');
        process.exit(1);
    }
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    const tol = snap.tolerance ?? DEFAULT_TOLERANCE;
    const problems = [];
    const improved = [];

    // A benchmark that stopped running is the failure this guard exists for, so
    // it is an error and not a note. More cases than the snapshot is someone
    // adding benchmarks — worth accepting, never worth failing.
    if (cases < snap.cases) {
        problems.push(`coverage fell: ${cases} cases produced a number, snapshot has ${snap.cases}`
            + ' — a benchmark file that fails to resolve is skipped silently by vitest');
    }
    for (const name of missing) problems.push(`metric measured nothing: ${name}`);

    for (const [name, now] of Object.entries(measured.ratios)) {
        const was = snap.ratios?.[name];
        if (was === undefined) { improved.push(`new metric: ${name} = ${now}`); continue; }
        const why = METRICS.find((m) => m.name === name)?.why ?? '';
        if (now > was * (1 + tol)) {
            problems.push(`${name}: ${was} → ${now} (+${pct(now / was - 1)})\n      ${why}`);
        } else if (now < was * (1 - tol)) {
            improved.push(`${name}: ${was} → ${now} (${pct(now / was - 1)})`);
        }
    }

    if (improved.length) {
        console.log('perf: better than the snapshot (accept with --update):');
        for (const i of improved) console.log(`  ${i}`);
    }
    if (problems.length) {
        console.error(`perf: ${problems.length} regression(s):`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('\nIf this is intended, accept it: node tools/perf-guard.mjs --update');
        process.exit(1);
    }
    console.log(`perf: ${Object.keys(measured.ratios).length} metrics within ${pct(tol)} of the snapshot; ${cases} cases measured.`);
}

// Declarations, not consts: main() runs at module top level (above), so an
// arrow bound later would still be in its temporal dead zone.
function round(n) { return Number(n.toPrecision(3)); }
function pct(n) { return `${(n * 100).toFixed(0)}%`; }
