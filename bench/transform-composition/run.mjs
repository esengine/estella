// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What it costs for a composition to say which world transforms moved.
 *
 *   node bench/transform-composition/run.mjs
 *
 * Ships nothing: no production path asks for the changed set yet.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkIdentity } from '../replication-dirty/workload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARM = path.join(HERE, 'arm.mjs');
const ENTITIES = Number(process.env.BENCH_ENTITIES ?? 100000);

/** Each point says what moved, which is what makes the two set sizes mean something. */
const POINTS = [
    { shape: 'flat', mutate: 'none', rate: 0, says: 'nothing writes' },
    { shape: 'flat', mutate: 'still', rate: 0.01, says: '1% written, none of it moved' },
    { shape: 'flat', mutate: 'local', rate: 0.01, says: '1% moved' },
    { shape: 'flat', mutate: 'local', rate: 1, says: 'everything moved' },
    { shape: 'tree', mutate: 'local', rate: 0.01, says: '1% moved, in a 1000-root tree' },
    { shape: 'tree', mutate: 'parent', rate: 0.01, says: '1% of roots moved, subtrees follow' },
    { shape: 'tree', mutate: 'reparent', rate: 0, says: 'one subtree changes parent' },
];

function run(p) {
    const out = spawnSync(process.execPath, [
        ARM, '--shape', p.shape, '--mutate', p.mutate,
        '--entities', String(ENTITIES), '--rate', String(p.rate),
        '--warmup', '10', '--measure', '120',
    ], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (out.status !== 0) {
        console.error(out.stderr || out.stdout);
        throw new Error(`${p.shape}/${p.mutate} exited ${out.status}`);
    }
    return JSON.parse(out.stdout);
}

const rows = POINTS.map((p) => ({ p, r: run(p) }));

const say = (s = '') => console.log(s);
const pad = (v, w) => String(v).padStart(w);
say('');
say(`=== what it costs to also say WHICH world transforms moved (${ENTITIES} entities) ===`);
say('');
say('  A  compose, as it ships');
say('  B  the same compose, collecting the entities whose OUTPUT differs');
say('');
// Both arms drove the same mutation sequence, so they must have composed the
// same world. An arm that composed nothing would be the fastest one here.
// Measured apart, the two arms differed by more than the thing being measured.
say('  Both arms ran in one process, alternating passes over the same world.');
const wrong = rows.filter(({ r }) => !r.agrees);
say(wrong.length === 0
    ? '  Every point read back the world position it should have composed.'
    : `  WRONG WORLD at ${wrong.length} point(s) — the numbers mean nothing.`);
say('');
say('  workload                                          A us     B us   B/A   visited  changed');
for (const { p, r } of rows) {
    const name = `${p.shape}/${p.mutate} — ${p.says}`;
    const ratio = r.usA > 0 ? (r.usB / r.usA).toFixed(2) : '—';
    const visited = r.visited === null ? '—' : r.visited;
    const changed = r.changed === null ? '—' : r.changed;
    say(`  ${name.padEnd(46)} ${pad(r.usA.toFixed(1), 6)}  ${pad(r.usB.toFixed(1), 6)}  ${pad(ratio, 5)}  ${pad(visited, 8)} ${pad(changed, 8)}`);
}
say('');
const flat1 = rows.find(({ p }) => p.shape === 'flat' && p.mutate === 'local' && p.rate === 0.01).r;
say(`  At 1% movement the walk writes ${flat1.visited} and ${flat1.changed} of them actually moved:`);
say('  the set a consumer keyed on world position wants is the second one, and');
say('  nothing outside the composition can tell them apart without reading all of it.');
say('');
say(`  ${JSON.stringify({ ...sdkIdentity(ROOT), cpu: os.cpus()[0]?.model })}`);
