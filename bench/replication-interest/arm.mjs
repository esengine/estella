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
    loadSdk, buildWorld, applyMovement, newStats, visibleForA, visibleForB, diffAndFilter,
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
/** Arm B only: compare its visible set against arm A's, every connection, every sample. */
const VERIFY = argv.includes('--verify');

const REPL_EVERY = Math.round(SIM_HZ / REPL_HZ);
const sdk = await loadSdk(ROOT);
const app = sdk.App.new();
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
    const mt = process.hrtime.bigint();
    const candidates = [...ctx.entities];
    if (measuring) {
        stats.ns.materialize += process.hrtime.bigint() - mt;
        stats.visited.candidates += candidates.length;
    }
    // A sample's worth of dirty/removal rows, sized like a sparse world.
    const dirty = candidates.slice(0, Math.max(1, Math.round(ENTITIES * 0.01)));
    const removals = [];

    for (let c = 0; c < CONNECTIONS; c++) {
        const use = measuring ? stats : newStats();
        const visible = ARM === 'B'
            ? visibleForB(world, ctx, c, candidates, R2, use, ctx.owned)
            : visibleForA(world, ctx, c, candidates, R2, use, ctx.owned);
        if (VERIFY) {
            const truth = visibleForA(world, ctx, c, candidates, R2, newStats());
            if (truth.size !== visible.size) mismatches++;
            else { for (const e of truth) if (!visible.has(e)) { mismatches++; break; } }
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

const simSeconds = MEASURE / SIM_HZ;
const us = (ns) => Number(ns) / 1000;
const per = (v) => v / simSeconds;
process.stdout.write(`${JSON.stringify({
    arm: ARM, entities: ENTITIES, connections: CONNECTIONS, anchors: ANCHORS,
    visible: VISIBLE, movement: MOVEMENT, radius: RADIUS, verify: VERIFY,
    simSeconds, samples, mismatches, movedTotal,
    totalUsPerSimSecond: per(us(totalNs)),
    segmentUsPerSimSecond: Object.fromEntries(
        Object.entries(stats.ns).map(([k, v]) => [k, per(us(v))]),
    ),
    visitedPerSample: Object.fromEntries(
        Object.entries(stats.visited).map(([k, v]) => [k, samples > 0 ? v / samples : 0]),
    ),
    visiblePerConnection: samples > 0 ? stats.visibleTotal / (samples * CONNECTIONS) : 0,
})}\n`);
