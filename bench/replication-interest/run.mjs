// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where the interest path's C × E actually goes.
 *
 * Decomposition, not optimisation: production is untouched. This reproduces
 * `sampleWithInterest_` segment by segment so each pass can be timed and counted
 * on its own, and adds ONE alternative — an ownership index — to price the two
 * passes that exist only to answer "what does this connection own".
 *
 *   node bench/replication-interest/run.mjs
 *   node bench/replication-interest/run.mjs --quick
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

const ARMS = ['B', 'C0', 'C1', 'D1'];
const ARM_MEANING = {
    B: 'as shipped: every connection reads every candidate\'s position',
    C0: 'positions read once per sample, cached; same full walk',
    C1: 'grid rebuilt per sample; only nearby cells are walked',
    D1: 'the same grid, KEPT — only the entities the composition says moved',
};
/** Arm B reads a builtin position per candidate per connection, so 100k x 32 is
 *  already 50 seconds of work per simulated second. Points stay few. */
const POINTS = QUICK
    ? [[10000, 8]]
    : [[10000, 8], [10000, 32], [100000, 8], [100000, 32]];
const FIXED = {
    anchors: 1, visible: 0.01, movement: 0.01,
    simHz: 60, replHz: 20, warmup: QUICK ? 4 : 6, measure: QUICK ? 9 : 18,
};
const VERIFY_POINTS = QUICK ? [[10000, 8]] : [[10000, 8], [10000, 32], [100000, 8]];
/** The arms whose answer has to be checked against the full scan's, not just timed. */
const VERIFY_ARMS = ['C1', 'D1'];

const CACHE = path.join(HERE, `.sweep-${QUICK ? 'quick' : 'matrix'}.jsonl`);
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

function runPoint(arm, entities, connections, verify) {
    const args = [
        ARM, '--arm', arm, '--entities', String(entities), '--connections', String(connections),
        '--anchors', String(FIXED.anchors), '--visible', String(FIXED.visible),
        '--movement', String(FIXED.movement), '--simHz', String(FIXED.simHz),
        '--replHz', String(FIXED.replHz), '--warmup', String(FIXED.warmup),
        '--measure', String(FIXED.measure),
    ];
    if (verify) args.push('--verify');
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (run.status !== 0) {
        console.error(run.stderr || run.stdout);
        throw new Error(`arm ${arm} @ ${entities}/${connections} exited ${run.status}`);
    }
    return JSON.parse(run.stdout);
}

const measured = loadCache();
function measure(arm, entities, connections, verify) {
    const key = `${arm}/${entities}/${connections}/${verify ? 'v' : 'p'}`;
    const cached = measured.get(key);
    if (cached) return { result: cached, fresh: false };
    const result = runPoint(arm, entities, connections, verify);
    appendFileSync(CACHE, `${JSON.stringify({ build: buildId(), key, result })}\n`);
    measured.set(key, result);
    return { result, fresh: true };
}

buildSdkOnce();

const points = [];
const total = POINTS.length * ARMS.length + VERIFY_POINTS.length * VERIFY_ARMS.length;
let done = 0;
for (const [entities, connections] of POINTS) {
    for (const arm of ARMS) {
        const { result, fresh } = measure(arm, entities, connections, false);
        process.stderr.write(`[${++done}/${total}] arm ${arm}  ${entities}  ${connections} conn`
            + `${fresh ? '' : '  (cached)'}\n`);
        points.push(result);
    }
}
const verifies = [];
for (const [entities, connections] of VERIFY_POINTS) {
    for (const arm of VERIFY_ARMS) {
        const { result, fresh } = measure(arm, entities, connections, true);
        process.stderr.write(`[${++done}/${total}] differential ${arm}  ${entities}  ${connections} conn`
            + `${fresh ? '' : '  (cached)'}\n`);
        verifies.push(result);
    }
}

const at = (arm, e, c) => points.find((p) => p.arm === arm && p.entities === e && p.connections === c);
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const round = (v) => Math.round(v);
const pad = (v, w) => String(v).padStart(w);

say('=== interest path: where C x E goes ===');
say('');
for (const arm of ARMS) say(`  ${arm}  ${ARM_MEANING[arm]}`);
say('');
const clean = verifies.every((v) => v.mismatches === 0);
const stranded = verifies.concat(points).reduce((n, v) => n + (v.visitedPerSample?.unindexed ?? 0), 0);
say(clean
    ? `  DIFFERENTIAL: both grids saw exactly what the full scan saw, every connection,`
      + ` every sample (${verifies.length} point(s)).`
    : '  DIFFERENTIAL: MISMATCHED — a grid changed what a connection sees.');
say(stranded === 0
    ? '  Every entity the composition reported was one the kept grid knew about.'
    : `  ${stranded} reported entit(ies) were not in the kept grid — it is missing rows.`);
// The kept grid against a rebuilt one, which is the claim it makes: a cell that
// drifted only reaches the visible-set check if it changes somebody's view.
const drifts = points.concat(verifies).map((p) => p.drift).filter(Boolean);
const drifted = drifts.reduce((n, d) => n + d.position + d.cell + d.missing + d.extra, 0);
say(drifts.length === 0 ? '  NO KEPT GRID WAS COMPARED against a rebuilt one.'
    : drifted === 0
        ? `  The kept grid held exactly what a rebuilt one would, at ${drifts.length} point(s).`
        : `  The kept grid DRIFTED from a rebuilt one: ${drifted} entr(ies) across ${drifts.length} point(s).`);
say('');
say('  us per simulated second, and the share of one core');
say('      pop    conn  arm       total  1 core    build    radius   vs B');
for (const [entities, connections] of POINTS) {
    const b = at('B', entities, connections);
    for (const arm of ARMS) {
        const p = at(arm, entities, connections);
        const s = p.segmentUsPerSimSecond;
        const ratio = arm === 'B' ? '—' : (p.totalUsPerSimSecond / b.totalUsPerSimSecond).toFixed(3);
        say(`   ${pad(entities, 7)} ${pad(connections, 5)}   ${pad(arm, 2)} ${pad(round(p.totalUsPerSimSecond), 11)}`
            + ` ${pad(`${(p.totalUsPerSimSecond / 1e4).toFixed(0)}%`, 7)}`
            + ` ${pad(round(s.build), 8)} ${pad(round(s.radius), 9)} ${pad(ratio, 6)}`);
    }
}
say('');
say('  visits per sample (the mechanism, without this machine in it)');
say('      pop    conn  arm   posReads      cells  spatialCand   distTests');
for (const [entities, connections] of POINTS) {
    for (const arm of ARMS) {
        const v = at(arm, entities, connections).visitedPerSample;
        say(`   ${pad(entities, 7)} ${pad(connections, 5)}   ${pad(arm, 2)} ${pad(round(v.positionReads), 10)}`
            + ` ${pad(round(v.cells), 10)} ${pad(round(v.spatialCandidates), 12)} ${pad(round(v.distanceTests), 11)}`);
    }
}
say('');
say('--- WHAT THIS SEPARATES ---');
say('  C0/B   reading each position ONCE per sample instead of once per connection');
say('  C1/C0  spatial locality on top of that');
say('  build  the price of rebuilding, paid every sample whatever moved');
say('');
say('  Rebuilding is what lets this support an arbitrary position() function:');
say('  nothing is carried between samples, so there is no invalidation to get');
say('  wrong. What an incremental index would buy is the build column alone.');

const out = path.join(HERE, QUICK ? 'results.quick.json' : 'results.json');
writeFileSync(out, `${JSON.stringify({
    machine: {
        node: process.version, platform: `${os.platform()} ${os.release()}`,
        cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length,
        ranAt: new Date().toISOString(),
    },
    build: sdkIdentity(ROOT), fixed: FIXED, points, verifies, differentialClean: clean,
}, null, 2)}\n`);
say('');
say(`raw results: ${path.relative(ROOT, out)}`);
