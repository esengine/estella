// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where the interest SEND path's C x E goes, now that visibility is local.
 *
 *   node bench/replication-routing/run.mjs
 *   node bench/replication-routing/run.mjs --quick
 *
 * Decomposition, not optimisation: this drives the real server and changes
 * nothing. The two axes are swept apart rather than crossed, because what is
 * being asked is which of them is a wall, not how they interact.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkIdentity } from '../replication-interest/workload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARM = path.join(HERE, 'arm.mjs');
const QUICK = process.argv.includes('--quick');

/** The workload the provider was confirmed on, frozen. */
const FIXED = {
    entities: QUICK ? 20000 : 100000,
    connections: QUICK ? 8 : 32,
    visible: 0.01,
    movement: 0.01,
    warmup: QUICK ? 6 : 10,
    measure: QUICK ? 12 : 30,
};

/**
 * The floor first. If what is left with nothing moving is O(C x V), halving what
 * a connection sees halves it — so the shape is asked directly rather than
 * attributed by a timer inside the server.
 */
const FLOOR_POINTS = [
    { name: 'still — nothing moves at all', dirty: 0, removals: 0, movement: 0 },
    { name: 'still, 0.25% visible', dirty: 0, removals: 0, movement: 0, visible: 0.0025 },
    { name: 'still, 0.5% visible', dirty: 0, removals: 0, movement: 0, visible: 0.005 },
    { name: 'still, 2% visible', dirty: 0, removals: 0, movement: 0, visible: 0.02 },
    { name: 'still, 8 connections', dirty: 0, removals: 0, movement: 0, connections: 8 },
    { name: 'still, 16 connections', dirty: 0, removals: 0, movement: 0, connections: 16 },
    { name: 'still, quarter the population', dirty: 0, removals: 0, movement: 0, entities: 25000, visible: 0.036 },
];

const POINTS = [
    { name: 'floor — nothing dirty, nothing removed', dirty: 0, removals: 0 },
    { name: 'dirty 0.1%', dirty: 0.001, removals: 0 },
    { name: 'dirty 1%', dirty: 0.01, removals: 0 },
    { name: 'dirty 10%', dirty: 0.1, removals: 0 },
    { name: 'dirty 100%', dirty: 1, removals: 0 },
    { name: 'removals 0.1%', dirty: 0, removals: 0.001 },
    { name: 'removals 1%', dirty: 0, removals: 0.01 },
    { name: 'removals 10%', dirty: 0, removals: 0.1 },
    { name: 'mixed — 1% dirty, 0.1% removed', dirty: 0.01, removals: 0.001 },
    { name: 'mixed, connections packed together', dirty: 0.01, removals: 0.001, cluster: 0.001 },
];

function run(p) {
    const out = spawnSync(process.execPath, [
        ARM, '--entities', String(p.entities ?? FIXED.entities),
        '--connections', String(p.connections ?? FIXED.connections),
        '--visible', String(p.visible ?? FIXED.visible),
        '--movement', String(p.movement ?? FIXED.movement),
        '--dirty', String(p.dirty), '--removals', String(p.removals),
        '--cluster', String(p.cluster ?? 1),
        '--warmup', String(FIXED.warmup), '--measure', String(FIXED.measure),
    ], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (out.status !== 0) {
        console.error(out.stderr || out.stdout);
        throw new Error(`${p.name} exited ${out.status}`);
    }
    return JSON.parse(out.stdout);
}

const all = [...FLOOR_POINTS, ...POINTS];
const measured = new Map();
for (const [i, p] of all.entries()) {
    process.stderr.write(`[${i + 1}/${all.length}] ${p.name}\n`);
    measured.set(p, run(p));
}
const floorRows = FLOOR_POINTS.map((p) => ({ p, r: measured.get(p) }));
const rows = POINTS.map((p) => ({ p, r: measured.get(p) }));

const say = (s = '') => console.log(s);
const pad = (v, w) => String(v).padStart(w);
const round = (v) => Math.round(v);
const ratio = (a, b) => (b > 0 ? `${Math.round(a / b)}:1` : '—');

say('');
say(`=== the interest send path (${FIXED.entities} entities, ${FIXED.connections} connections,`
    + ` ${FIXED.visible * 100}% visible) ===`);
say('');
const floor = rows[0].r;
say('  the FLOOR with nothing moving: visibility bookkeeping and the enter/leave diff');
say('  workload                                   us/sample  1 core    C x V    us per C x V');
for (const { p, r } of floorRows) {
    const cv = r.visiblePerConnection * r.connections;
    say(`  ${p.name.padEnd(42)} ${pad(round(r.usPerSampleMin), 8)} ${pad(`${r.oneCorePercentMin.toFixed(0)}%`, 7)}`
        + ` ${pad(round(cv), 8)} ${pad((r.usPerSampleMin / cv).toFixed(3), 15)}`);
}
say('');
// The FASTEST measured sample, not the mean: a neighbouring process only ever
// makes one slower, and the fastest reproduces to the microsecond between runs
// where the mean moves by 5%.
say('  us per sample (fastest), and the share of one core at 60 samples a second');
say('  workload                                   us/sample  1 core   over floor');
for (const { p, r } of rows) {
    const over = r === floor ? '—' : `+${round(r.usPerSampleMin - floor.usPerSampleMin)}`;
    say(`  ${p.name.padEnd(42)} ${pad(round(r.usPerSampleMin), 8)} ${pad(`${r.oneCorePercentMin.toFixed(0)}%`, 7)} ${pad(over, 11)}`);
}
say('');
say('  what the two filters VISIT, and what survives them (per sample)');
say('  workload                                   D rows   C x D    sent   ratio');
for (const { p, r } of rows) {
    say(`  ${p.name.padEnd(42)} ${pad(round(r.dirtyRows), 6)} ${pad(round(r.dirtyVisits), 8)} ${pad(round(r.dirtySent), 7)}  ${pad(ratio(r.dirtyVisits, r.dirtySent), 6)}`);
}
say('');
say('  workload                                   R rows   C x R    sent   ratio');
for (const { p, r } of rows) {
    say(`  ${p.name.padEnd(42)} ${pad(round(r.removalRows), 6)} ${pad(round(r.removalVisits), 8)} ${pad(round(r.removalSent), 7)}  ${pad(ratio(r.removalVisits, r.removalSent), 6)}`);
}
say('');
say('  what a router would have to know');
say('  workload                                   V/conn    C x V  viewers/e   enters   leaves');
for (const { p, r } of rows) {
    say(`  ${p.name.padEnd(42)} ${pad(round(r.visiblePerConnection), 6)}`
        + ` ${pad(round(r.visiblePerConnection * r.connections), 8)}`
        + ` ${pad(r.viewersPerViewedEntity.toFixed(2), 10)} ${pad(round(r.entersPerSample), 8)} ${pad(round(r.leavesPerSample), 8)}`);
}
say('');
say('  D rows is every row the server has to route, not the knob that was turned:');
say('  moving an entity dirties it, and so does giving a removed component back.');
say('');
say(`  ${JSON.stringify({ ...sdkIdentity(ROOT), cpu: os.cpus()[0]?.model })}`);
