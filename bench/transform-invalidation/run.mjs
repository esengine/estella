// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What one Transform write costs when it also has to say it happened.
 *
 *   node bench/transform-invalidation/run.mjs
 *
 * Ships nothing: no production path notifies anything yet.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkIdentity } from '../replication-dirty/workload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARM = path.join(HERE, 'arm.mjs');
const ARMS = ['A', 'B', 'C', 'D'];
const MEANING = {
    A: 'the write path as it is',
    B: 'a monotonic epoch in the wasm heap',
    C: 'a dirty flag in the wasm heap',
    D: 'an ABI call across the boundary',
};
const SIZES = [1000, 10000, 100000];

function run(arm, entities, extra = []) {
    const out = spawnSync(process.execPath, [
        ARM, '--arm', arm, '--entities', String(entities),
        '--warmup', '10', '--measure', '40', ...extra,
    ], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
    if (out.status !== 0) {
        console.error(out.stderr || out.stdout);
        throw new Error(`arm ${arm} @ ${entities} exited ${out.status}`);
    }
    return JSON.parse(out.stdout);
}

const points = [];
for (const entities of SIZES) for (const arm of ARMS) points.push(run(arm, entities));
const still = ARMS.slice(0, 3).map((arm) => run(arm, 100000, ['--still']));

const say = (s = '') => console.log(s);
const pad = (v, w) => String(v).padStart(w);
say('');
say('=== what it costs to say a Transform moved ===');
say('');
for (const arm of ARMS) say(`  ${arm}  ${MEANING[arm]}`);
say('');
const unverified = [...points, ...still].filter((p) => !p.notified);
say(unverified.length === 0
    ? '  Every arm\'s notification landed: the epoch advanced once per write.'
    : `  UNVERIFIED: ${unverified.length} point(s) did not notify — the numbers mean nothing.`);
say('');
say('      entities  arm   ns/write   1 core @60Hz    vs A');
for (const entities of SIZES) {
    const a = points.find((p) => p.arm === 'A' && p.entities === entities);
    for (const arm of ARMS) {
        const p = points.find((q) => q.arm === arm && q.entities === entities);
        const ratio = arm === 'A' ? '—' : (p.nsPerWrite / a.nsPerWrite).toFixed(2);
        say(`   ${pad(entities, 9)}  ${arm}   ${pad(p.nsPerWrite.toFixed(2), 8)}   ${pad(`${p.oneCorePercent.toFixed(1)}%`, 12)}  ${pad(ratio, 6)}`);
    }
}
say('');
say('  100k writes with no semantic movement (every write still notifies):');
for (const p of still) say(`      ${p.arm}   ${p.nsPerWrite.toFixed(2)} ns/write`);
say('');
say('  A store into linear memory does not show up beside the write it follows.');
say('  An ABI call for one integer does. Epoch and dirty-bit cost the same, so');
say('  the choice between them is about what is easier to reason about.');
say('');
say(`  ${JSON.stringify({ ...sdkIdentity(ROOT), cpu: os.cpus()[0]?.model })}`);
