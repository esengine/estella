// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One arm at one workload point, printing one JSON object.
 *
 *   node bench/replication-interest/arm.mjs --arm A --entities 100000 --connections 32
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadSdk, connectEngine, buildWorld, applyMovement, newStats,
    visibleForA, visibleForB, visibleForC0, visibleForC1,
    buildPositionCache, buildGrid, diffAndFilter,
    newLiveGrid, seedLiveGrid, updateLiveGrid, gridDrift,
} from './workload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const ARM = flag('arm', 'A');
const ENTITIES = Number(flag('entities', '100000'));
const CONNECTIONS = Number(flag('connections', '32'));
const ANCHORS = Number(flag('anchors', '1'));
/** Fraction of the population a connection should see; radius is solved for it. */
const VISIBLE = Number(flag('visible', '0.01'));
const MOVEMENT = Number(flag('movement', '0.01'));
const SIM_HZ = Number(flag('simHz', '60'));
const REPL_HZ = Number(flag('replHz', '20'));
const WARMUP = Number(flag('warmup', '60'));
const MEASURE = Number(flag('measure', '240'));
/** Compare this arm's visible set against arm A's, every connection, every sample. */
const VERIFY = argv.includes('--verify');

const REPL_EVERY = Math.round(SIM_HZ / REPL_HZ);
const sdk = await loadSdk(ROOT);
const app = sdk.App.new();
const engine = await connectEngine(sdk, app, ROOT);
const world = app.world;
const ctx = buildWorld(sdk, world, {
    population: ENTITIES, connections: CONNECTIONS, anchorsPerConn: ANCHORS,
});

// The grid is `side × side` at one unit per cell, so a disc of radius r covers
// πr² cells: solve that for the requested fraction of the population.
const RADIUS = VISIBLE >= 1
    ? ctx.side * 2
    : Math.sqrt((VISIBLE * ENTITIES) / Math.PI);
const R2 = RADIUS * RADIUS;
const MOVE_COUNT = Math.round(ENTITIES * MOVEMENT);

// The composed world transforms exist because something asked, not because a
// frame happened. A server asks here, before it samples.
world.ensureTransformsComposed();

// The measured path is the composed one, not a local-space lookalike: a child of
// a parent at 100, five to its right, has to read 105.
{
    const p = world.spawn();
    world.insert(p, ctx.Pos, { position: { x: 100, y: 0, z: 0 } });
    const c = world.spawn();
    world.insert(c, ctx.Pos, { position: { x: 5, y: 0, z: 0 } });
    world.setParent(c, p);
    world.ensureTransformsComposed();
    const composed = world.tryGet(c, ctx.Pos)?.worldPosition?.x;
    if (composed !== 105) {
        process.stderr.write(`sentinel: composed child x = ${composed}, want 105\n`);
        process.exit(1);
    }
    world.despawn(c);
    world.despawn(p);
}

// The ids come back as an address into the engine's own memory — a JS array of a
// hundred thousand handles would cost more than the walk that found them. The
// view is rebuilt each call: growing the heap detaches the old one.
const cppRegistry = world.getCppRegistry();
const EMPTY = new Uint32Array(0);
function composeCollecting() {
    const r = engine.transform_composeCollecting(cppRegistry);
    if (!r.ran || r.changed === 0) return EMPTY;
    return new Uint32Array(engine.HEAPU32.buffer, r.ptr, r.changed);
}

const liveGrid = ARM === 'D1' ? newLiveGrid(RADIUS) : null;
let seedUs = 0;
if (liveGrid) {
    const seedStats = newStats();
    seedLiveGrid(world, ctx, seedStats, liveGrid);
    seedUs = Number(seedStats.ns.build) / 1000;
}

const stats = newStats();
const previous = new Map();
for (let c = 0; c < CONNECTIONS; c++) previous.set(c, new Set());
const oracle = VERIFY ? new Map() : null;
if (oracle) for (let c = 0; c < CONNECTIONS; c++) oracle.set(c, new Set());

let mismatches = 0;
let samples = 0;
let totalNs = 0n;
let movedTotal = 0;

function sampleOnce(measuring) {
    const t0 = process.hrtime.bigint();
    // What a server does before an interest snapshot. With no transform mutation
    // since the last one this is the epoch comparison and nothing else.
    const et = process.hrtime.bigint();
    const changed = ARM === 'D1' ? composeCollecting() : (world.ensureTransformsComposed(), null);
    if (measuring) stats.ns.ensure += process.hrtime.bigint() - et;
    const mt = process.hrtime.bigint();
    const candidates = [...ctx.entities];
    if (measuring) {
        stats.ns.materialize += process.hrtime.bigint() - mt;
        stats.visited.candidates += candidates.length;
    }
    // A sample's worth of dirty/removal rows, sized like a sparse world.
    const dirty = candidates.slice(0, Math.max(1, Math.round(ENTITIES * 0.01)));
    const removals = [];

    // Built once per sample, which is what makes an arbitrary position function
    // safe here: nothing is carried between samples to go stale.
    const shared = measuring ? stats : newStats();
    const cache = ARM === 'C0' ? buildPositionCache(world, ctx, shared) : null;
    const grid = ARM === 'C1' ? buildGrid(world, ctx, shared, RADIUS)
        : ARM === 'D1' ? (updateLiveGrid(world, ctx, shared, liveGrid, changed), liveGrid) : null;

    for (let c = 0; c < CONNECTIONS; c++) {
        const use = measuring ? stats : newStats();
        const visible = ARM === 'C1' || ARM === 'D1'
            ? visibleForC1(ctx, c, candidates, R2, use, ctx.owned, grid, RADIUS)
            : ARM === 'C0'
                ? visibleForC0(ctx, c, candidates, R2, use, ctx.owned, cache)
                : ARM === 'B'
                    ? visibleForB(world, ctx, c, candidates, R2, use, ctx.owned)
                    : visibleForA(world, ctx, c, candidates, R2, use, ctx.owned);
        if (VERIFY) {
            // Set equality, not size: an arm that both misses one entity and
            // invents another has the same count and a different answer.
            const truth = visibleForA(world, ctx, c, candidates, R2, newStats());
            if (truth.size !== visible.size) mismatches++;
            else {
                for (const e of truth) if (!visible.has(e)) { mismatches++; break; }
                for (const e of visible) if (!truth.has(e)) { mismatches++; break; }
            }
        }
        diffAndFilter(visible, previous.get(c), dirty, removals, use);
        previous.set(c, visible);
    }
    if (measuring) {
        totalNs += process.hrtime.bigint() - t0;
        samples++;
    }
}

function run(count, measuring) {
    for (let t = 0; t < count; t++) {
        const tick = measuring ? WARMUP + t : t;
        movedTotal += applyMovement(world, ctx, tick, MOVE_COUNT);
        world.advanceTick();
        if ((tick + 1) % REPL_EVERY !== 0) continue;
        sampleOnce(measuring);
    }
}

run(WARMUP, false);
run(MEASURE, true);

// The invariant a KEPT structure lives or dies by. The per-sample visible-set
// check does not reach it: a stale cell shows up there only if it changes
// somebody's view, and at 1% visible most of the world is nobody's.
const drift = liveGrid ? gridDrift(liveGrid, buildGrid(world, ctx, newStats(), RADIUS)) : null;

const simSeconds = MEASURE / SIM_HZ;
const us = (ns) => Number(ns) / 1000;
const per = (v) => v / simSeconds;
process.stdout.write(`${JSON.stringify({
    arm: ARM, entities: ENTITIES, connections: CONNECTIONS, anchors: ANCHORS,
    visible: VISIBLE, movement: MOVEMENT, radius: RADIUS, verify: VERIFY,
    simSeconds, samples, mismatches, movedTotal, seedUs, drift,
    totalUsPerSimSecond: per(us(totalNs)),
    segmentUsPerSimSecond: Object.fromEntries(
        Object.entries(stats.ns).map(([k, v]) => [k, per(us(v))]),
    ),
    visitedPerSample: Object.fromEntries(
        Object.entries(stats.visited).map(([k, v]) => [k, samples > 0 ? v / samples : 0]),
    ),
    visiblePerConnection: samples > 0 ? stats.visibleTotal / (samples * CONNECTIONS) : 0,
})}\n`);
