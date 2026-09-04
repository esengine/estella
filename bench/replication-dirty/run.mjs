// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The four-arm dirty-oracle probe. Runs every arm at every workload
 *        point in its OWN process, then reports two verdicts that are not the
 *        same question:
 *
 *          correctness — did the tracker name every change a full scan found?
 *          performance — total replication tax per simulated second
 *
 *        A failing correctness verdict disqualifies the mechanism whatever the
 *        performance says, and the report prints it that way.
 *
 * This probe SHIPS NOTHING. It does not touch the replication layer; it
 * reproduces the production sampling loop so the arms can differ in exactly one
 * mechanism. Deciding what to do about the numbers is a later change.
 *
 *   node bench/replication-dirty/run.mjs [--quick]
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkIdentity } from './workload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARM = path.join(HERE, 'arm.mjs');
const QUICK = process.argv.includes('--quick');
// The crossover sweep: where does the candidate architecture stop paying? Two
// sizes worth running and seven dirty rates, with this HEAD's OWN 1% and 100%
// anchors — a curve must not be spliced from two different builds.
const CROSSOVER = process.argv.includes('--crossover');

// D is a counterfactual ceiling and PR6b already disqualified it: the tracker is
// not an authority, so shadow verify stays. It is not run in the sweep.
const ARMS = CROSSOVER ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
const ARM_MEANING = {
    A: 'tracking OFF, full shadow      (today\'s production)',
    B: 'tracking ON,  full shadow      (the write tax, alone)',
    C: 'tracking ON,  candidates+verify(the candidate architecture)',
    D: 'tracking ON,  candidates only  (COUNTERFACTUAL CEILING)',
};
const ENTITY_COUNTS = QUICK ? [1000] : CROSSOVER ? [10000, 100000] : [1000, 10000, 100000];
const DIRTY_RATES = CROSSOVER ? [0.01, 0.3, 0.5, 0.7, 0.85, 0.95, 1] : [0, 0.01, 1];
const FIXED = {
    simHz: 60, replHz: 20,
    warmup: QUICK ? 60 : 300,
    measure: QUICK ? 240 : 1200,
};

/**
 * Recall is a logical property of the write paths, not of scale, so it is not
 * run at every point — but it IS run at the target workload's full size, where
 * a scale-dependent surprise would live if there were one.
 */
const VERIFY_POINTS = QUICK
    ? [[1000, 0.01]]
    : CROSSOVER
        ? [[10000, 0.3], [10000, 0.95], [100000, 0.5]]
        : [[1000, 0], [1000, 0.01], [1000, 1], [10000, 0], [10000, 0.01], [10000, 1], [100000, 0.01]];

/**
 * Build the SDK once, here, rather than letting 42 workers each discover the
 * artifact is stale. The arms still refuse a stale one on their own — this is
 * the convenience, that is the guard.
 */
function buildSdkOnce() {
    const built = spawnSync('pnpm', ['--filter', './sdk', 'build'],
        { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (built.status !== 0) {
        console.error(built.stderr || built.stdout);
        throw new Error('the SDK build failed; nothing was measured');
    }
}

/**
 * Points already measured, by key, so an interrupted sweep resumes rather than
 * restarting 40+ minutes of separate processes. Keyed by the SDK artifact hash:
 * a rebuild starts a fresh sweep, because half a curve from one build and half
 * from another is not a curve.
 */
const CACHE = path.join(HERE, `.sweep-${CROSSOVER ? 'crossover' : 'matrix'}.jsonl`);
const buildId = () => sdkIdentity(ROOT).sdkArtifactSha256;

function loadCache() {
    const done = new Map();
    if (!existsSync(CACHE)) return done;
    for (const line of readFileSync(CACHE, 'utf8').split('\n').filter(Boolean)) {
        const row = JSON.parse(line);
        if (row.build !== buildId()) { unlinkSync(CACHE); return new Map(); }
        done.set(row.key, row.result);
    }
    return done;
}

function runPoint(arm, entities, dirty, verify) {
    const args = [
        ARM, '--arm', arm, '--entities', String(entities), '--dirty', String(dirty),
        '--simHz', String(FIXED.simHz), '--replHz', String(FIXED.replHz),
        '--warmup', String(FIXED.warmup), '--measure', String(FIXED.measure),
    ];
    if (verify) args.push('--verify');
    const started = Date.now();
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (run.status !== 0) {
        console.error(run.stderr || run.stdout);
        throw new Error(`arm ${arm} @ ${entities}/${dirty}${verify ? ' (verify)' : ''} exited ${run.status}`);
    }
    const result = JSON.parse(run.stdout);
    result.wallSeconds = (Date.now() - started) / 1000;
    return result;
}

const measured = loadCache();

/** One point, measured once per build however many times the sweep is restarted. */
function measure(arm, entities, dirty, verify) {
    const key = `${arm}/${entities}/${dirty}/${verify ? 'v' : 'p'}`;
    const cached = measured.get(key);
    if (cached) return { result: cached, fresh: false };
    const result = runPoint(arm, entities, dirty, verify);
    appendFileSync(CACHE, `${JSON.stringify({ build: buildId(), key, result })}\n`);
    measured.set(key, result);
    return { result, fresh: true };
}

buildSdkOnce();

const points = [];
const total = ENTITY_COUNTS.length * DIRTY_RATES.length * ARMS.length + VERIFY_POINTS.length;
let done = 0;

for (const entities of ENTITY_COUNTS) {
    for (const dirty of DIRTY_RATES) {
        for (const arm of ARMS) {
            const { result, fresh } = measure(arm, entities, dirty, false);
            process.stderr.write(`[${++done}/${total}] arm ${arm}  ${entities} entities  `
                + `${dirty * 100}% dirty${fresh ? '' : '  (cached)'}\n`);
            points.push(result);
        }
    }
}

const verifies = [];
for (const [entities, dirty] of VERIFY_POINTS) {
    const { result, fresh } = measure('C', entities, dirty, true);
    process.stderr.write(`[${++done}/${total}] recall  ${entities} entities  `
        + `${dirty * 100}% dirty${fresh ? '' : '  (cached)'}\n`);
    verifies.push(result);
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

const at = (arm, entities, dirty) =>
    points.find((p) => p.arm === arm && p.entities === entities && p.dirty === dirty);

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

say('=== four-arm dirty-oracle probe ===');
say(`sim ${FIXED.simHz}Hz · replication ${FIXED.replHz}Hz · warmup ${FIXED.warmup} · measure ${FIXED.measure} ticks`
    + ` · 4 replicated components/entity (3 mutated, 1 static)`);
say('');
for (const arm of ARMS) say(`  ${arm}  ${ARM_MEANING[arm]}`);
say('');

// --- correctness ---------------------------------------------------------
say('--- CORRECTNESS: did the tracker name every change a full scan found? ---');
let recallClean = true;
for (const v of verifies) {
    const miss = v.recall.missed;
    if (miss > 0) recallClean = false;
    say(`  ${String(v.entities).padStart(6)} ent · ${String(v.dirty * 100).padStart(3)}% dirty`
        + `   oracle ${String(v.recall.oracleEntries).padStart(9)}   missed ${String(miss).padStart(6)}`
        + `   ${miss === 0 ? 'complete' : 'INCOMPLETE'}`);
}
say('');

// Output parity: A, B and C claim to produce the same replication output.
const parity = [];
for (const entities of ENTITY_COUNTS) {
    for (const dirty of DIRTY_RATES) {
        const a = at('A', entities, dirty), b = at('B', entities, dirty), c = at('C', entities, dirty);
        const same = a.digest === b.digest && a.digest === c.digest;
        if (!same) parity.push({ entities, dirty, a: a.digest, b: b.digest, c: c.digest });
    }
}
say(parity.length === 0
    ? '  output parity A=B=C: identical at every point.'
    : `  output parity A=B=C: DIFFERS at ${parity.length} point(s) — ${JSON.stringify(parity)}`);
say('  (D is excluded: it emits unverified candidates, so a different digest is expected.)');
say('');

// --- performance ---------------------------------------------------------
say('--- PERFORMANCE: total replication tax (µs per simulated second) ---');
say('  write tax + sample tax. GC is inside those wall times already and is');
say('  reported beside them, never added.');
say('');
const pad = (v, w) => String(v).padStart(w);
const round = (v) => Math.round(v);
for (const entities of ENTITY_COUNTS) {
    for (const dirty of DIRTY_RATES) {
        say(`  ${entities} entities · ${dirty * 100}% dirty`);
        say(`      arm    write      sample       total  1 core     B/A    C/B    C/A    alloc KB/s   GC`);
        const a = at('A', entities, dirty);
        for (const arm of ARMS) {
            const p = at(arm, entities, dirty);
            const ratio = (x, y) => (y > 0 ? (x / y).toFixed(2) : '—');
            const b = at('B', entities, dirty), c = at('C', entities, dirty);
            const cols = arm === 'A' ? ['—', '—', '—']
                : arm === 'B' ? [ratio(p.totalTaxUsPerSimSecond, a.totalTaxUsPerSimSecond), '—', '—']
                    : arm === 'C' ? ['—', ratio(p.totalTaxUsPerSimSecond, b.totalTaxUsPerSimSecond), ratio(p.totalTaxUsPerSimSecond, a.totalTaxUsPerSimSecond)]
                        : ['—', '—', ratio(p.totalTaxUsPerSimSecond, a.totalTaxUsPerSimSecond)];
            // Per simulated second, so µs/s IS the share of one core: 1e6 = 100%.
            const core = `${(p.totalTaxUsPerSimSecond / 1e4).toFixed(1)}%`;
            say(`      ${arm}   ${pad(round(p.writeTaxUsPerSimSecond), 8)} ${pad(round(p.sampleTaxUsPerSimSecond), 11)} ${pad(round(p.totalTaxUsPerSimSecond), 11)} ${pad(core, 7)}`
                + `  ${pad(cols[0], 6)} ${pad(cols[1], 6)} ${pad(cols[2], 6)}`
                + `  ${pad(round(p.heapDeltaBytes / 1024 / p.simSeconds), 10)} ${pad(p.gcCount, 4)}`);
        }
        say('');
    }
}

say('--- WHAT THE THREE RATIOS ASK ---');
say('  B/A  what does turning tracking on cost the WRITE path, alone?');
say('  C/B  having paid that, how much scan does candidate pruning save?');
say('  C/A  is the whole architecture worth switching production to?');
say('');
say('  A crossover is NOT a per-frame switch. Tracking is enrollment, not a');
say('  sample-time flag: once a component is enrolled the write tax is paid');
say('  whatever the sampler then does, so a busy frame chooses between C and B,');
say('  never back to A. `if (dirty > x) fullScan()` does not recover A.');
say('  The question the sweep answers is whether a replicated component is');
say('  worth ENROLLING at all.');
say('');
say('  Read the tax beside the budget, not only the ratio: where both arms are');
say('  already past one core, C/A > 1 does not make A a usable option.');
say('');
say(recallClean
    ? 'RECALL: complete at every point measured.'
    : 'RECALL: INCOMPLETE — the tracker missed changes a full scan found.'
      + ' The candidate path MUST NOT SHIP whatever the timings say.');

// A quick run writes its own file: it is 1k-only and must never be mistaken
// for — or overwrite — the matrix everyone reads.
const out = path.join(HERE, QUICK ? 'results.quick.json'
    : CROSSOVER ? 'results.crossover.json' : 'results.json');
// A benchmark artifact that does not say what ran it is a number without units.
const machine = {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    totalMemGB: Math.round(os.totalmem() / 1024 ** 3),
    ranAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify({
    machine, build: sdkIdentity(ROOT), fixed: FIXED, points, verifies, parity, recallClean,
}, null, 2)}
`);
say('');
say(`raw results: ${path.relative(ROOT, out)}`);
