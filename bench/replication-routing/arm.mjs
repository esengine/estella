// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the interest send path costs, on the real server.
 *
 * Visibility is a local question now. What is still global x connections is the
 * two filters after it: every removal is asked about for every connection, and
 * so is every dirty row. This drives `ReplicationServer` itself — no
 * reproduction — and counts what those two passes VISIT against what they send.
 *
 *   node bench/replication-routing/arm.mjs --dirty 0.01 --removals 0.001
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const ENTITIES = Number(flag('entities', '100000'));
const CONNECTIONS = Number(flag('connections', '32'));
const VISIBLE = Number(flag('visible', '0.01'));
const MOVEMENT = Number(flag('movement', '0.01'));
const DIRTY = Number(flag('dirty', '0'));
const REMOVALS = Number(flag('removals', '0'));
/** How much of the world the anchors are spread over. 1 = the whole map, and each
 *  entity is then in one connection's view; smaller packs the connections together
 *  and the same entity is seen by many, which is what decides push against pull. */
const CLUSTER = Number(flag('cluster', '1'));
const WARMUP = Number(flag('warmup', '12'));
const MEASURE = Number(flag('measure', '60'));
/** How many measured samples to COUNT. The counts are steady-state and the census
 *  is an O(E) rebuild plus C queries, so counting every one would cost more wall
 *  clock than the thing being measured. */
const CENSUS = Number(flag('census', '3'));
const STEP = 1 / 60;

const { loadSdk, sdkIdentity } = await import(pathToFileURL(
    path.join(ROOT, 'bench/replication-interest/workload.mjs')).href);
const sdk = await loadSdk(ROOT);
const wasmDir = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const factory = (await import(pathToFileURL(path.join(wasmDir, 'esengine.js')).href)).default;
const engine = await factory({ locateFile: (f) => path.join(wasmDir, f) });

/** A second replicated component, so "dirty" and "moved" are separate knobs. */
const Health = sdk.defineComponent('BenchHealth', { hp: 0 }, { replicatedFields: ['hp'] });

const serverApp = sdk.App.new();
serverApp.connectCpp(new engine.Registry(), engine, { strict: false });
serverApp.addPlugin(sdk.replicationPlugin);
const server = serverApp.getResource(sdk.Net).startServer();
const world = serverApp.world;

const side = Math.ceil(Math.sqrt(ENTITIES));
const RADIUS = VISIBLE >= 1 ? side * 2 : Math.sqrt((VISIBLE * ENTITIES) / Math.PI);
server.setInterestProvider(sdk.radiusInterestProvider(RADIUS));

const clients = [];
for (let i = 0; i < CONNECTIONS; i++) {
    const app = sdk.App.new();
    app.connectCpp(new engine.Registry(), engine, { strict: false });
    app.addPlugin(sdk.replicationPlugin);
    const [ta, tb] = sdk.MemoryTransport.pair();
    const id = server.attachConnection(ta);
    await app.getResource(sdk.Net).connect(tb, { interpolationDelayTicks: 0 });
    clients.push({ app, id });
}

const entities = new Array(ENTITIES);
for (let i = 0; i < ENTITIES; i++) {
    const e = world.spawn();
    world.insert(e, sdk.Replicated, { owner: -1 });
    world.insert(e, sdk.Transform, { position: { x: i % side, y: Math.floor(i / side), z: 0 } });
    world.insert(e, Health, { hp: 100 });
    entities[i] = e;
}
/** One anchor per connection, spread so a view is a neighbourhood, not a corner. */
const owned = new Map();
const span = Math.max(1, Math.floor(ENTITIES * CLUSTER));
const stride = Math.max(1, Math.floor(span / CONNECTIONS));
for (let c = 0; c < CONNECTIONS; c++) {
    const e = entities[(c * stride) % ENTITIES];
    world.set(e, sdk.Replicated, { owner: c });
    owned.set(c, [e]);
}

const MOVE = Math.round(ENTITIES * MOVEMENT);
const DIRTY_ROWS = Math.round(ENTITIES * DIRTY);
const REMOVE_ROWS = Math.round(ENTITIES * REMOVALS);
/** The window taken off last tick, put back this one, so the rate is sustained. */
let restoring = [];

/**
 * One tick's worth of world change. Everything that makes an entity dirty ends
 * up in ONE list, because that is what the server has to route: moving an entity
 * dirties it, and so does giving a component back.
 */
function mutate(tick) {
    const dirtied = new Set();
    for (let k = 0; k < MOVE; k++) {
        const e = entities[(tick * 7919 + k * 7919) % ENTITIES];
        world.update(e, sdk.Transform, (d) => { d.position.x += ((tick + k) % 3) - 1; });
        dirtied.add(e);
    }
    // A different stride, so the dirty rows are not the moved ones.
    for (let k = 0; k < DIRTY_ROWS; k++) {
        const e = entities[(tick * 104729 + k * 104729) % ENTITIES];
        // The removal window may have taken this one's component away.
        if (!world.has(e, Health)) continue;
        world.update(e, Health, (d) => { d.hp = (d.hp + 1) & 0xffff; });
        dirtied.add(e);
    }
    for (const e of restoring) {
        if (!world.valid(e)) continue;
        world.insert(e, Health, { hp: 100 });
        dirtied.add(e);
    }
    restoring = [];
    for (let k = 0; k < REMOVE_ROWS; k++) {
        const e = entities[(tick * 15485863 + k * 15485863) % ENTITIES];
        if (!world.has(e, Health)) continue;
        world.remove(e, Health);
        restoring.push(e);
    }
    return { dirtied: [...dirtied], removed: [...restoring] };
}

/**
 * What the server's two filters were asked about, and what came out. Untimed and
 * outside the server: a snapshot provider reading the same canonical positions
 * answers the same question, which is what makes the ratio a fact about the
 * mechanism rather than about this file.
 */
const canonical = (w, e) => {
    if (!w.has(e, sdk.Transform)) return null;
    const t = w.tryGet(e, sdk.Transform);
    return t ? { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z } : null;
};
const oracle = sdk.radiusInterestProvider(RADIUS, { position: canonical });

const totals = {
    samples: 0, visible: 0, dirtyVisits: 0, dirtySent: 0,
    removalVisits: 0, removalSent: 0, dirtyRows: 0, removalRows: 0, viewers: 0, viewed: 0,
    enters: 0, leaves: 0, diffed: 0,
};
/** Last sample's view per connection, so the enter/leave EVENTS can be counted —
 *  what a reverse-interest index would have to be maintained by. */
const previous = new Map();

function census(made) {
    world.ensureTransformsComposed();
    const prepared = oracle.prepare({ world, entities, entityCount: entities.length });
    const seenBy = new Map();
    for (let c = 0; c < CONNECTIONS; c++) {
        const answer = prepared.query({ connectionId: c, owned: owned.get(c) });
        const visible = answer === 'all' ? new Set(entities) : answer;
        totals.visible += visible.size;
        for (const e of visible) seenBy.set(e, (seenBy.get(e) ?? 0) + 1);
        const before = previous.get(c);
        if (before) {
            for (const e of visible) if (!before.has(e)) totals.enters++;
            for (const e of before) if (!visible.has(e)) totals.leaves++;
            totals.diffed++;
        }
        previous.set(c, visible);
        // The two filters walk the WHOLE list for every connection; what survives
        // is the intersection with this connection's view.
        for (const e of made.dirtied) if (visible.has(e)) totals.dirtySent++;
        for (const e of made.removed) if (visible.has(e)) totals.removalSent++;
    }
    for (const n of seenBy.values()) { totals.viewers += n; totals.viewed++; }
    totals.dirtyRows += made.dirtied.length;
    totals.removalRows += made.removed.length;
    totals.dirtyVisits += CONNECTIONS * made.dirtied.length;
    totals.removalVisits += CONNECTIONS * made.removed.length;
    totals.samples++;
}

let ns = 0n;
let ticks = 0;
// Kept per tick as well as summed: a neighbouring process only ever makes a
// sample slower, so the fastest one is what this machine can do and the mean is
// what it was doing at the time.
let fastest = Infinity;
for (let t = 0; t < WARMUP; t++) { mutate(t); await serverApp.tick(STEP); }
for (let t = 0; t < MEASURE; t++) {
    const made = mutate(WARMUP + t);
    const t0 = process.hrtime.bigint();
    await serverApp.tick(STEP);
    const dt = Number(process.hrtime.bigint() - t0);
    ns += BigInt(dt);
    fastest = Math.min(fastest, dt / 1000);
    ticks++;
    if (t >= MEASURE - CENSUS) census(made);
}

const us = Number(ns) / 1000;
const per = (v) => v / totals.samples;
const usPerSample = us / ticks;
process.stdout.write(`${JSON.stringify({
    entities: ENTITIES, connections: CONNECTIONS, visible: VISIBLE, movement: MOVEMENT,
    cluster: CLUSTER,
    dirty: DIRTY, removals: REMOVALS, samples: totals.samples,
    usPerSample, usPerSampleMin: fastest,
    oneCorePercent: usPerSample * 60 / 1e4,
    oneCorePercentMin: fastest * 60 / 1e4,
    visiblePerConnection: per(totals.visible) / CONNECTIONS,
    dirtyRows: per(totals.dirtyRows),
    dirtyVisits: per(totals.dirtyVisits),
    dirtySent: per(totals.dirtySent),
    removalRows: per(totals.removalRows),
    removalVisits: per(totals.removalVisits),
    removalSent: per(totals.removalSent),
    viewersPerViewedEntity: totals.viewed > 0 ? totals.viewers / totals.viewed : 0,
    // Per SAMPLE across all connections, which is the rate a reverse index would
    // have to be maintained at.
    entersPerSample: totals.diffed > 0 ? (totals.enters / totals.diffed) * CONNECTIONS : 0,
    leavesPerSample: totals.diffed > 0 ? (totals.leaves / totals.diffed) * CONNECTIONS : 0,
    ...sdkIdentity(ROOT),
})}\n`);
