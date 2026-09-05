// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether one entity moving has to invalidate every connection.
 *
 * N3e made the sample in which NOTHING moved free. What it did not touch is the
 * sample in which something moved somewhere else: there is one spatial
 * generation, so a single write re-proves all C views. This asks what it would
 * cost to only invalidate the connections whose answer could have changed.
 *
 * Three shapes over one truth, and the truth is the shipped provider — every arm
 * decides only WHETHER to call `prepared.query`, never what it answers:
 *
 *   G   one global generation — what ships. Anything moves, everyone re-queries.
 *   A   query-footprint fingerprint. Before querying, walk the cells this
 *       connection's radius covers and combine their revisions; unchanged means
 *       the entity traversal is skipped.
 *   B   reverse cell -> connections. A mutation marks the connections registered
 *       on that cell; the query reads one per-connection flag.
 *
 * The question A exists to answer is whether scanning a few dozen cell
 * revisions is already close enough to free that B's second reverse index is
 * not worth maintaining.
 *
 *   node bench/interest-regional/probe.mjs --scenario near
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
/** 1 = anchors spread over the whole map, small = packed into a corner. */
const CLUSTER = Number(flag('cluster', '1'));
const SCENARIO = flag('scenario', 'scattered');
const WARMUP = Number(flag('warmup', '8'));
const MEASURE = Number(flag('measure', '40'));
/** Full-rebuild agreement is O(C x E) and is the point of the probe, not its
 *  cost — it runs on a few samples, not all of them. */
const AUDIT = Number(flag('audit', '4'));

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
const RADIUS = VISIBLE >= 1 ? side * 2 : Math.sqrt((VISIBLE * ENTITIES) / Math.PI);
/** The provider's own cell size, reproduced: the footprint IS its 3x3x3 scan. */
const CELL = Math.max(RADIUS, Number.EPSILON);
const cellOf = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;

const entities = new Array(ENTITIES);
const at = new Array(ENTITIES);
for (let i = 0; i < ENTITIES; i++) {
    const e = world.spawn();
    const p = { x: i % side, y: Math.floor(i / side), z: 0 };
    world.insert(e, sdk.Transform, { position: p });
    entities[i] = e;
    at[i] = p;
}

/** One anchor per connection. Index into `entities`, so a moved anchor moves. */
const anchorIdx = new Map();
const span = Math.max(1, Math.floor(ENTITIES * CLUSTER));
const stride = Math.max(1, Math.floor(span / CONNECTIONS));
for (let c = 0; c < CONNECTIONS; c++) anchorIdx.set(c + 1, (c * stride) % ENTITIES);

world.ensureTransformsComposed();
const provider = sdk.radiusInterestProvider(RADIUS);
let prepared = provider.prepare({
    world, entities, entityCount: ENTITIES, entered: entities, left: [], rechecked: [],
});

/** An independent full rebuild — the only thing that can say an arm went stale. */
function freshVisible(idx) {
    const a = at[idx];
    const out = new Set();
    const r2 = RADIUS * RADIUS;
    for (let i = 0; i < ENTITIES; i++) {
        const p = at[i];
        const dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z;
        if (dx * dx + dy * dy + dz * dz <= r2) out.add(entities[i]);
    }
    return out;
}

// ── the regional bookkeeping the provider does not have ──────────────────────
/** cell key -> how many times anything in it moved, entered or left. */
const cellRev = new Map();
const revOf = (k) => cellRev.get(k) ?? 0;
let placelessRev = 0;
let bump = 0;
/** Distinct cells a sample touches, against how many the world has. This is the
 *  whole ceiling: once a sample touches most of the grid, no footprint over that
 *  grid can be quiet, however the token is computed. */
let touchedThisSample = new Set();
let distinctTouched = 0;
function touchCell(k) { cellRev.set(k, revOf(k) + 1); bump++; touchedThisSample.add(k); }

/** The cells one connection's radius can reach: the provider's own 3x3x3. */
function footprint(idx) {
    const a = at[idx];
    const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL), cz = Math.floor(a.z / CELL);
    const out = [];
    for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) out.push(`${cx + dx},${cy + dy},${cz + dz}`);
    return out;
}

/**
 * A token over the whole support region, not over the anchor's cell. The keys
 * are in it as well as the revisions: an anchor that crossed into a new cell has
 * a different footprint, and the cells it left could then go unwatched.
 */
function fingerprint(cells) {
    let h = 0x811c9dc5 ^ placelessRev;
    for (const k of cells) {
        for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
        h = Math.imul(h ^ revOf(k), 0x01000193);
    }
    return h >>> 0;
}

// ── arms ────────────────────────────────────────────────────────────────────
const arms = {
    G: { recomputes: 0, queryNs: 0n, taxNs: 0n, held: new Map(), token: new Map() },
    A: { recomputes: 0, queryNs: 0n, taxNs: 0n, held: new Map(), token: new Map() },
    B: { recomputes: 0, queryNs: 0n, taxNs: 0n, held: new Map(), token: new Map() },
};
let globalGen = 0;

/** B's reverse index: cell -> connections whose footprint covers it. */
const watchers = new Map();
const watchedBy = new Map();
const dirtyConns = new Set();
function registerB(c, cells) {
    for (const k of watchedBy.get(c) ?? []) watchers.get(k)?.delete(c);
    watchedBy.set(c, cells);
    for (const k of cells) {
        let s = watchers.get(k);
        if (!s) { s = new Set(); watchers.set(k, s); }
        s.add(c);
    }
}
for (const [c, idx] of anchorIdx) registerB(c, footprint(idx));

function query(c, idx) {
    return prepared.query({ connectionId: c, owned: [entities[idx]] });
}

// ── one sample's world change ───────────────────────────────────────────────
function mutate(tick) {
    touchedThisSample = new Set();
    const moved = Math.round(ENTITIES * MOVEMENT);
    const anchors = [...anchorIdx.values()];
    const near = anchors[tick % anchors.length];
    for (let k = 0; k < moved; k++) {
        let i;
        if (SCENARIO === 'far') {
            // Deterministically far from every anchor: the midpoint between two.
            const a = anchors[k % anchors.length], b = anchors[(k + 1) % anchors.length];
            i = ((a + b) >> 1) % ENTITIES;
            if (anchorIdx.size && anchors.includes(i)) i = (i + 7919) % ENTITIES;
        } else if (SCENARIO === 'near') {
            i = (near + 1 + k) % ENTITIES;
        } else if (SCENARIO === 'anchor') {
            i = anchors[k % anchors.length];
        } else {
            i = (tick * 7919 + k * 7919) % ENTITIES;
        }
        const p = at[i];
        const before = cellOf(p.x, p.y, p.z);
        // 'boundary' walks entities across a cell edge every sample; the others
        // jitter within one, which still changes distances.
        const step = SCENARIO === 'boundary' ? CELL : ((tick + k) % 3) - 1;
        p.x += step;
        world.update(entities[i], sdk.Transform, (t) => { t.position.x = p.x; });
        const after = cellOf(p.x, p.y, p.z);
        touchCell(before);
        if (after !== before) touchCell(after);
    }
    return moved;
}

function sample(tick, timed) {
    mutate(tick);
    // After the world changed and before anybody is asked: a mark that ran
    // first would hand B the PREVIOUS sample's mutations and the audit would
    // catch it a sample later as stale visibility.
    distinctTouched += touchedThisSample.size;
    const marked = markB();
    if (timed) arms.B.taxNs += marked;
    world.ensureTransformsComposed();
    prepared = provider.prepare({
        world, entities, entityCount: ENTITIES, entered: [], left: [], rechecked: [],
    });
    globalGen++;

    // Rotated per sample: all three arms call the same `prepared.query`, so a
    // fixed order lets the last one read caches the first two warmed — it
    // reported A and B 40% faster on samples where all three did equal work.
    const order = ['G', 'A', 'B'];
    for (let r = 0; r < tick % order.length; r++) order.push(order.shift());

    for (const [c, idx] of anchorIdx) {
        for (const name of order) step[name](c, idx, timed);
    }
    dirtyConns.clear();
}

/** One arm's decision for one connection. Only WHETHER to query differs. */
const step = {
    G(c, idx, timed) {
        const a = arms.G;
        if (a.token.get(c) === globalGen) return;
        const t0 = process.hrtime.bigint();
        a.held.set(c, query(c, idx));
        if (timed) a.queryNs += process.hrtime.bigint() - t0;
        a.recomputes++;
        a.token.set(c, globalGen);
    },
    A(c, idx, timed) {
        const a = arms.A;
        const t0 = process.hrtime.bigint();
        const fp = fingerprint(footprint(idx));
        if (timed) a.taxNs += process.hrtime.bigint() - t0;
        if (a.token.get(c) === fp) return;
        const t1 = process.hrtime.bigint();
        a.held.set(c, query(c, idx));
        if (timed) a.queryNs += process.hrtime.bigint() - t1;
        a.recomputes++;
        a.token.set(c, fp);
    },
    B(c, idx, timed) {
        const a = arms.B;
        if (!dirtyConns.has(c) && a.token.has(c)) return;
        const t1 = process.hrtime.bigint();
        a.held.set(c, query(c, idx));
        if (timed) a.queryNs += process.hrtime.bigint() - t1;
        a.recomputes++;
        a.token.set(c, 1);
        const t2 = process.hrtime.bigint();
        registerB(c, footprint(idx));
        if (timed) a.taxNs += process.hrtime.bigint() - t2;
    },
};

/** B's maintenance: a cell that moved marks everyone watching it. Charged to B. */
function markB() {
    const t0 = process.hrtime.bigint();
    for (const [k, rev] of cellRev) {
        if (rev === lastSeenRev.get(k)) continue;
        lastSeenRev.set(k, rev);
        for (const c of watchers.get(k) ?? []) dirtyConns.add(c);
    }
    return process.hrtime.bigint() - t0;
}
const lastSeenRev = new Map();

function audit(tick) {
    for (const [c, idx] of anchorIdx) {
        const want = freshVisible(idx);
        for (const name of ['G', 'A', 'B']) {
            const got = arms[name].held.get(c);
            if (!got) { fail(name, c, tick, 'never answered'); return; }
            if (got.size !== want.size) {
                fail(name, c, tick, `holds ${got.size} where a rebuild says ${want.size}`); return;
            }
            for (const e of want) if (!got.has(e)) { fail(name, c, tick, `missing ${e}`); return; }
        }
    }
}
function fail(name, c, tick, why) {
    process.stderr.write(`arm ${name}, connection ${c}, sample ${tick}: ${why}\n`);
    process.exit(1);
}

for (let t = 0; t < WARMUP; t++) sample(t, false);
for (const a of Object.values(arms)) { a.recomputes = 0; a.queryNs = 0n; a.taxNs = 0n; }
bump = 0;

for (let t = 0; t < MEASURE; t++) {
    sample(WARMUP + t, true);
    if (t >= MEASURE - AUDIT) audit(WARMUP + t);
}

const per = (v) => Number(v) / 1000 / MEASURE;
process.stdout.write(`${JSON.stringify({
    scenario: SCENARIO, entities: ENTITIES, connections: CONNECTIONS,
    visible: VISIBLE, movement: MOVEMENT, cluster: CLUSTER, samples: MEASURE,
    cellRevBumpsPerSample: bump / MEASURE,
    distinctCellsTouchedPerSample: distinctTouched / MEASURE,
    cellsInWorld: cellRev.size,
    footprintCells: 27,
    arms: Object.fromEntries(Object.entries(arms).map(([k, a]) => [k, {
        recomputesPerSample: a.recomputes / MEASURE,
        recomputesPerConnection: a.recomputes / MEASURE / CONNECTIONS,
        queryUsPerSample: per(a.queryNs),
        taxUsPerSample: per(a.taxNs),
        totalUsPerSample: per(a.queryNs + a.taxNs),
    }])),
    ...sdkIdentity(ROOT),
})}\n`);
