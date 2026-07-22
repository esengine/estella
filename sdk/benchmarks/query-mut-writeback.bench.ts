// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query-mut-writeback.bench.ts
 * @brief   Quantify the cost of recording change tracking on the Mut() write-back
 *          hot path for BUILTIN (wasm-backed) components. The fix adds one
 *          world.markChanged() to the builtin-setter branch; recordChanged()
 *          self-gates on trackedComponents_, so with no Changed()/Added() query
 *          listening it is a Set.has() + return. This bench shows the untracked
 *          path stays close to the read-only floor, and the tracked delta (the
 *          Map.set that only runs when someone is actually listening) is small.
 */
import { bench, describe } from 'vitest';
import { World } from '../src/world';
import { Query, QueryInstance, Mut } from '../src/query';
import { Transform, type TransformData } from '../src/component';
import { createMockModule } from '../tests/mocks/wasm';

const N = 5000;

function defaultTransform(): TransformData {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 },
        worldRotation: { w: 1, x: 0, y: 0, z: 0 },
        worldScale: { x: 1, y: 1, z: 1 },
    } as TransformData;
}

function makeWorld(track: boolean): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    if (track) world.enableChangeTracking(Transform);
    for (let i = 0; i < N; i++) {
        world.insert(world.spawn(), Transform, defaultTransform());
    }
    return world;
}

describe(`Mut() write-back over ${N} builtin components`, () => {
    const untracked = makeWorld(false);
    const tracked = makeWorld(true);
    const readWorld = makeWorld(false);

    const qUntracked = new QueryInstance(untracked, Query(Mut(Transform)), -1);
    const qTracked = new QueryInstance(tracked, Query(Mut(Transform)), -1);
    const qReadOnly = new QueryInstance(readWorld, Query(Transform), -1);

    // Floor: iterate + read, no Mut write-back at all.
    bench('read-only iteration (no write-back)', () => {
        qReadOnly.forEach(() => { /* read only */ });
    });

    // Common case: Mut write-back, nobody listening → markChanged is Set.has + return.
    bench('Mut write-back, component NOT tracked', () => {
        qUntracked.forEach((_e, t) => { (t as TransformData).position.x += 1; });
    });

    // Worst case: Mut write-back with a live Changed() listener → records a Map.set.
    bench('Mut write-back, component tracked', () => {
        qTracked.forEach((_e, t) => { (t as TransformData).position.x += 1; });
    });
});
