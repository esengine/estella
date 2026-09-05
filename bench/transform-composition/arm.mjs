// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What it costs for a composition to say which world transforms moved.
 *
 * The composition already walks every transform when anything is stale. A
 * consumer keyed on world position — a spatial index, a replication journal —
 * wants the entities whose OUTPUT differs, which is a strictly smaller set than
 * the one the walk visits: on a flat world the walk visits all of them whatever
 * moved. This times the same compose with and without producing that set.
 *
 *   node bench/transform-composition/arm.mjs --arm B --shape flat --mutate local
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const SHAPE = flag('shape', 'flat');
const MUTATE = flag('mutate', 'local');
const ENTITIES = Number(flag('entities', '100000'));
const CHILDREN = Number(flag('children', '99'));
const RATE = Number(flag('rate', '0.01'));
const WARMUP = Number(flag('warmup', '10'));
const MEASURE = Number(flag('measure', '40'));

const sdk = await import(pathToFileURL(path.join(ROOT, 'sdk', 'dist', 'index.node.js')).href);
const wasmDir = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const factory = (await import(pathToFileURL(path.join(wasmDir, 'esengine.js')).href)).default;
const module = await factory({ locateFile: (f) => path.join(wasmDir, f) });

const app = sdk.App.new();
app.connectCpp(new module.Registry(), module, { strict: false });
const world = app.world;
const registry = world.getCppRegistry();

/** Every entity, and the roots among them — a mutation picks from one or other. */
const all = [];
const roots = [];
if (SHAPE === 'flat') {
    for (let i = 0; i < ENTITIES; i++) {
        const e = world.spawn();
        world.insert(e, sdk.Transform, { position: { x: i, y: 0, z: 0 } });
        all.push(e); roots.push(e);
    }
} else {
    for (let i = 0; all.length < ENTITIES; i++) {
        const r = world.spawn();
        world.insert(r, sdk.Transform, { position: { x: i, y: 0, z: 0 } });
        all.push(r); roots.push(r);
        for (let c = 0; c < CHILDREN && all.length < ENTITIES; c++) {
            const kid = world.spawn();
            world.insert(kid, sdk.Transform, { position: { x: c, y: 0, z: 0 } });
            world.setParent(kid, r);
            all.push(kid);
        }
    }
}

const setter = world.resolveSetter(sdk.Transform);
const getter = world.resolveGetter(sdk.Transform, 'borrowed');
const K = Math.max(1, Math.round(all.length * RATE));
const R = Math.max(1, Math.round(roots.length * RATE));

/** One producer's worth of work, timed separately from the compose it makes stale. */
function mutate(tick) {
    switch (MUTATE) {
        case 'none': return;
        case 'still': {
            // Every write happens; none of them moves anything. The epoch cannot
            // tell the difference — comparing the output is the only thing that can.
            for (let i = 0; i < K; i++) { const t = getter(all[i]); setter(all[i], t); }
            break;
        }
        case 'parent': {
            // A share of the ROOTS, so what the subtree costs is visible: 1% of
            // all entities would be every root in this shape.
            for (let i = 0; i < R; i++) {
                const t = getter(roots[i]); t.position.x += 1; setter(roots[i], t);
            }
            break;
        }
        case 'reparent': {
            // One subtree changes parent and comes back, so the shape is steady.
            if (tick % 2 === 0) world.setParent(roots[1], roots[0]);
            else world.removeParent(roots[1]);
            return;   // setParent is a producer already; it announces for itself
        }
        default: {
            for (let i = 0; i < K; i++) {
                const t = getter(all[i]); t.position.x += 1; setter(all[i], t);
            }
        }
    }
    // The ptr setter writes the component heap and calls no C++, which is exactly
    // why a producer has to say so. One notification per pass, as a system does.
    world.invalidateTransformComposition();
}

const setTracking = module.transform_setChangeTracking;
const compositionChanges = module.transform_compositionChanges;
const takeChanges = module.transform_takeChanges;
let visitedSum = 0;
let changedSum = 0;
let ran = 0;
let seenSerial = -1;

// Both arms in one process, alternating passes. Run apart they disagreed by more
// than the thing being measured — B came out FASTER than A on the tree. Switching
// the mode and READING the set are the consumer's work, not the composition's, so
// both sit outside the timer.
function compose(collect) {
    setTracking(collect);
    const t0 = process.hrtime.bigint();
    world.ensureTransformsComposed();
    const dt = Number(process.hrtime.bigint() - t0);
    if (collect) {
        const r = compositionChanges();
        if (r.serial !== seenSerial) {
            seenSerial = r.serial;
            ran++; visitedSum += r.visited; changedSum += r.count;
        }
        takeChanges();
    }
    return dt;
}

for (let t = 0; t < WARMUP; t++) { mutate(t); compose(t % 2 === 1); }
ran = 0; visitedSum = 0; changedSum = 0;
let nsA = 0;
let nsB = 0;
let passesA = 0;
let passesB = 0;
for (let t = 0; t < MEASURE; t++) {
    mutate(t);
    const collect = t % 2 === 1;
    const dt = compose(collect);
    if (collect) { nsB += dt; passesB++; } else { nsA += dt; passesA++; }
}

// The world the two arms produced between them, against what it should be: an
// arm that composed nothing would time beautifully and mean nothing. For the
// tree the probe is a CHILD, which is the path that publishes a matrix.
const probe = SHAPE === 'flat' ? all[0] : all[1];
const composed = world.get(probe, sdk.Transform).worldPosition;
const localX = world.get(probe, sdk.Transform).position.x;
const parentX = SHAPE === 'flat' ? 0 : world.get(roots[0], sdk.Transform).position.x;
const expectedX = localX + parentX;

process.stdout.write(`${JSON.stringify({
    shape: SHAPE, mutate: MUTATE, entities: all.length, roots: roots.length,
    mutated: MUTATE === 'none' ? 0 : MUTATE === 'reparent' ? 1 : MUTATE === 'parent' ? R : K,
    passes: MEASURE, composedPasses: ran,
    usA: nsA / 1000 / passesA,
    usB: nsB / 1000 / passesB,
    oneCorePercentA: (nsA / 1000 / passesA) * 60 / 1e4,
    // Per COMPOSED pass: a workload that never goes stale composed none, and
    // averaging over the passes it skipped would report a fraction of a set.
    visited: ran ? Math.round(visitedSum / ran) : null,
    changed: ran ? Math.round(changedSum / ran) : null,
    composedX: composed.x, expectedX, agrees: composed.x === expectedX,
})}\n`);
