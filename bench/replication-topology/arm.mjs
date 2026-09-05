// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One arm at one workload point, in its own process, printing one JSON
 *        object. Own process for the same reasons as the dirty probe: a cold
 *        heap, GC history and JIT profile are not shareable between arms.
 *
 *   node bench/replication-topology/arm.mjs --arm C --entities 100000 --churn 0.001
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';
import {
    loadSdk, TopologyJournal, Registry, buildPopulation, applyChurn,
    reconcileFull, reconcileIncremental,
} from './workload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const ARM = flag('arm', 'A');
const ENTITIES = Number(flag('entities', '10000'));
const CHURN = Number(flag('churn', '0'));
const SIM_HZ = Number(flag('simHz', '60'));
const REPL_HZ = Number(flag('replHz', '20'));
const WARMUP = Number(flag('warmup', '180'));
const MEASURE = Number(flag('measure', '600'));
/** Arm C only: run the full reconcile beside it and compare, every sample. */
const VERIFY = argv.includes('--verify');

const REPL_EVERY = Math.round(SIM_HZ / REPL_HZ);
// Per SAMPLE, spread over the sim ticks between two samples.
const CHURN_PER_SAMPLE = Math.max(0, Math.round(ENTITIES * CHURN));
const JOURNALLED = ARM !== 'A';

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

const pop = buildPopulation(sdk, world, ENTITIES);
const journal = JOURNALLED ? new TopologyJournal() : null;
const registry = new Registry();
// The oracle keeps its OWN registry, so what it reports is what a full scan
// would have found rather than what the incremental pass left behind.
const oracle = VERIFY ? new Registry() : null;

world.advanceTick();
reconcileFull(sdk, world, registry);
if (oracle) reconcileFull(sdk, world, oracle);

let writeNs = 0n;
let sampleNs = 0n;
let visited = 0;
let samples = 0;
let spawnedTotal = 0;
let despawnedTotal = 0;
let mismatches = 0;
let floor = world.getWorldTick() - 1;

/** How many entities to churn on this sim tick, so a sample's worth lands per sample. */
function churnForTick(t) {
    if (CHURN_PER_SAMPLE === 0) return 0;
    const base = Math.floor(CHURN_PER_SAMPLE / REPL_EVERY);
    const extra = (t % REPL_EVERY) < (CHURN_PER_SAMPLE % REPL_EVERY) ? 1 : 0;
    return base + extra;
}

function runTicks(count, measuring) {
    for (let t = 0; t < count; t++) {
        const tick = measuring ? WARMUP + t : t;
        const w0 = process.hrtime.bigint();
        applyChurn(sdk, world, pop, tick, churnForTick(tick), journal);
        world.advanceTick();
        const w1 = process.hrtime.bigint();
        if (measuring) writeNs += w1 - w0;

        if ((tick + 1) % REPL_EVERY !== 0) continue;

        const s0 = process.hrtime.bigint();
        const result = ARM === 'C'
            ? reconcileIncremental(sdk, world, registry, journal, floor)
            : reconcileFull(sdk, world, registry);
        const s1 = process.hrtime.bigint();

        if (measuring) {
            sampleNs += s1 - s0;
            samples++;
            visited += result.visited;
            spawnedTotal += result.spawned.length;
            despawnedTotal += result.despawned.length;
        }

        if (VERIFY) verify(result);
        const next = world.getWorldTick() - 1;
        journal?.advance(next);
        floor = next;
    }
}

/**
 * The narrow question: does the incremental registry end each sample in the
 * same state a full scan would, and name the same arrivals and departures?
 * netIds are allocated in different orders, so the SETS of entities are what
 * must agree, not the numbers stamped on them.
 */
function verify(result) {
    const truth = reconcileFull(sdk, world, oracle);
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    if (!same(result.spawned, truth.spawned)) mismatches++;
    else if (!same(result.despawned.map((d) => d.entity), truth.despawned.map((d) => d.entity))) mismatches++;
    else if (registry.known.size !== oracle.known.size) mismatches++;
    else {
        for (const e of registry.known) if (!oracle.known.has(e)) { mismatches++; break; }
    }
}

const heapBefore = process.memoryUsage().heapUsed;
runTicks(WARMUP, false);
runTicks(MEASURE, true);
const heapAfter = process.memoryUsage().heapUsed;

const simSeconds = MEASURE / SIM_HZ;
const writeUs = Number(writeNs) / 1000;
const sampleUs = Number(sampleNs) / 1000;
process.stdout.write(`${JSON.stringify({
    arm: ARM, entities: ENTITIES, churn: CHURN, verify: VERIFY,
    simSeconds, samples,
    writeTaxUsPerSimSecond: writeUs / simSeconds,
    sampleTaxUsPerSimSecond: sampleUs / simSeconds,
    totalTaxUsPerSimSecond: (writeUs + sampleUs) / simSeconds,
    visitedPerSample: samples > 0 ? visited / samples : 0,
    spawnedTotal, despawnedTotal,
    journalRows: journal?.size ?? 0,
    livePopulation: world.getEntitiesWithComponents([sdk.Replicated]).length,
    mismatches,
    heapDeltaBytes: heapAfter - heapBefore,
    gcCount, gcMs,
})}\n`);
