// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where a replication sample's time goes, after the optimisations.
 *
 * Seven population scans came out of this path — registry, dirty discovery,
 * ownership, position reads, grid rebuild, row routing, idle visibility. This
 * asks what is left, on the real server, as a budget rather than a total: every
 * phase is timed where it happens and `other` is the part the decomposition
 * fails to explain. A budget with a large remainder has not been decomposed.
 *
 *   node bench/sample-budget/arm.mjs --scenario mixed
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
const SCENARIO = flag('scenario', 'movement');
/** Time the provider's own answer, to split `visibility query` at that seam.
 *  Off by default: the budget table should not be measured through a wrapper
 *  that only exists to take it apart. */
const SEAM = argv.includes('--seam');
const WARMUP = Number(flag('warmup', '12'));
const MEASURE = Number(flag('measure', '60'));
const STEP = 1 / 60;

/**
 * `anchors` is mandatory rather than a variant: an owned anchor is one of its
 * own query's inputs, so a movement claim that skips it is a benchmark-only
 * cache.
 */
const PROFILE = {
    still: { movement: 0, dirty: 0, removals: 0, anchors: false },
    movement: { movement: 0.01, dirty: 0, removals: 0, anchors: false },
    anchors: { movement: 0.01, dirty: 0, removals: 0, anchors: true },
    mixed: { movement: 0.01, dirty: 0.01, removals: 0.001, anchors: true },
}[SCENARIO];
if (!PROFILE) throw new Error(`unknown scenario ${SCENARIO}`);

const { loadSdk, sdkIdentity } = await import(pathToFileURL(
    path.join(ROOT, 'bench/replication-interest/workload.mjs')).href);
const sdk = await loadSdk(ROOT);
const wasmDir = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const factory = (await import(pathToFileURL(path.join(wasmDir, 'esengine.js')).href)).default;
const engine = await factory({ locateFile: (f) => path.join(wasmDir, f) });

const Health = sdk.defineComponent('BudgetHealth', { hp: 0 }, { replicatedFields: ['hp'] });

const serverApp = sdk.App.new();
serverApp.connectCpp(new engine.Registry(), engine, { strict: false });
serverApp.addPlugin(sdk.replicationPlugin);
const server = serverApp.getResource(sdk.Net).startServer();
const world = serverApp.world;

const side = Math.ceil(Math.sqrt(ENTITIES));
const RADIUS = VISIBLE >= 1 ? side * 2 : Math.sqrt((VISIBLE * ENTITIES) / Math.PI);
/**
 * The provider's own answer, timed at the seam. `visibility query` is that plus
 * what the host does with it — copying the answer into a set it owns and forcing
 * the owned entities into it — so the difference says which half it is.
 */
const inner = sdk.radiusInterestProvider(RADIUS);
const provider = { queryNs: 0n, calls: 0 };
if (!SEAM) server.setInterestProvider(inner);
else server.setInterestProvider({
    prepare(view) {
        const prepared = inner.prepare(view);
        return {
            get generation() { return prepared.generation; },
            query: (q) => {
                const t0 = process.hrtime.bigint();
                const r = prepared.query(q);
                provider.queryNs += process.hrtime.bigint() - t0;
                provider.calls++;
                return r;
            },
        };
    },
    dispose: () => inner.dispose?.(),
});

/**
 * What the transport itself cost, and carried. `control send` is the server's
 * phase around `channel.send`, which is JSON encoding AND this — so encoding is
 * that phase minus what is measured here, rather than a second guess at it.
 */
const wire = { controlNs: 0n, controlBytes: 0, controlMsgs: 0, binaryNs: 0n, binaryBytes: 0 };
function meter(transport) {
    const send = transport.send.bind(transport);
    transport.send = (d) => {
        const t0 = process.hrtime.bigint();
        send(d);
        const dt = process.hrtime.bigint() - t0;
        if (typeof d === 'string') {
            wire.controlNs += dt; wire.controlBytes += d.length; wire.controlMsgs++;
        } else {
            wire.binaryNs += dt; wire.binaryBytes += d.byteLength ?? 0;
        }
    };
}

const clients = [];
for (let i = 0; i < CONNECTIONS; i++) {
    const app = sdk.App.new();
    app.connectCpp(new engine.Registry(), engine, { strict: false });
    app.addPlugin(sdk.replicationPlugin);
    const [ta, tb] = sdk.MemoryTransport.pair();
    meter(ta);
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
/** Keyed by the id the SERVER gave the connection: ids start at one, and a
 *  connection owning nothing fails open to `'all'` — the bug that was every
 *  wall time in this campaign until it was reconciled against the census. */
const ownedIdx = new Map();
const stride = Math.max(1, Math.floor(ENTITIES / CONNECTIONS));
for (const [c, client] of clients.entries()) {
    const i = (c * stride) % ENTITIES;
    world.set(entities[i], sdk.Replicated, { owner: client.id });
    ownedIdx.set(client.id, i);
}

const MOVE = Math.round(ENTITIES * PROFILE.movement);
const DIRTY_ROWS = Math.round(ENTITIES * PROFILE.dirty);
const REMOVE_ROWS = Math.round(ENTITIES * PROFILE.removals);
let restoring = [];

function mutate(tick) {
    for (let k = 0; k < MOVE; k++) {
        const e = entities[(tick * 7919 + k * 7919) % ENTITIES];
        world.update(e, sdk.Transform, (d) => { d.position.x += ((tick + k) % 3) - 1; });
    }
    if (PROFILE.anchors) {
        for (const i of ownedIdx.values()) {
            world.update(entities[i], sdk.Transform, (d) => { d.position.x += (tick % 3) - 1; });
        }
    }
    for (let k = 0; k < DIRTY_ROWS; k++) {
        const e = entities[(tick * 104729 + k * 104729) % ENTITIES];
        if (!world.has(e, Health)) continue;
        world.update(e, Health, (d) => { d.hp = (d.hp + 1) & 0xffff; });
    }
    for (const e of restoring) {
        if (world.valid(e)) world.insert(e, Health, { hp: 100 });
    }
    restoring = [];
    for (let k = 0; k < REMOVE_ROWS; k++) {
        const e = entities[(tick * 15485863 + k * 15485863) % ENTITIES];
        if (!world.has(e, Health)) continue;
        world.remove(e, Health);
        restoring.push(e);
    }
}

/** The server's own view against an independent one. They diverged silently for
 *  a whole campaign and every wall time was the difference. */
const canonical = (w, e) => {
    if (!w.has(e, sdk.Transform)) return null;
    const t = w.tryGet(e, sdk.Transform);
    return t ? { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z } : null;
};
function census() {
    world.ensureTransformsComposed();
    const prepared = sdk.radiusInterestProvider(RADIUS, { position: canonical })
        .prepare({ world, entities, entityCount: entities.length });
    let counted = 0;
    for (const [c, i] of ownedIdx) {
        const answer = prepared.query({ connectionId: c, owned: [entities[i]] });
        counted += answer === 'all' ? entities.length : answer.size;
    }
    const links = server.viewerLinks;
    if (Math.abs(links - counted) > CONNECTIONS) {
        process.stderr.write(`the server holds ${links} viewer links where an independent `
            + `provider counts ${counted} — they are not looking at the same world\n`);
        process.exit(1);
    }
    return counted;
}

for (let t = 0; t < WARMUP; t++) { mutate(t); await serverApp.tick(STEP); }
const visible = census();

server.samplePhases.clear();
server.visibilityRecomputes = 0;
server.entersSent = 0; server.leavesSent = 0; server.payloadsBuilt = 0;
server.journalReads = 0; server.populationScans = 0;
server.dirtyCandidates = 0; server.deltaRowsSent = 0;
provider.queryNs = 0n; provider.calls = 0;
wire.controlNs = 0n; wire.controlBytes = 0; wire.controlMsgs = 0;
wire.binaryNs = 0n; wire.binaryBytes = 0;
server.profileSample = true;
let tickNs = 0n;
let fastest = Infinity;
for (let t = 0; t < MEASURE; t++) {
    mutate(WARMUP + t);
    const t0 = process.hrtime.bigint();
    await serverApp.tick(STEP);
    const dt = Number(process.hrtime.bigint() - t0);
    tickNs += BigInt(dt);
    fastest = Math.min(fastest, dt / 1000);
}
server.profileSample = false;
census();

const LEAVES = [
    'composition', 'registry', 'owner index', 'interest prepare', 'visibility query',
    'visibility diff', 'dirty discovery', 'routing', 'spawn payload', 'frame encode',
    'control send', 'transport send', 'ack', 'reader floors',
];
const ms = (k) => (server.samplePhases.get(k) ?? 0) / MEASURE;
const phases = Object.fromEntries(LEAVES.map((k) => [k, ms(k) * 1000]));
const total = ms('total') * 1000;
const accounted = LEAVES.reduce((a, k) => a + phases[k], 0);
phases.other = total - accounted;

const tickUs = Number(tickNs) / 1000 / MEASURE;
const perSample = (v) => Number(v) / MEASURE;
// Encoding is what the phase cost minus what the transport under it cost. A
// negative here would mean the two clocks disagree, not that encoding is free.
const controlTransportUs = Number(wire.controlNs) / 1000 / MEASURE;
const controlEncodeUs = phases['control send'] - controlTransportUs;
process.stdout.write(`${JSON.stringify({
    scenario: SCENARIO, entities: ENTITIES, connections: CONNECTIONS, visible: VISIBLE,
    ...PROFILE, samples: MEASURE,
    visiblePerConnection: visible / CONNECTIONS,
    viewerLinks: server.viewerLinks,
    visibilityRecomputesPerSample: server.visibilityRecomputes / MEASURE,
    entersPerSample: server.entersSent / MEASURE,
    leavesPerSample: server.leavesSent / MEASURE,
    spawnPayloadsPerSample: server.payloadsBuilt / MEASURE,
    // The whole App tick, the server's own sample, and what the phases explain.
    usPerTickMean: tickUs, usPerTickMin: fastest,
    usPerSampleTotal: total,
    usOutsideSample: tickUs - total,
    accountedPercent: total > 0 ? (accounted / total) * 100 : 0,
    phases,
    // `control send` split by the transport's own clock, not by a second model.
    controlEncodeUs, controlTransportUs,
    // `visibility query` split at the provider seam: what it computed, against
    // what the host spent turning that into a set of its own.
    seam: SEAM,
    providerQueryUs: SEAM ? Number(provider.queryNs) / 1000 / MEASURE : null,
    hostVisibilityUs: SEAM
        ? phases['visibility query'] - Number(provider.queryNs) / 1000 / MEASURE : null,
    /**
     * The work, beside the time. A phase that grows because one of these grew is
     * doing more of something real; a phase that grows while these hold still is
     * spending more to establish that nothing happened.
     */
    work: {
        visibilityRecomputes: server.visibilityRecomputes / MEASURE,
        dirtyCandidates: server.dirtyCandidates / MEASURE,
        journalReads: server.journalReads / MEASURE,
        populationScans: server.populationScans / MEASURE,
        enters: server.entersSent / MEASURE,
        leaves: server.leavesSent / MEASURE,
        spawnPayloadsBuilt: server.payloadsBuilt / MEASURE,
        deltaRowsSent: server.deltaRowsSent / MEASURE,
        controlMessages: perSample(wire.controlMsgs),
        controlBytes: perSample(wire.controlBytes),
        binaryBytes: perSample(wire.binaryBytes),
    },
    ...sdkIdentity(ROOT),
})}\n`);
