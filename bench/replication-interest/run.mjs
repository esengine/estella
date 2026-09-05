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

const ARMS = ['A', 'B'];
const ARM_MEANING = {
    A: 'as shipped: anchors, radius and ownership all scan every candidate',
    B: 'ownership index: only the two owner passes change',
};
/** 100k stops at 32 connections: arm A there is already 30 billion visits. */
const POINTS = QUICK
    ? [[10000, 1], [10000, 8]]
    : [[10000, 1], [10000, 8], [10000, 32], [10000, 128],
        [100000, 1], [100000, 8], [100000, 32]];
const FIXED = {
    anchors: 1, visible: 0.01, movement: 0.01,
    simHz: 60, replHz: 20, warmup: QUICK ? 12 : 60, measure: QUICK ? 30 : 120,
};
const VERIFY_POINTS = QUICK ? [[10000, 8]] : [[10000, 8], [10000, 128], [100000, 8]];

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
const total = POINTS.length * ARMS.length + VERIFY_POINTS.length;
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
    const { result, fresh } = measure('B', entities, connections, true);
    process.stderr.write(`[${++done}/${total}] differential  ${entities}  ${connections} conn`
        + `${fresh ? '' : '  (cached)'}\n`);
    verifies.push(result);
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
say(clean
    ? `  DIFFERENTIAL: B saw exactly what A saw, every connection, every sample (${verifies.length} point(s)).`
    : '  DIFFERENTIAL: MISMATCHED — the ownership index changed what a connection sees.');
say('');
say('  us per simulated second, and the share of one core');
say('      pop    conn  arm       total  1 core   anchor    radius     owner    B/A');
for (const [entities, connections] of POINTS) {
    const a = at('A', entities, connections);
    for (const arm of ARMS) {
        const p = at(arm, entities, connections);
        const s = p.segmentUsPerSimSecond;
        const ratio = arm === 'B' ? (p.totalUsPerSimSecond / a.totalUsPerSimSecond).toFixed(2) : '—';
        say(`   ${pad(entities, 7)} ${pad(connections, 5)}    ${arm} ${pad(round(p.totalUsPerSimSecond), 11)}`
            + ` ${pad(`${(p.totalUsPerSimSecond / 1e4).toFixed(0)}%`, 7)}`
            + ` ${pad(round(s.anchor), 8)} ${pad(round(s.radius), 9)} ${pad(round(s.owner), 9)} ${pad(ratio, 6)}`);
    }
}
say('');
say('  entities visited per sample (the mechanism, without this machine in it)');
say('      pop    conn  arm     anchor     radius      owner   distance');
for (const [entities, connections] of POINTS) {
    for (const arm of ARMS) {
        const v = at(arm, entities, connections).visitedPerSample;
        say(`   ${pad(entities, 7)} ${pad(connections, 5)}    ${arm} ${pad(round(v.anchor), 10)}`
            + ` ${pad(round(v.radius), 10)} ${pad(round(v.owner), 10)} ${pad(round(v.distanceTests), 10)}`);
    }
}
say('');
say('--- WHAT THIS DECOMPOSES ---');
say('  anchor  finding the entities this connection owns, to place its view');
say('  radius  testing every candidate against those anchors');
say('  owner   the server putting owned entities back, not trusting the policy');
say('');
say('  anchor and owner are the same question asked twice, both O(population).');
say('  B answers it from an index and changes nothing else — so B/A is the price');
say('  of NOT having one, and what is left in B is the spatial problem alone.');

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
