#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The scale gate — run the budgets against the stress corpus.
 *
 * Generates the 50,000-asset project (or reuses it), runs the scale suite, and
 * prints the contract as a table: what each cost is allowed to be, what it is,
 * and how much of its budget it uses.
 *
 * The gate itself is inside the suite — each metric asserts against its own
 * budget, so a failure names the metric and prints the reason the budget exists.
 * This script exists to make the corpus, to show the whole table at once, and to
 * put that table in the CI job summary where somebody will actually read it.
 *
 * Its counterpart is `tools/perf-guard.mjs`, and they answer different
 * questions. The guard asserts RATIOS between microbenchmarks — architectural
 * invariants like "editing one UI field is far cheaper than adding a node" — and
 * its numbers are a snapshot you accept with `--update`. This asserts CEILINGS
 * on whole operations at a size no example reaches, and its numbers are not
 * acceptable by the change that breaks them.
 *
 *   node tools/perf-budget.mjs            generate if needed, measure, gate
 *   node tools/perf-budget.mjs --table    print the last run's table only
 *   node tools/perf-budget.mjs --regen    force the corpus to be rebuilt
 */

import { existsSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { generateStressProject, countAssets } from './stress-project.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'build', 'scale-report.json');

const argv = process.argv.slice(2);

if (argv.includes('--table')) {
    if (!existsSync(REPORT)) {
        console.error('perf-budget: no report yet — run `node tools/perf-budget.mjs` first.');
        process.exit(1);
    }
    printTable(JSON.parse(readFileSync(REPORT, 'utf8')));
    process.exit(0);
}

const corpus = await generateStressProject({
    force: argv.includes('--regen'),
    log: (m) => console.log(m),
});
if (corpus.assets !== countAssets(1)) {
    console.error(`perf-budget: the corpus holds ${corpus.assets} assets, not ${countAssets(1)}.`
        + ' Budgets are calibrated against the full corpus and mean nothing against a smaller one.');
    process.exit(1);
}

// A report left by an earlier run would be read as this one's if the suite died
// before writing anything.
rmSync(REPORT, { force: true });

const run = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.scale.config.ts'], {
    cwd: join(ROOT, 'desktop'),
    stdio: 'inherit',
    env: { ...process.env, ESTELLA_STRESS_PROJECT: corpus.dir },
});

if (!existsSync(REPORT)) {
    console.error('perf-budget: the scale suite produced no report — it did not reach a single metric.');
    process.exit(1);
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
printTable(report);
summarise(report);
process.exit(run.status ?? 1);

// ---------------------------------------------------------------------------

function printTable(report) {
    const { units, metrics } = report;
    console.log('');
    console.log(`Scale budgets — ${countAssets(1).toLocaleString('en-US')} assets`);
    console.log(`  one unit on this machine:  ${Object.entries(units ?? {})
        .map(([k, v]) => `${k} ${v.toFixed(2)}ms`).join('   ')}`);
    console.log('');

    let group = null;
    for (const m of metrics) {
        if (m.group !== group) {
            group = m.group;
            console.log(`  ${group}`);
        }
        const bar = meter(m.pctOfBudget);
        const raw = m.rawMs === null ? '' : `  (${fmt(m.rawMs)}ms)`;
        console.log(`    ${status(m.pctOfBudget)} ${m.name.padEnd(52)}`
            + `${String(m.measured).padStart(9)} / ${String(m.budget).padEnd(6)}${unitName(m.unit).padEnd(6)}`
            + ` ${bar} ${String(m.pctOfBudget).padStart(3)}%${raw}`);
    }
    console.log('');

    const over = metrics.filter((m) => m.pctOfBudget > 100);
    const near = metrics.filter((m) => m.pctOfBudget > 70 && m.pctOfBudget <= 100);
    if (over.length) console.log(`  ${over.length} over budget.`);
    // Not a failure, and worth saying out loud: a metric drifting into its
    // headroom is the only warning anybody gets before it stops being headroom.
    if (near.length) console.log(`  ${near.length} above 70% of budget — headroom is going.`);
    if (!over.length && !near.length) console.log('  All within budget, none above 70%.');
    console.log('');
}

/** The same table as markdown, for the GitHub job summary. */
function summarise(report) {
    const out = process.env.GITHUB_STEP_SUMMARY;
    if (!out) return;
    const lines = [
        `### Scale budgets — ${countAssets(1).toLocaleString('en-US')} assets`,
        '',
        `Calibration on this runner: ${Object.entries(report.units ?? {})
            .map(([k, v]) => `\`${k}\` ${v.toFixed(2)}ms`).join(', ')}`,
        '',
        '| | metric | measured | budget | used | on this runner |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
    ];
    for (const m of report.metrics) {
        lines.push(`| ${m.pctOfBudget > 100 ? '❌' : m.pctOfBudget > 70 ? '⚠️' : '✅'} | ${m.name}`
            + ` | ${m.measured} ${unitName(m.unit)} | ${m.budget} ${unitName(m.unit)}`
            + ` | ${m.pctOfBudget}% | ${m.rawMs === null ? '—' : `${fmt(m.rawMs)}ms`} |`);
    }
    appendFileSync(out, `${lines.join('\n')}\n`);
}

// Declarations, not consts: printTable runs at module top level (above), so an
// arrow bound down here would still be in its temporal dead zone.
function unitName(u) { return u === 'MB' ? 'MB' : u === 'count' ? '' : u; }
function fmt(n) { return n >= 100 ? n.toFixed(0) : n.toFixed(1); }
function status(pct) { return pct > 100 ? 'FAIL' : pct > 70 ? 'near' : '  ok'; }

function meter(pct) {
    const width = 20;
    // Clamped at BOTH ends: a measurement can legitimately come out negative (a
    // heap that shrank), and an unclamped bar threw a RangeError instead of
    // printing which measurement it was.
    const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
    return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}
