// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a sample costs when NOTHING has happened.
 *
 * With no dirty row and no removal, a stationary server still spends 44% of a
 * core at 100k entities and 32 connections. Every connection asks the provider
 * what it can see, copies the answer, walks it looking for arrivals and walks
 * its previous view looking for departures — about 29,500 membership tests to
 * discover, most samples, that nothing moved.
 *
 * This decomposes that, and asks two counterfactuals: what if the spatial query
 * were free, and what if a connection could be TOLD its view had not changed.
 *
 *   node bench/interest-floor/probe.mjs
 */
import path from 'node:path';
import os from 'node:os';
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
const SAMPLES = Number(flag('samples', '20'));
const MOVEMENT = Number(flag('movement', '0'));

const { loadSdk, sdkIdentity } = await import(pathToFileURL(
    path.join(ROOT, 'bench/replication-interest/workload.mjs')).href);
const sdk = await loadSdk(ROOT);
const wasmDir = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const factory = (await import(pathToFileURL(path.join(wasmDir, 'esengine.js')).href)).default;
const engine = await factory({ locateFile: (f) => path.join(wasmDir, f) });

const app = sdk.App.new();
app.connectCpp(new engine.Registry(), engine, { strict: false });
const world = app.world;
const side = Math.ceil(Math.sqrt(ENTITIES));
const entities = new Array(ENTITIES);
for (let i = 0; i < ENTITIES; i++) {
    const e = world.spawn();
    world.insert(e, sdk.Transform, { position: { x: i % side, y: Math.floor(i / side), z: 0 } });
    entities[i] = e;
}
const RADIUS = Math.sqrt((VISIBLE * ENTITIES) / Math.PI);
const provider = sdk.radiusInterestProvider(RADIUS);
const stride = Math.max(1, Math.floor(ENTITIES / CONNECTIONS));
const owned = Array.from({ length: CONNECTIONS }, (_, c) => [entities[(c * stride) % ENTITIES]]);

const conns = Array.from({ length: CONNECTIONS }, (_, id) => ({ id, interest: new Set() }));
const counts = {
    visibleEntries: 0, setInsertions: 0, enterTests: 0, leaveTests: 0, enters: 0, leaves: 0,
};
const ns = { prepare: 0n, query: 0n, materialize: 0n, enter: 0n, leave: 0n, route: 0n };
const totals = { A: { ns: 0, min: Infinity }, B: { ns: 0, min: Infinity }, C: { ns: 0, min: Infinity } };

/** The answer a stationary world gives forever, kept for the arm that is handed it. */
let precomputed = null;

/**
 * One connection's visibility pass, as the server does it: ask, copy, find the
 * arrivals, find the departures. `mode` removes one layer at a time.
 */
function visibilityPass(mode, prepared, counting) {
    for (const c of conns) {
        if (mode === 'C') {
            // Told, rather than discovered: the view is the one it already holds,
            // so there is nothing to copy and nothing to compare.
            continue;
        }
        let t = process.hrtime.bigint();
        const answer = mode === 'B' ? precomputed[c.id] : prepared.query({ connectionId: c.id, owned: owned[c.id] });
        if (counting) ns.query += process.hrtime.bigint() - t;

        t = process.hrtime.bigint();
        const visible = answer === 'all' ? new Set(entities) : new Set(answer);
        for (const e of owned[c.id]) visible.add(e);
        if (counting) {
            ns.materialize += process.hrtime.bigint() - t;
            counts.visibleEntries += visible.size;
            counts.setInsertions += visible.size + owned[c.id].length;
        }

        t = process.hrtime.bigint();
        const enters = [];
        for (const e of visible) { if (!c.interest.has(e)) enters.push(e); }
        if (counting) { ns.enter += process.hrtime.bigint() - t; counts.enterTests += visible.size; counts.enters += enters.length; }

        t = process.hrtime.bigint();
        const leaves = [];
        for (const e of c.interest) { if (!visible.has(e)) leaves.push(e); }
        if (counting) { ns.leave += process.hrtime.bigint() - t; counts.leaveTests += c.interest.size; counts.leaves += leaves.length; }

        c.interest = visible;
    }
}

/** What routing costs with nothing to route: the plan map, and no walk at all. */
function emptyRoute(counting) {
    const t = process.hrtime.bigint();
    const out = new Map();
    for (const c of conns) out.set(c.id, { dirty: [], removals: [] });
    if (counting) ns.route += process.hrtime.bigint() - t;
    return out;
}

function sample(mode, counting) {
    const t0 = process.hrtime.bigint();
    let prepared = null;
    if (mode === 'A') {
        const t = process.hrtime.bigint();
        world.ensureTransformsComposed();
        prepared = provider.prepare({
            world, entities, entityCount: entities.length, entered: [], left: [], rechecked: [],
        });
        if (counting) ns.prepare += process.hrtime.bigint() - t;
    }
    visibilityPass(mode, prepared, counting);
    emptyRoute(counting);
    return Number(process.hrtime.bigint() - t0);
}

// Seed: everything entered once, and the stationary answer is cached for arm B.
{
    world.ensureTransformsComposed();
    const prepared = provider.prepare({
        world, entities, entityCount: entities.length, entered: entities, left: [], rechecked: [],
    });
    precomputed = conns.map((c) => prepared.query({ connectionId: c.id, owned: owned[c.id] }));
    visibilityPass('A', prepared, false);
}

const MOVE = Math.round(ENTITIES * MOVEMENT);
for (let tick = 0; tick < SAMPLES + 4; tick++) {
    for (let k = 0; k < MOVE; k++) {
        const e = entities[(tick * 7919 + k * 7919) % ENTITIES];
        world.update(e, sdk.Transform, (d) => { d.position.x += ((tick + k) % 3) - 1; });
    }
    const warm = tick < 4;
    // Rotated so no arm always runs into caches the ones before it warmed.
    const order = ['A', 'B', 'C'];
    for (let r = 0; r < tick % order.length; r++) order.push(order.shift());
    for (const mode of order) {
        const dt = sample(mode, !warm && mode === 'A');
        if (warm) continue;
        totals[mode].ns += dt;
        totals[mode].min = Math.min(totals[mode].min, dt / 1000);
    }
}

const n = SAMPLES;
const us = (v) => Number(v) / 1000 / n;
const per = (v) => v / n;
const say = (s = '') => console.log(s);
const pad = (v, w) => String(v).padStart(w);
say('');
say(`=== a sample with nothing to say (${ENTITIES} entities, ${CONNECTIONS} connections,`
    + ` ${VISIBLE * 100}% visible, ${MOVEMENT * 100}% moving) ===`);
say('');
say('  where the visibility pass spends it');
say(`    prepare         ${pad(us(ns.prepare).toFixed(1), 8)} us`);
say(`    query           ${pad(us(ns.query).toFixed(1), 8)} us`);
say(`    materialize     ${pad(us(ns.materialize).toFixed(1), 8)} us   the server's own copy of the answer`);
say(`    enter scan      ${pad(us(ns.enter).toFixed(1), 8)} us`);
say(`    leave scan      ${pad(us(ns.leave).toFixed(1), 8)} us`);
say(`    empty route     ${pad(us(ns.route).toFixed(1), 8)} us   with no debt at all`);
say('');
say('  what it did, counted');
say(`    visible entries        ${pad(Math.round(per(counts.visibleEntries)), 9)}`);
say(`    set insertions         ${pad(Math.round(per(counts.setInsertions)), 9)}`);
say(`    enter membership tests ${pad(Math.round(per(counts.enterTests)), 9)}`);
say(`    leave membership tests ${pad(Math.round(per(counts.leaveTests)), 9)}`);
say(`    actual enters          ${pad(Math.round(per(counts.enters)), 9)}`);
say(`    actual leaves          ${pad(Math.round(per(counts.leaves)), 9)}`);
say('');
say('  and the two counterfactuals');
say('    A  as it is: ask, copy, scan for arrivals, scan for departures');
say('    B  the same, with the spatial query already answered');
say('    C  told the view has not changed: no copy and no scan');
say('');
say(`    A               ${pad(totals.A.min.toFixed(1), 8)} us`);
say(`    B               ${pad(totals.B.min.toFixed(1), 8)} us    A - B = ${(totals.A.min - totals.B.min).toFixed(1)} us, the query`);
say(`    C               ${pad(totals.C.min.toFixed(1), 8)} us    B - C = ${(totals.B.min - totals.C.min).toFixed(1)} us, the copy and the two scans`);
say('');
say(`  ${JSON.stringify({ ...sdkIdentity(ROOT), cpu: os.cpus()[0]?.model })}`);
