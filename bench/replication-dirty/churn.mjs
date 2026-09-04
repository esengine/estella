// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Does a tracker-backed consumer have a resource debt in TIME?
 *
 * The timing matrix runs a fixed population and would never see this. A world
 * that spawns, mutates and despawns forever is the ordinary case, and the
 * tracker keeps per-entity rows plus a removed-entity buffer that only shrinks
 * when a consumer calls `cleanRemovedBuffer`. If storage tracks total churn
 * since process start rather than the recent window, no speedup makes the
 * mechanism shippable.
 *
 * Two consumers, same workload:
 *   naive      — reads the tracker, never cleans   (what forgetting looks like)
 *   diligent   — cleans behind its own sample tick (what a consumer must do)
 *
 *   node bench/replication-dirty/churn.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSdk, defineWorkloadComponents } from './workload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

const LIVE = Number(flag('live', '2000'));       // steady-state population
const CHURN = Number(flag('churn', '50'));        // entities replaced per sim tick
const TICKS = Number(flag('ticks', '3000'));
const REPL_EVERY = 3;

const sdk = await loadSdk(ROOT);

async function run(label, clean) {
    const app = sdk.App.new();
    const world = app.world;
    const table = defineWorkloadComponents(sdk);
    for (const entry of table) world.enableChangeTracking(entry.def);

    const live = [];
    const spawnOne = (i) => {
        const e = world.spawn();
        world.insert(e, table[0].def, { x: i, y: 0, z: 0 });
        world.insert(e, table[1].def, { hp: 100, mp: 50 });
        return e;
    };
    for (let i = 0; i < LIVE; i++) live.push(spawnOne(i));

    const samples = [];
    let since = -1;
    let cursor = 0;

    for (let t = 0; t < TICKS; t++) {
        // Retire and replace a slice: population is constant, churn is not.
        for (let k = 0; k < CHURN; k++) {
            const slot = cursor % live.length;
            const old = live[slot];
            // A replicated component leaving, then the whole entity leaving —
            // both feed the removed buffer.
            if (world.has(old, table[1].def)) world.remove(old, table[1].def);
            world.despawn(old);
            live[slot] = spawnOne(t * CHURN + k);
            cursor++;
        }
        // And ordinary mutation on the survivors.
        for (let k = 0; k < CHURN; k++) {
            const e = live[(cursor + k * 7) % live.length];
            if (world.valid(e)) world.set(e, table[0].def, { x: t, y: k, z: 0 });
        }
        world.advanceTick();

        if ((t + 1) % REPL_EVERY !== 0) continue;
        // A consumer reads what changed…
        for (const entry of table) {
            if (world.anyChangedSince(entry.def, since)) world.getRemovedEntitiesSince(entry.def, since);
        }
        // …and, if it is diligent, tells the tracker it is done with them.
        if (clean) world.cleanRemovedBuffer(world.getWorldTick());
        since = world.getWorldTick() - 1;

        if ((t + 1) % 300 === 0) {
            samples.push({ tick: t + 1, ...world.debugInfo?.().changes ?? sizesOf(world) });
        }
    }
    return { label, samples };
}

/** `world.debugInfo()` may not exist on every build; read the tracker directly. */
function sizesOf(world) {
    const changes = world.changes_ ?? null;
    return changes && typeof changes.sizes === 'function' ? changes.sizes() : {};
}

const runs = [await run('naive (never cleans)', false), await run('diligent (cleans each sample)', true)];

console.log('=== tracker storage under churn ===');
console.log(`  ${LIVE} live entities · ${CHURN} replaced per tick · ${TICKS} ticks`);
console.log('  A bounded consumer keeps storage proportional to the RECENT window.');
console.log('  Growth proportional to churn since start is a resource debt, and');
console.log('  disqualifies the mechanism however fast it samples.');
console.log('');
for (const r of runs) {
    console.log(`  ${r.label}`);
    console.log('      tick   addedRows  changedRows  removedRows');
    for (const s of r.samples) {
        console.log(`    ${String(s.tick).padStart(6)}  ${String(s.addedRows ?? '?').padStart(10)}`
            + `  ${String(s.changedRows ?? '?').padStart(11)}  ${String(s.removedRows ?? '?').padStart(12)}`);
    }
    const first = r.samples[0];
    const last = r.samples[r.samples.length - 1];
    const grew = (k) => (first?.[k] ?? 0) > 0 ? ((last?.[k] ?? 0) / first[k]).toFixed(2) : '—';
    console.log(`      growth first→last:  added ×${grew('addedRows')}`
        + `  changed ×${grew('changedRows')}  removed ×${grew('removedRows')}`);
    console.log('');
}
