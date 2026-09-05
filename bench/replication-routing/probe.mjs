// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Does the routing crossover survive JavaScript's Map and Set?
 *
 * N3a said push wins while `U + F < S` and pull past it. That is a count. This
 * runs the two, and a chooser that decides per sample from those exact facts,
 * over the shipped provider's real visibility — and checks all four produce the
 * same plan before believing any of the times.
 *
 * Production is untouched: nothing here is installed on a server.
 *
 *   node bench/replication-routing/probe.mjs
 */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    mergeByEntity, routeCurrent, routePush, routePull, routeAdaptive, fanout,
} from './routers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { loadSdk, sdkIdentity } = await import(pathToFileURL(
    path.join(ROOT, 'bench/replication-interest/workload.mjs')).href);

// =============================================================================
// The shapes a router has to get right, before any of them is timed
// =============================================================================

/** A plan, as the wire would carry it: removals then delta, in row order. */
const shape = (plan) => `${plan.removals.join(',')}|${plan.delta.join(',')}`;
const plansAgree = (a, b) => {
    if (a.size !== b.size) return false;
    for (const [id, plan] of a) if (shape(plan) !== shape(b.get(id) ?? { removals: [], delta: [] })) return false;
    return true;
};

function runAll(conns, dirty, removals, entered, viewers) {
    const affected = mergeByEntity(dirty, removals);
    let membership = 0;
    for (const c of conns) membership += c.visible.size;
    const { rows } = fanout(affected, viewers);
    return {
        A: routeCurrent(conns, dirty, removals, entered),
        P: routePush(conns, dirty, removals, entered, rows),
        L: routePull(conns, dirty, removals, entered, affected),
        H: routeAdaptive(conns, dirty, removals, entered, affected, viewers, membership),
    };
}

/** The cases where a router can be wrong in a way a total would not show. */
function shapesHold() {
    const failures = [];
    const check = (name, conns, dirty, removals, entered, viewers) => {
        const r = runAll(conns, dirty, removals, entered, viewers);
        for (const arm of ['P', 'L', 'H']) {
            if (!plansAgree(r.A.out, r[arm].out)) failures.push(`${name}: ${arm} disagrees with A`);
        }
    };
    const conn = (id, visible) => ({ id, visible: new Set(visible) });
    const viewersOf = (pairs) => new Map(pairs.map(([e, ids]) => [e, new Set(ids)]));
    const noEnters = (ids) => new Map(ids.map((id) => [id, new Set()]));

    check('one entity, several dirty components',
        [conn(0, [7])],
        [{ entity: 7, netId: 7, componentId: 1 }, { entity: 7, netId: 7, componentId: 2 },
            { entity: 8, netId: 8, componentId: 1 }],
        [], noEnters([0]), viewersOf([[7, [0]], [8, []]]));

    check('dirty and a removal on the same entity',
        [conn(0, [7])],
        [{ entity: 7, netId: 7, componentId: 1 }],
        [{ entity: 7, netId: 7, componentId: 2 }],
        noEnters([0]), viewersOf([[7, [0]]]));

    check('an entity that entered this sample owes nothing extra',
        [conn(0, [7, 9])],
        [{ entity: 7, netId: 7, componentId: 1 }, { entity: 9, netId: 9, componentId: 1 }],
        [{ entity: 7, netId: 7, componentId: 2 }],
        new Map([[0, new Set([7])]]), viewersOf([[7, [0]], [9, [0]]]));

    check('an entity that left is not in anyone view',
        [conn(0, [9])],
        [{ entity: 7, netId: 7, componentId: 1 }],
        [{ entity: 7, netId: 7, componentId: 2 }],
        noEnters([0]), viewersOf([[7, []], [9, [0]]]));

    const eight = Array.from({ length: 8 }, (_, i) => conn(i, [7]));
    check('one entity, eight connections',
        eight,
        [{ entity: 7, netId: 7, componentId: 1 }], [],
        noEnters(eight.map((c) => c.id)), viewersOf([[7, [0, 1, 2, 3, 4, 5, 6, 7]]]));

    check('an entity nobody can see',
        [conn(0, [9])],
        [{ entity: 7, netId: 7, componentId: 1 }], [],
        noEnters([0]), viewersOf([[9, [0]]]));

    check('nothing happened at all', [conn(0, [9])], [], [], noEnters([0]), viewersOf([[9, [0]]]));
    return failures;
}

const failures = shapesHold();
if (failures.length > 0) {
    console.error('The routers do not agree on the shapes that matter:\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}

// =============================================================================
// The workload: the shipped provider's real visibility over a real world
// =============================================================================

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const ENTITIES = Number(flag('entities', '100000'));
const CONNECTIONS = Number(flag('connections', '32'));
const VISIBLE = Number(flag('visible', '0.01'));
const SAMPLES = Number(flag('samples', '12'));

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

/** One anchor per connection; `cluster` decides how much of the map they share. */
function anchorsFor(cluster) {
    const span = Math.max(1, Math.floor(ENTITIES * cluster));
    const stride = Math.max(1, Math.floor(span / CONNECTIONS));
    return Array.from({ length: CONNECTIONS }, (_, c) => [entities[(c * stride) % ENTITIES]]);
}

/**
 * The reverse projection of `conn.interest`, maintained from enters and leaves —
 * the server's fact, not the provider's. N3a measured twelve events a sample
 * across thirty-two connections, which is what makes this affordable.
 */
function reverseIndex() {
    const viewers = new Map();
    return {
        viewers,
        enter(e, id) {
            let seen = viewers.get(e);
            if (!seen) { seen = new Set(); viewers.set(e, seen); }
            seen.add(id);
        },
        leave(e, id) {
            const seen = viewers.get(e);
            if (!seen) return;
            seen.delete(id);
            if (seen.size === 0) viewers.delete(e);
        },
    };
}

const POINTS = [
    { name: 'scattered mixed — 1% dirty, 0.1% removed', dirty: 0.01, removals: 0.001, cluster: 1 },
    { name: 'clustered mixed — same rates, packed', dirty: 0.01, removals: 0.001, cluster: 0.001 },
    { name: 'everything dirty', dirty: 1, removals: 0, cluster: 1 },
    { name: 'removals 10%', dirty: 0, removals: 0.1, cluster: 1 },
    { name: 'movement only — the floor is made of this', dirty: 0, removals: 0, cluster: 1 },
];
const MOVEMENT = 0.01;

function measure(point) {
    const anchors = anchorsFor(point.cluster);
    const conns = Array.from({ length: CONNECTIONS }, (_, id) => ({ id, visible: new Set(), interest: new Set() }));
    const index = reverseIndex();
    // L2 is L again, by the same call, from a second site. Two arms running
    // identical code are the only honest scale for "is that difference real".
    const arms = { A: { ns: 0, visits: 0, min: Infinity }, P: { ns: 0, visits: 0, min: Infinity },
        L: { ns: 0, visits: 0, min: Infinity }, H: { ns: 0, visits: 0, min: Infinity },
        L2: { ns: 0, visits: 0, min: Infinity } };
    const chose = { push: 0, pull: 0 };
    let mismatches = 0;
    let units = { push: 0, pull: 0 };

    for (let tick = 0; tick < SAMPLES + 4; tick++) {
        // — what the world did —
        const dirty = [];
        const removals = [];
        const touched = new Set();
        for (let k = 0, n = Math.round(ENTITIES * MOVEMENT); k < n; k++) {
            const e = entities[(tick * 7919 + k * 7919) % ENTITIES];
            world.update(e, sdk.Transform, (d) => { d.position.x += ((tick + k) % 3) - 1; });
            if (!touched.has(e)) { touched.add(e); dirty.push({ entity: e, netId: e, componentId: 0 }); }
        }
        for (let k = 0, n = Math.round(ENTITIES * point.dirty); k < n; k++) {
            const e = entities[(tick * 104729 + k * 104729) % ENTITIES];
            if (touched.has(e)) continue;
            touched.add(e);
            dirty.push({ entity: e, netId: e, componentId: 1 });
        }
        for (let k = 0, n = Math.round(ENTITIES * point.removals); k < n; k++) {
            const e = entities[(tick * 15485863 + k * 15485863) % ENTITIES];
            removals.push({ entity: e, netId: e, componentId: 1 });
        }

        // — what each connection can see, from the shipped provider —
        world.ensureTransformsComposed();
        const prepared = provider.prepare({
            world, entities, entityCount: entities.length,
            entered: tick === 0 ? entities : [], left: [], rechecked: [],
        });
        const entered = new Map();
        for (const c of conns) {
            const answer = prepared.query({ connectionId: c.id, owned: anchors[c.id] });
            const visible = answer === 'all' ? new Set(entities) : new Set(answer);
            for (const e of anchors[c.id]) visible.add(e);
            const enters = new Set();
            for (const e of visible) if (!c.interest.has(e)) { enters.add(e); index.enter(e, c.id); }
            for (const e of c.interest) if (!visible.has(e)) index.leave(e, c.id);
            c.visible = visible;
            c.interest = visible;
            entered.set(c.id, enters);
        }
        if (tick < 4) continue;   // warm the world, the provider and the index

        // — the four routers over one truth, in a rotating order —
        const affected = mergeByEntity(dirty, removals);
        let membership = 0;
        for (const c of conns) membership += c.visible.size;
        // Rotated by the tick, so no arm always runs last into caches the ones
        // before it warmed. Rotating a fixed four times, as this did first, puts
        // the array back where it started and gave H a 20% head start.
        const order = ['A', 'P', 'L', 'H', 'L2'];
        for (let r = 0; r < tick % order.length; r++) order.push(order.shift());
        const results = {};
        for (const arm of order) {
            const t0 = process.hrtime.bigint();
            let out;
            if (arm === 'A') out = routeCurrent(conns, dirty, removals, entered);
            else if (arm === 'P') out = routePush(conns, dirty, removals, entered, fanout(affected, index.viewers).rows);
            else if (arm === 'L') out = routePull(conns, dirty, removals, entered, affected);
            else if (arm === 'L2') out = routePull(conns, dirty, removals, entered, affected);
            else out = routeAdaptive(conns, dirty, removals, entered, affected, index.viewers, membership);
            const dt = Number(process.hrtime.bigint() - t0);
            arms[arm].ns += dt;
            arms[arm].min = Math.min(arms[arm].min, dt / 1000);
            arms[arm].visits += out.visits;
            results[arm] = out;
        }
        for (const arm of ['P', 'L', 'H', 'L2']) if (!plansAgree(results.A.out, results[arm].out)) mismatches++;
        chose[results.H.chose]++;
        units = { push: results.H.pushUnits, pull: results.H.pullUnits, exact: results.H.exact };
    }

    const n = SAMPLES;
    return {
        name: point.name, mismatches, chose, units,
        arms: Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, {
            usMin: v.min, usMean: v.ns / 1000 / n, visits: v.visits / n,
        }])),
    };
}

const rows = POINTS.map((p) => { process.stderr.write(`${p.name}\n`); return measure(p); });

const say = (s = '') => console.log(s);
const pad = (v, w) => String(v).padStart(w);
say('');
say(`=== routing one sample's debt (${ENTITIES} entities, ${CONNECTIONS} connections, ${VISIBLE * 100}% visible) ===`);
say('');
say('  A  every connection walks every row — what ships');
say('  P  every affected entity is handed to the connections that see it');
say('  L  every connection asks its own view what happened');
say('  H  whichever of the two is smaller, decided from this sample\'s own counts');
say('');
const dirtyPlans = rows.every((r) => r.mismatches === 0);
say(dirtyPlans
    ? '  Every arm produced the same plan for every connection, every sample —'
      + ' removals and delta rows, in order.'
    : '  PLANS DISAGREE — the numbers below mean nothing.');
say('');
say('  visits per sample');
say('  workload                                        A         P         L         H');
for (const r of rows) {
    say(`  ${r.name.padEnd(42)} ${pad(Math.round(r.arms.A.visits), 8)} ${pad(Math.round(r.arms.P.visits), 9)}`
        + ` ${pad(Math.round(r.arms.L.visits), 9)} ${pad(Math.round(r.arms.H.visits), 9)}`);
}
say('');
say('  us per sample (fastest). L2 is L again — the scale for what counts as a difference.');
say('  workload                                        A         P         L        L2         H   H picked');
for (const r of rows) {
    const best = Math.min(r.arms.P.usMin, r.arms.L.usMin);
    const picked = r.chose.push >= r.chose.pull ? 'push' : 'pull';
    const tail = `${picked} ${r.arms.H.usMin <= best * 1.1 ? '' : `(${(r.arms.H.usMin / best).toFixed(1)}x)`}`;
    say(`  ${r.name.padEnd(42)} ${pad(r.arms.A.usMin.toFixed(1), 8)} ${pad(r.arms.P.usMin.toFixed(1), 9)}`
        + ` ${pad(r.arms.L.usMin.toFixed(1), 9)} ${pad(r.arms.L2.usMin.toFixed(1), 9)}`
        + ` ${pad(r.arms.H.usMin.toFixed(1), 9)}  ${tail}`);
}
say('');
const noise = Math.max(...rows.map((r) => Math.abs(r.arms.L.usMin - r.arms.L2.usMin) / Math.min(r.arms.L.usMin, r.arms.L2.usMin)));
say(`  L against L2, the same code twice: up to ${(noise * 100).toFixed(0)}% apart. Nothing`);
say('  closer than that is a difference this harness can see.');
say('');
say('  what H decided on');
say('  workload                                   U + F      S   push/pull    how');
for (const r of rows) {
    say(`  ${r.name.padEnd(42)} ${pad(r.units.push, 6)} ${pad(r.units.pull, 6)}`
        + `   ${pad(`${r.chose.push}/${r.chose.pull}`, 8)}   ${r.units.exact ? 'exact' : 'U >= S'}`);
}
say('');
say(`  ${JSON.stringify({ ...sdkIdentity(ROOT), cpu: os.cpus()[0]?.model })}`);
