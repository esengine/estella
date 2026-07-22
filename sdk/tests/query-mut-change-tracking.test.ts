// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query-mut-change-tracking.test.ts
 * @brief   A Mut() write-back to a builtin (wasm-backed) component must record a
 *          Changed tick, exactly like a script-component write or an explicit
 *          world.set(). Previously the builtin write-back path (direct ptr /
 *          embind setter) poked component storage without recording a change, so
 *          a Changed()/Added() query missed mutations made through Mut() — but
 *          ONLY for builtin components with cpp connected, which is the normal
 *          runtime. This is the regression guard for that unified behaviour.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/world';
import { Query, QueryInstance, Mut, Changed } from '../src/query';
import { Transform, type TransformData } from '../src/component';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

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

/** A World wired to the JS-backed mock module: builtin Transform is cpp-connected
 *  (hasCpp === true), so its Mut write-back goes through the builtin setter path. */
function connectedWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

/** Spawn one entity with a tracked Transform, then move the change into the past
 *  so a later Changed(sinceTick=0) can only be true if a NEW change is recorded. */
function seedTrackedEntity(world: World): Entity {
    world.enableChangeTracking(Transform);
    const e = world.spawn();
    world.insert(e, Transform, defaultTransform()); // recordChanged at tick 0
    world.advanceTick();                            // worldTick → 1; insert is now "past"
    // Baseline: nothing has changed strictly after tick 0 yet.
    return e;
}

function changedSince(world: World, sinceTick: number): Entity[] {
    const seen: Entity[] = [];
    new QueryInstance(world, Query(Changed(Transform)), sinceTick).forEach((entity) => {
        seen.push(entity);
    });
    return seen;
}

describe('Mut() write-back records change tracking for builtin components', () => {
    it('baseline: the entity is NOT reported changed before any Mut write', () => {
        const world = connectedWorld();
        const e = seedTrackedEntity(world);
        // The insert recorded a change at tick 0; "changed strictly after tick 0" is empty.
        expect(changedSince(world, 0)).not.toContain(e);
    });

    it('forEach Mut write marks the builtin component Changed', () => {
        const world = connectedWorld();
        const e = seedTrackedEntity(world);

        new QueryInstance(world, Query(Mut(Transform)), -1).forEach((_entity, t) => {
            (t as TransformData).position.x = 5;
        });

        expect(changedSince(world, 0)).toContain(e);
    });

    it('for-of (iterator) Mut write marks the builtin component Changed', () => {
        const world = connectedWorld();
        const e = seedTrackedEntity(world);

        for (const [, t] of new QueryInstance(world, Query(Mut(Transform)), -1)) {
            (t as TransformData).position.x = 9;
        }

        expect(changedSince(world, 0)).toContain(e);
    });

    it('a Changed() query in a later frame observes a prior-frame Mut write', () => {
        const world = connectedWorld();
        const e = seedTrackedEntity(world);
        const tickBeforeWrite = world.getWorldTick(); // = 1

        // Frame N: mutate through Mut().
        new QueryInstance(world, Query(Mut(Transform)), -1).forEach((_entity, t) => {
            (t as TransformData).position.y = 3;
        });

        // Frame N+1: a system whose lastRunTick is the pre-write tick must see it.
        world.advanceTick();
        expect(changedSince(world, tickBeforeWrite - 1)).toContain(e);
    });
});
