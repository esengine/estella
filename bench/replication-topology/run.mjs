// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Does a topology journal beat re-reading the world every sample?
 *
 * The dirty probe answered the FIELD question. This one asks the registry
 * question: `reconcileRegistry_()` reads every replicated entity and walks the
 * whole registry, every sample, whether or not anything entered or left.
 *
 *   node bench/replication-topology/run.mjs
 *   node bench/replication-topology/run.mjs --quick
 *
 * Ships nothing: production still runs the full reconcile.
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
const BIG = process.argv.includes('--big');

const ARMS = ['A', 'B', 'C'];
const ARM_MEANING = {
    A: 'full reconcile           (today\'s production)',
    B: 'journal written, full reconcile (the write tax, alone)',
    C: 'journal + incremental    (the candidate architecture)',
};
const ENTITY_COUNTS = QUICK ? [1000] : BIG ? [500000] : [10000, 100000];
/** 0 first, and it is the point: a registry that moved nothing still costs O(E). */
const CHURN_RATES = QUICK ? [0, 0.01] : [0, 0.0001, 0.001, 0.01, 0.1];
const FIXED = { simHz: 60, replHz: 20, warmup: QUICK ? 60 : 180, measure: QUICK ? 180 : 600 };
const VERIFY_POINTS = QUICK ? [[1000, 0.01]]
    : BIG ? [[500000, 0.001]]
        : [[10000, 0], [10000, 0.001], [10000, 0.1], [100000, 0.001]];

const CACHE = path.join(HERE, `.sweep-${QUICK ? 'quick' : BIG ? 'big' : 'matrix'}.jsonl`);
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

function buildSdkOnce() {
    const built = spawnSync('pnpm', ['--filter', './sdk', 'build'],
        { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (built.status !== 0) {
        console.error(built.stderr || built.stdout);
        throw new Error('the SDK build failed; nothing was measured');
    }
}

function runPoint(arm, entities, churn, verify) {
    const args = [
        ARM, '--arm', arm, '--entities', String(entities), '--churn', String(churn),
        '--simHz', String(FIXED.simHz), '--replHz', String(FIXED.replHz),
        '--warmup', String(FIXED.warmup), '--measure', String(FIXED.measure),
    ];
    if (verify) args.push('--verify');
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (run.status !== 0) {
        console.error(run.stderr || run.stdout);
        throw new Error(`arm ${arm} @ ${entities}/${churn} exited ${run.status}`);
    }
    return JSON.parse(run.stdout);
}

const measured = loadCache();

function measure(arm, entities, churn, verify) {
    const key = `${arm}/${entities}/${churn}/${verify ? 'v' : 'p'}`;
    const cached = measured.get(key);
    if (cached) return { result: cached, fresh: false };
    const result = runPoint(arm, entities, churn, verify);
    appendFileSync(CACHE, `${JSON.stringify({ build: buildId(), key, result })}\n`);
    measured.set(key, result);
    return { result, fresh: true };
}

buildSdkOnce();

const points = [];
const total = ENTITY_COUNTS.length * CHURN_RATES.length * ARMS.length + VERIFY_POINTS.length;
let done = 0;
for (const entities of ENTITY_COUNTS) {
    for (const churn of CHURN_RATES) {
        for (const arm of ARMS) {
            const { result, fresh } = measure(arm, entities, churn, false);
            process.stderr.write(`[${++done}/${total}] arm ${arm}  ${entities}  `
                + `${churn * 100}% churn${fresh ? '' : '  (cached)'}\n`);
            points.push(result);
        }
    }
}

const verifies = [];
for (const [entities, churn] of VERIFY_POINTS) {
    const { result, fresh } = measure('C', entities, churn, true);
    process.stderr.write(`[${++done}/${total}] differential  ${entities}  `
        + `${churn * 100}% churn${fresh ? '' : '  (cached)'}\n`);
    verifies.push(result);
}

const at = (arm, entities, churn) =>
    points.find((p) => p.arm === arm && p.entities === entities && p.churn === churn);
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

say('=== replication registry: full reconcile vs topology journal ===');
say('');
for (const arm of ARMS) say(`  ${arm}  ${ARM_MEANING[arm]}`);
say('');

const clean = verifies.every((v) => v.mismatches === 0);
say(clean
    ? `  DIFFERENTIAL: the incremental registry matched the full scan at every sample`
      + ` (${verifies.length} point(s)).`
    : `  DIFFERENTIAL: MISMATCHED — the incremental registry disagreed with the full scan.`
      + ' It MUST NOT SHIP whatever the timings say.');
say('');

const pad = (v, w) => String(v).padStart(w);
const round = (v) => Math.round(v);
for (const entities of ENTITY_COUNTS) {
    for (const churn of CHURN_RATES) {
        say(`  ${entities} entities · ${churn * 100}% membership churn per sample`);
        say('      arm    write      sample       total  1 core     B/A    C/B    C/A   visited/sample');
        const a = at('A', entities, churn);
        const b = at('B', entities, churn);
        for (const arm of ARMS) {
            const p = at(arm, entities, churn);
            const ratio = (x, y) => (y > 0 ? (x / y).toFixed(2) : '—');
            const cols = arm === 'A' ? ['—', '—', '—']
                : arm === 'B' ? [ratio(p.totalTaxUsPerSimSecond, a.totalTaxUsPerSimSecond), '—', '—']
                    : ['—', ratio(p.totalTaxUsPerSimSecond, b.totalTaxUsPerSimSecond),
                        ratio(p.totalTaxUsPerSimSecond, a.totalTaxUsPerSimSecond)];
            const core = `${(p.totalTaxUsPerSimSecond / 1e4).toFixed(1)}%`;
            say(`      ${arm}   ${pad(round(p.writeTaxUsPerSimSecond), 8)} ${pad(round(p.sampleTaxUsPerSimSecond), 11)}`
                + ` ${pad(round(p.totalTaxUsPerSimSecond), 11)} ${pad(core, 7)}`
                + `  ${pad(cols[0], 6)} ${pad(cols[1], 6)} ${pad(cols[2], 6)}`
                + `  ${pad(round(p.visitedPerSample), 14)}`);
        }
        say('');
    }
}

say('--- WHAT THE THREE RATIOS ASK ---');
say('  B/A  what does keeping the journal cost, alone? It is written only when a');
say('       membership moves, never per field write — so this should be near 1.');
say('  C/B  having paid that, how much of the O(E) reconcile disappears?');
say('  C/A  is the whole thing worth switching production to?');
say('');
say('  The 0% row is the one that decides it: a registry where nothing entered or');
say('  left still reads every replicated entity today.');

const out = path.join(HERE, QUICK ? 'results.quick.json' : BIG ? 'results.big.json' : 'results.json');
const machine = {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    totalMemGB: Math.round(os.totalmem() / 1024 ** 3),
    ranAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify({
    machine, build: sdkIdentity(ROOT), fixed: FIXED, points, verifies, differentialClean: clean,
}, null, 2)}\n`);
say('');
say(`raw results: ${path.relative(ROOT, out)}`);
