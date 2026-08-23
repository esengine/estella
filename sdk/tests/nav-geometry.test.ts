// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which of a scene's colliders a navigation mesh is baked from.
 *
 * The bake reads the world the scene already collides against, so what it must
 * NOT read is as much of the claim as what it must: a crate about to be pushed,
 * a trigger volume, and the agent's own body are all colliders, and none of them
 * is floor.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { createMockModule } from './mocks/wasm';
import { Transform } from '../src/ecs/component';
import {
    RigidBody3D, BoxCollider3D, MeshCollider3D, CharacterController3D,
} from '../src/physics3d/Physics3DComponents';
import { collectNavGeometry, navGeometryReady } from '../src/ai/nav/navGeometry';
import { registerMeshCollision, releaseMeshCollision } from '../src/asset/meshCollision';

function testWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

const BOX = { min: { x: -500, y: -500, z: -500 }, max: { x: 500, y: 500, z: 500 } };

/** A static box collider at `at`, plus whatever else the caller wants on it. */
function addFloor(world: World, at = { x: 0, y: 0, z: 0 }, body = {}, collider = {}): number {
    const e = world.spawn();
    world.insert(e, Transform, { position: at });
    world.insert(e, RigidBody3D, { bodyType: 0, ...body });
    world.insert(e, BoxCollider3D, { halfExtents: { x: 100, y: 10, z: 100 }, ...collider });
    return e;
}

/** The world-space bounds of everything collected. */
function boundsOf(geo: { verts: Float32Array }): { min: number[]; max: number[] } {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geo.verts.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k]!, geo.verts[i + k]!);
            max[k] = Math.max(max[k]!, geo.verts[i + k]!);
        }
    }
    return { min, max };
}

describe('collectNavGeometry', () => {
    it('takes a static collider, at the size and place the scene put it', () => {
        const world = testWorld();
        addFloor(world, { x: 50, y: 20, z: -30 });
        const geo = collectNavGeometry(world, BOX);
        expect(geo.bodyCount).toBe(1);
        expect(geo.indices.length).toBe(36); // twelve triangles
        const { min, max } = boundsOf(geo);
        expect(min).toEqual([-50, 10, -130]);
        expect(max).toEqual([150, 30, 70]);
    });

    // A mesh baked over a crate describes the world for as long as nobody
    // touches it, which is not long enough to plan a route on.
    it('leaves out anything that is going to move', () => {
        const world = testWorld();
        addFloor(world, { x: 0, y: 0, z: 0 }, { bodyType: 2 });
        addFloor(world, { x: 0, y: 0, z: 0 }, { bodyType: 1 });
        expect(collectNavGeometry(world, BOX).bodyCount).toBe(0);
    });

    it('leaves out a body that is switched off, and a trigger nobody bumps into', () => {
        const world = testWorld();
        addFloor(world, { x: 0, y: 0, z: 0 }, { enabled: false });
        addFloor(world, { x: 0, y: 0, z: 0 }, {}, { isSensor: true });
        expect(collectNavGeometry(world, BOX).bodyCount).toBe(0);
    });

    it('leaves out the agent own body', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, RigidBody3D, { bodyType: 0 });
        world.insert(e, CharacterController3D, { radius: 30, halfHeight: 40 });
        expect(collectNavGeometry(world, BOX).bodyCount).toBe(0);
    });

    it('leaves out geometry the volume does not reach', () => {
        const world = testWorld();
        addFloor(world, { x: 5000, y: 0, z: 0 });
        expect(collectNavGeometry(world, BOX).bodyCount).toBe(0);
        expect(collectNavGeometry(world, BOX).verts.length).toBe(0);
    });

    it('takes only the layers it was asked for', () => {
        const world = testWorld();
        addFloor(world, { x: 0, y: 0, z: 0 }, { layer: 3 });
        expect(collectNavGeometry(world, { ...BOX, layers: 1 << 3 }).bodyCount).toBe(1);
        expect(collectNavGeometry(world, { ...BOX, layers: 1 << 2 }).bodyCount).toBe(0);
        expect(collectNavGeometry(world, { ...BOX, layers: 0 }).bodyCount).toBe(1);
    });

    // A mesh collider's shape is its triangles, not the box around them: baking
    // the box would wall off every doorway in an imported level.
    it('takes a mesh collider own triangles', () => {
        const world = testWorld();
        const handle = 4242;
        registerMeshCollision(handle, {
            positions: Float32Array.from([0, 0, 0, 100, 0, 0, 0, 0, 100]),
            indices: Uint32Array.from([0, 1, 2]),
        });
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, RigidBody3D, { bodyType: 0 });
        world.insert(e, MeshCollider3D, { mesh: handle });

        const geo = collectNavGeometry(world, BOX);
        expect(geo.indices.length).toBe(3);
        expect(Array.from(geo.verts)).toEqual([0, 0, 0, 100, 0, 0, 0, 0, 100]);
        releaseMeshCollision(handle);
    });
});

describe('navGeometryReady', () => {
    it('waits for a mesh collider that has not loaded its triangles', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, RigidBody3D, { bodyType: 0 });
        world.insert(e, MeshCollider3D, { mesh: 777 });
        expect(navGeometryReady(world)).toBe(false);

        registerMeshCollision(777, {
            positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
            indices: Uint32Array.from([0, 1, 2]),
        });
        expect(navGeometryReady(world)).toBe(true);
        releaseMeshCollision(777);
    });

    it('is ready at once for a world of primitives', () => {
        const world = testWorld();
        addFloor(world);
        expect(navGeometryReady(world)).toBe(true);
    });
});
