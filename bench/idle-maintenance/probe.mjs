// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a replication sample maintains when nothing has happened.
 *
 * A stationary sample costs 7,334 us at 100k entities and 32 connections. The
 * visibility pass is 3,439 of it (bench/interest-floor); this is the other
 * 3,895 — reconciling a registry against an empty topology window, refreshing an
 * owner index nobody changed, gating a change journal, reading an empty removal
 * window, and giving three kinds of reader a new floor.
 *
 * The suspicion it exists to kill or confirm: that this is rent paid per
 * REPLICATED COMPONENT rather than per entity, so a wide schema costs a
 * stationary server the same as a busy one.
 *
 *   node bench/idle-maintenance/probe.mjs
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
const EXTRA = Number(flag('components', '0'));
const SAMPLES = Number(flag('samples', '200'));
const CONNECTIONS = Number(flag('connections', '32'));

const { loadSdk, sdkIdentity } = await import(pathToFileURL(
    path.join(ROOT, 'bench/replication-interest/workload.mjs')).href);
const sdk = await loadSdk(ROOT);
const wasmDir = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const factory = (await import(pathToFileURL(path.join(wasmDir, 'esengine.js')).href)).default;
const engine = await factory({ locateFile: (f) => path.join(wasmDir, f) });

sdk.clearUserComponents();
/** The knob: how wide the replication schema is, beside the builtins. */
for (let i = 0; i < EXTRA; i++) {
    sdk.defineComponent(`Wide${i}`, { a: 0, b: 0 }, { replicatedFields: ['a', 'b'] });
}

const app = sdk.App.new();
app.connectCpp(new engine.Registry(), engine, { strict: false });
app.addPlugin(sdk.replicationPlugin);
const server = app.getResource(sdk.Net).startServer();
const world = app.world;

const side = Math.ceil(Math.sqrt(ENTITIES));
const entities = new Array(ENTITIES);
for (let i = 0; i < ENTITIES; i++) {
    const e = world.spawn();
    world.insert(e, sdk.Replicated, { owner: -1 });
    world.insert(e, sdk.Transform, { position: { x: i % side, y: Math.floor(i / side), z: 0 } });
    entities[i] = e;
}
// The table is built (and the observation claimed) on first access, from every
// component registered by now — which is what the width knob moves.
const table = server.table;
// Its claims are released before anything is measured. A server that never
// samples never advances its floors, and a second holder pinning history at tick
// zero makes every window look like the whole run — 108 us to read an empty one.
server.dispose();
const known = new Set(entities);

/**
 * The reader set a server holds, mirrored: one removal claim per replicated
 * component, one topology claim, one write claim. Claimed the same way, so what
 * is timed below is the same work on the same journals.
 */
const observations = table.entries.map((te) => {
    world.enableChangeTracking(te.def);
    return { def: te.def, readerId: world.registerRemovedReaderFrom(te.def, world.getWorldTick() - 1) };
});
const registryReader = world.registerTopologyReaderFrom(sdk.Replicated, world.getWorldTick() - 1);
const ownerReader = world.registerWriteReaderFrom(sdk.Replicated, world.getWorldTick() - 1);
let floor = world.getWorldTick() - 1;

const conns = Array.from({ length: CONNECTIONS }, (_, id) => ({ id, ready: true, applied: null, ackedSeq: 0 }));

const ns = { R: 0n, O: 0n, Dc: 0n, Dr: 0n, Ac: 0n, Ar: 0n, Ao: 0n, K: 0n };
const calls = { journalReads: 0, readerAdvances: 0 };

/**
 * One sample's maintenance, in the order the server does it. `arm` removes a
 * layer: B stops reading the change and removal journals, C stops giving the
 * readers a new floor, D does neither and keeps only the connection loop.
 */
function maintain(arm, counting) {
    const t0 = process.hrtime.bigint();
    let t = process.hrtime.bigint();
    if (arm !== 'D') {
        const candidates = world.getTopologyChangedEntitiesSince(sdk.Replicated, floor);
        for (const e of candidates) void e;
        if (counting) { ns.R += process.hrtime.bigint() - t; calls.journalReads++; }

        t = process.hrtime.bigint();
        const written = world.getWrittenEntitiesSince(sdk.Replicated, floor);
        for (const e of written) void e;
        if (counting) { ns.O += process.hrtime.bigint() - t; calls.journalReads++; }
    }

    if (arm === 'A') {
        t = process.hrtime.bigint();
        let anyChanged = 0;
        for (const te of table.entries) {
            if (world.anyChangedSince(te.def, floor)) {
                anyChanged++;
                for (const e of known) if (world.isChangedSince(e, te.def, floor)) anyChanged++;
            }
            if (counting) calls.journalReads++;
        }
        if (counting) ns.Dc += process.hrtime.bigint() - t;

        t = process.hrtime.bigint();
        for (const te of table.entries) {
            const removed = world.getRemovedEntitiesSince(te.def, floor);
            for (const e of removed) void e;
            if (counting) calls.journalReads++;
        }
        if (counting) ns.Dr += process.hrtime.bigint() - t;
        void anyChanged;
    }

    world.advanceTick();
    const next = world.getWorldTick() - 1;
    if (arm === 'A' || arm === 'B') {
        t = process.hrtime.bigint();
        for (const o of observations) {
            world.advanceRemovedReader(o.def, o.readerId, next);
            if (counting) calls.readerAdvances++;
        }
        if (counting) ns.Ac += process.hrtime.bigint() - t;

        t = process.hrtime.bigint();
        world.advanceTopologyReader(sdk.Replicated, registryReader, next);
        if (counting) { ns.Ar += process.hrtime.bigint() - t; calls.readerAdvances++; }

        t = process.hrtime.bigint();
        world.advanceWriteReader(sdk.Replicated, ownerReader, next);
        if (counting) { ns.Ao += process.hrtime.bigint() - t; calls.readerAdvances++; }
    }
    floor = next;

    t = process.hrtime.bigint();
    for (const conn of conns) {
        if (!conn.ready || !conn.applied || conn.applied.seq <= conn.ackedSeq) continue;
        conn.ackedSeq = conn.applied.seq;
    }
    if (counting) ns.K += process.hrtime.bigint() - t;
    return Number(process.hrtime.bigint() - t0);
}

const arms = { A: Infinity, B: Infinity, C: Infinity, D: Infinity };
for (let tick = 0; tick < SAMPLES + 20; tick++) {
    const warm = tick < 20;
    const order = ['A', 'B', 'C', 'D'];
    for (let r = 0; r < tick % order.length; r++) order.push(order.shift());
    for (const arm of order) {
        const dt = maintain(arm, !warm && arm === 'A');
        if (!warm) arms[arm] = Math.min(arms[arm], dt / 1000);
    }
}

const n = SAMPLES;
const us = (v) => Number(v) / 1000 / n;
const say = (s = '') => console.log(s);
const pad = (v, w) => String(v).padStart(w);
say('');
say(`=== a sample maintaining nothing (${ENTITIES} entities, ${table.entries.length} replicated`
    + ` components, ${CONNECTIONS} connections) ===`);
say('');
say('  where it goes');
say(`    R   registry topology read     ${pad(us(ns.R).toFixed(1), 8)} us`);
say(`    O   owner write-journal read   ${pad(us(ns.O).toFixed(1), 8)} us`);
say(`    Dc  Changed gate               ${pad(us(ns.Dc).toFixed(1), 8)} us   one anyChangedSince per component`);
say(`    Dr  Removed-history read       ${pad(us(ns.Dr).toFixed(1), 8)} us   one window per component`);
say(`    Ac  advance Removed readers    ${pad(us(ns.Ac).toFixed(1), 8)} us   one per component`);
say(`    Ar  advance topology reader    ${pad(us(ns.Ar).toFixed(1), 8)} us`);
say(`    Ao  advance write reader       ${pad(us(ns.Ao).toFixed(1), 8)} us`);
say(`    K   ack / bookkeeping          ${pad(us(ns.K).toFixed(1), 8)} us`);
say('');
say(`    journal reads per sample       ${pad(Math.round(calls.journalReads / n), 8)}`);
say(`    reader advances per sample     ${pad(Math.round(calls.readerAdvances / n), 8)}`);
say('');
say('  and the counterfactuals (fastest sample)');
say('    A  everything, as the server does it');
say('    B  the change and removal journals not read');
say('    C  and no reader given a new floor');
say('    D  neither read nor advanced: the connection loop alone');
say('');
say(`    A  ${pad(arms.A.toFixed(1), 8)} us`);
say(`    B  ${pad(arms.B.toFixed(1), 8)} us    A - B = ${(arms.A - arms.B).toFixed(1)} us, the reading`);
say(`    C  ${pad(arms.C.toFixed(1), 8)} us    B - C = ${(arms.B - arms.C).toFixed(1)} us, the advancing`);
say(`    D  ${pad(arms.D.toFixed(1), 8)} us    C - D = ${(arms.C - arms.D).toFixed(1)} us, registry and owner`);
say('');
say(`  ${JSON.stringify({ ...sdkIdentity(ROOT), components: table.entries.length, cpu: os.cpus()[0]?.model })}`);
