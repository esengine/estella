// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One arm at one workload point, in its own process, printing one JSON
 *        object. Its own process because change tracking cannot be turned OFF
 *        once enabled, and because a cold heap, GC history and JIT profile are
 *        not shareable between arms — which is also why every arm pays the same
 *        warmup before anything is measured.
 *
 *   node bench/replication-dirty/arm.mjs --arm C --entities 10000 --dirty 0.01
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';
import {
    loadSdk, defineWorkloadComponents, buildWorld, applyTick,
    newShadow, sampleFullShadow, sampleTrackedCandidates, sampleTrackerOnly, Digest,
} from './workload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const ARM = flag('arm', 'A');
const ENTITIES = Number(flag('entities', '10000'));
const DIRTY = Number(flag('dirty', '0.01'));
const SIM_HZ = Number(flag('simHz', '60'));
const REPL_HZ = Number(flag('replHz', '20'));
const WARMUP = Number(flag('warmup', '300'));
const MEASURE = Number(flag('measure', '1200'));
/** Arm C only: also compute the full-shadow oracle each sample and compare
 *  candidate sets. Timings from a verify run are NOT comparable and say so. */
const VERIFY = argv.includes('--verify');

const REPL_EVERY = Math.round(SIM_HZ / REPL_HZ);
const DIRTY_COUNT = Math.round(ENTITIES * DIRTY);
const TRACKING = ARM !== 'A';

// GC is reported beside the tax, never added to it: a collection inside the
// measurement window is already inside the wall time being measured.
let gcCount = 0;
let gcMs = 0;
try {
    const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { gcCount++; gcMs += e.duration; }
    });
    obs.observe({ entryTypes: ['gc'] });
} catch { /* not every build exposes gc entries */ }

const sdk = await loadSdk(ROOT);
const app = sdk.App.new();
const world = app.world;
const table = defineWorkloadComponents(sdk);

if (TRACKING) {
    // What a tracker-backed replication layer would have to do: every
    // replicated component, or a change to one is invisible.
    for (const entry of table) world.enableChangeTracking(entry.def);
}

const entities = buildWorld(world, table, ENTITIES);
const shadow = newShadow(world, entities, table);
// The oracle keeps its OWN shadow so what it reports is what a complete scan
// would have found, not what the candidate pass left behind.
const oracleShadow = VERIFY ? newShadow(world, entities, table) : null;

const digest = new Digest();
const recall = { skippedComponents: 0, oracleEntries: 0, missed: 0 };

let writeNs = 0n;
let sampleNs = 0n;
let visited = 0;
let compares = 0;
let candidates = 0;
let samples = 0;
// -1, not 0: the tracker's `since` is a strict `>`, and the very first window
// has to include writes recorded on world tick 0.
let since = -1;

/** One arm's sample. `out` collects (entity, componentIndex, mask) triples. */
function sample(out) {
    switch (ARM) {
        case 'A':
        case 'B': return sampleFullShadow(world, table, entities, shadow, out);
        case 'C': return sampleTrackedCandidates(world, table, entities, shadow, since, out, recall);
        case 'D': return sampleTrackerOnly(world, table, entities, shadow, since, out);
        default: throw new Error(`unknown arm "${ARM}"`);
    }
}

const heapBefore = () => process.memoryUsage().heapUsed;

function runTicks(count, measuring) {
    for (let t = 0; t < count; t++) {
        const tick = measuring ? WARMUP + t : t;
        const w0 = process.hrtime.bigint();
        applyTick(world, table, entities, tick, DIRTY_COUNT);
        world.advanceTick();
        const w1 = process.hrtime.bigint();
        if (measuring) writeNs += w1 - w0;

        if ((tick + 1) % REPL_EVERY !== 0) continue;

        const out = measuring ? digest : new Digest();
        const s0 = process.hrtime.bigint();
        const stats = sample(out);
        const s1 = process.hrtime.bigint();
        if (measuring) {
            sampleNs += s1 - s0;
            samples++;
            visited += stats.visited;
            compares += stats.compares;
            candidates += stats.candidates ?? 0;
        }

        if (VERIFY) verifyAgainstOracle();
        // `isChangedSince` is a STRICT `>`, and the next window's first writes
        // land on the tick the clock reads right now. Storing that tick would
        // exclude them — the window must open one tick earlier.
        since = world.getWorldTick() - 1;
    }
}

/**
 * The correctness half, and it asks the narrow question: of everything a
 * complete scan finds changed this sample, did the tracker NAME it? Not "did
 * the candidate pass emit it" — a candidate whose shadow happened to agree
 * emits nothing and was still correctly named. One miss is disqualifying.
 */
function verifyAgainstOracle() {
    const named = new Set();
    for (let ci = 0; ci < table.length; ci++) {
        const entry = table[ci];
        if (!world.anyChangedSince(entry.def, since)) continue;
        for (const e of entities) {
            if (world.isChangedSince(e, entry.def, since)) named.add(`${e}:${ci}`);
        }
    }
    sampleFullShadow(world, table, entities, oracleShadow, {
        push: (e, ci) => {
            recall.oracleEntries++;
            if (!named.has(`${e}:${ci}`)) recall.missed++;
        },
    });
}

const heap0 = heapBefore();
runTicks(WARMUP, false);
// Measure from a settled heap, and report growth over the window only.
const heap1 = heapBefore();
gcCount = 0; gcMs = 0;
runTicks(MEASURE, true);
const heap2 = heapBefore();

const simSeconds = MEASURE / SIM_HZ;
const us = (ns) => Number(ns) / 1000;

process.stdout.write(`${JSON.stringify({
    arm: ARM,
    entities: ENTITIES,
    dirty: DIRTY,
    simHz: SIM_HZ,
    replHz: REPL_HZ,
    warmup: WARMUP,
    measure: MEASURE,
    verify: VERIFY,
    timingsComparable: !VERIFY,
    simSeconds,
    writeTaxUsPerSimSecond: us(writeNs) / simSeconds,
    sampleTaxUsPerSimSecond: us(sampleNs) / simSeconds,
    totalTaxUsPerSimSecond: (us(writeNs) + us(sampleNs)) / simSeconds,
    samples,
    entriesEmitted: digest.entries,
    digest: digest.value,
    entitiesVisitedPerSimSecond: visited / simSeconds,
    fieldComparesPerSimSecond: compares / simSeconds,
    candidatesPerSimSecond: candidates / simSeconds,
    componentScansSkipped: recall.skippedComponents,
    recall: VERIFY ? { oracleEntries: recall.oracleEntries, missed: recall.missed } : null,
    heapAfterWarmupBytes: heap1,
    heapDeltaBytes: heap2 - heap1,
    heapSetupBytes: heap1 - heap0,
    gcCount,
    gcMs,
}, null, 2)}\n`);
