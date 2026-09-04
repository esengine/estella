// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Observation completeness: for every way the engine lets a game change
 *        replicated state, does the ChangeTracker see it?
 *
 * This is the question the timing matrix cannot answer. A shadow scan reads the
 * final value and does not care how it got there; a tracker is an OBSERVATION,
 * and is only usable as an authoritative candidate source if every legal write
 * path reports. One silent path is disqualifying — that state would simply stop
 * replicating, with nothing anywhere saying so.
 *
 *   node bench/replication-dirty/completeness.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSdk } from './workload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sdk = await loadSdk(ROOT);

const results = [];

/**
 * Run one write path against a fresh world and report whether the tracker saw
 * it. `shadowSees` is what a full scan would conclude — the two disagreeing is
 * the whole finding.
 */
async function probe(name, expectation, body) {
    const app = sdk.App.new();
    const world = app.world;
    const C = sdk.defineComponent(`Probe${results.length}`, { v: 0, w: 0 }, { replicatedFields: ['v', 'w'] });
    world.enableChangeTracking(C);

    const e = world.spawn();
    world.insert(e, C, { v: 1, w: 1 });
    world.advanceTick();
    const before = { v: world.tryGet(e, C)?.v, w: world.tryGet(e, C)?.w, had: world.has(e, C) };
    const since = world.getWorldTick() - 1;

    await body(world, e, C, app);

    const after = { v: world.tryGet(e, C)?.v, w: world.tryGet(e, C)?.w, had: world.has(e, C) };
    const shadowSees = before.had !== after.had || before.v !== after.v || before.w !== after.w;
    const trackerSees = world.anyChangedSince(C, since)
        && (world.isChangedSince(e, C, since) || world.getRemovedEntitiesSince(C, since).includes(e));

    results.push({ name, expectation, shadowSees, trackerSees, agree: shadowSees === trackerSees });
}

// --- the documented ways a game writes replicated state ---------------------

await probe('world.set', 'recorded', (world, e, C) => {
    world.set(e, C, { v: 2, w: 1 });
});

await probe('world.insert (replacing)', 'recorded', (world, e, C) => {
    world.insert(e, C, { v: 3, w: 1 });
});

await probe('world.remove', 'recorded', (world, e, C) => {
    world.remove(e, C);
});

// Mut() is a SYSTEM parameter, so this one has to run a real schedule — which
// is the point: it is the write path a system actually uses.
await probe('Mut() query write-back', 'recorded', async (world, e, C, app) => {
    app.addSystemToSchedule(sdk.Schedule.Update, sdk.defineSystem(
        [sdk.Query(sdk.Mut(C))],
        (query) => { for (const [, data] of query) data.v = 4; },   // rows are [entity, ...components]
    ));
    await app.tick(1 / 60);
});

await probe('world.markChanged (no data write)', 'recorded', (world, e, C) => {
    world.markChanged(e, C);
});

/**
 * The one that matters. `tryGet` hands back the LIVE stored object for a script
 * component, so a game can write a field and never call anything. The value is
 * really changed — a shadow scan finds it on its next pass — and no observation
 * was ever emitted.
 */
await probe('tryGet(...).field = v, no set()', 'SILENT', (world, e, C) => {
    const data = world.tryGet(e, C);
    data.v = 5;
});

// ---------------------------------------------------------------------------

const width = Math.max(...results.map((r) => r.name.length));
console.log('=== write-path observation completeness ===');
console.log('  shadow = a full scan would find it · tracker = the ChangeTracker reported it');
console.log('');
for (const r of results) {
    const verdict = r.shadowSees && !r.trackerSees ? 'SILENT — shadow sees it, tracker does not'
        : r.shadowSees && r.trackerSees ? 'observed'
            : !r.shadowSees && r.trackerSees ? 'over-reported (harmless: a candidate that verifies clean)'
                : 'no change made';
    console.log(`  ${r.name.padEnd(width)}  shadow ${r.shadowSees ? 'Y' : 'n'}  tracker ${r.trackerSees ? 'Y' : 'n'}   ${verdict}`);
}

const silent = results.filter((r) => r.shadowSees && !r.trackerSees);
console.log('');
if (silent.length === 0) {
    console.log('COMPLETE: every legal write path this probe knows reports to the tracker.');
} else {
    console.log(`INCOMPLETE: ${silent.length} legal write path(s) change replicated state silently:`);
    for (const r of silent) console.log(`  - ${r.name}`);
    console.log('');
    console.log('A candidate source that cannot see these cannot be authoritative. Either the');
    console.log('path stops being legal, or it starts reporting, or the shadow scan stays.');
}

console.log('');
console.log('NOT COVERED HERE: builtin components (their writes cross the C++ mirror and');
console.log('need a wasm engine), AOT writeback, and physics/UI systems that write through');
console.log('their own paths. Each is its own answer and none of them is assumed.');
