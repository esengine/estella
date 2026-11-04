// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A Mut row the iterator handed out stays live until the system returns: collect
 * the rows, decide, then edit the chosen one. An engine-backed component's row is
 * a copy, and an edit made after the loop had moved on was silently dropped.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { Query, QueryInstance, Mut } from '../src/ecs/query';
import { Transform, type TransformData } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';

function transformAt(x: number): TransformData {
    return {
        position: { x, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x, y: 0, z: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 }, worldScale: { x: 1, y: 1, z: 1 },
    } as TransformData;
}

describe('kept Mut rows', () => {
    it('an edit made after the loop reaches the engine once the system returns', () => {
        const mod = createMockModule();
        const world = new World();
        world.connectCpp(mod.getRegistry(), mod);
        const near = world.spawn(); world.insert(near, Transform, transformAt(1));
        const far = world.spawn(); world.insert(far, Transform, transformAt(9));

        const query = new QueryInstance(world, Query(Mut(Transform)), -1);
        const rows = [...query];
        rows.sort((a, b) => a[1].position.x - b[1].position.x);
        rows[0][1].position.y = 42;               // after the loop: the row has been written back already
        expect(world.get(near, Transform).position.y).toBe(0);

        query.settleKeptRows();                    // what the runner does when the system returns
        expect(world.get(near, Transform).position.y).toBe(42);
        expect(world.get(far, Transform).position.y).toBe(0);
    });
});
