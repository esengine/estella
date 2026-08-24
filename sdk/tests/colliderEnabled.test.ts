// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A collider's `enabled` flag gates its Box2D shape.
 *
 *        The field is authored in the inspector and documented as "disable the
 *        shape", but the shape attach re-added every collider unconditionally,
 *        so a platform switched off stayed solid — against bodies and against
 *        the character controller's mover alike.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { createMockModule } from './mocks/wasm';
import {
    BoxCollider2D, CircleCollider2D, CapsuleCollider2D,
    SegmentCollider2D, PolygonCollider2D, ChainCollider2D,
} from '../src/physics/PhysicsComponents';
import { addShapeForEntity, collidersChangedSince } from '../src/physics/PhysicsSystem';
import { readCollider2DShapes } from '../src/physics/ColliderShape2D';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';

function testWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

/** A physics module that records which shapes were attached, and nothing else. */
function recordingModule(): { shapes: string[]; module: PhysicsWasmModule } {
    const shapes: string[] = [];
    const heap = new Float32Array(64);
    const module = {
        _malloc: () => 0,
        _free: () => {},
        HEAPF32: heap,
        _physics_addBoxShape: () => shapes.push('box'),
        _physics_addCircleShape: () => shapes.push('circle'),
        _physics_addCapsuleShape: () => shapes.push('capsule'),
        _physics_addSegmentShape: () => shapes.push('segment'),
        _physics_addPolygonShape: () => shapes.push('polygon'),
        _physics_addChainShape: () => shapes.push('chain'),
    };
    return { shapes, module: module as unknown as PhysicsWasmModule };
}

const COLLIDERS = [
    { name: 'box', component: BoxCollider2D },
    { name: 'circle', component: CircleCollider2D },
    { name: 'capsule', component: CapsuleCollider2D },
    { name: 'segment', component: SegmentCollider2D },
    { name: 'polygon', component: PolygonCollider2D },
    { name: 'chain', component: ChainCollider2D },
] as const;

describe('addShapeForEntity honours collider.enabled', () => {
    for (const { name, component } of COLLIDERS) {
        it(`attaches a ${name} shape while it is enabled`, () => {
            const world = testWorld();
            const { shapes, module } = recordingModule();
            const e = world.spawn();
            world.insert(e, component, {} as never);
            addShapeForEntity(world, module, e);
            expect(shapes).toEqual([name]);
        });

        it(`attaches no ${name} shape once it is disabled`, () => {
            const world = testWorld();
            const { shapes, module } = recordingModule();
            const e = world.spawn();
            world.insert(e, component, { enabled: false } as never);
            addShapeForEntity(world, module, e);
            expect(shapes).toEqual([]);
        });
    }

    it('takes away only the disabled collider, not the others on the body', () => {
        const world = testWorld();
        const { shapes, module } = recordingModule();
        const e = world.spawn();
        world.insert(e, BoxCollider2D, { enabled: false } as never);
        world.insert(e, CircleCollider2D, {} as never);
        addShapeForEntity(world, module, e);
        expect(shapes).toEqual(['circle']);
    });

    it('keeps a collider stored before the flag existed solid', () => {
        const world = testWorld();
        const { shapes, module } = recordingModule();
        const e = world.spawn();
        world.insert(e, BoxCollider2D, {} as never);
        const legacy = { ...world.get(e, BoxCollider2D) } as Record<string, unknown>;
        delete legacy.enabled;
        world.set(e, BoxCollider2D, legacy as never);
        addShapeForEntity(world, module, e);
        expect(shapes).toEqual(['box']);
    });
});

describe('the rest of the engine agrees with the shape that is there', () => {
    it('reports the flag to the visualizers, so the debug overlay can skip it', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, BoxCollider2D, { enabled: false } as never);
        world.insert(e, CircleCollider2D, {} as never);
        const [box, circle] = readCollider2DShapes(world, e);
        expect(box.enabled).toBe(false);
        expect(circle.enabled).toBe(true);
    });

    it('marks the collider changed when the flag flips, which is what rebuilds the shapes', () => {
        const world = testWorld();
        world.enableChangeTracking(BoxCollider2D); // registerPhysics2DSystem does this
        const e = world.spawn();
        world.insert(e, BoxCollider2D, {} as never);
        const settled = world.getWorldTick();
        expect(collidersChangedSince(world, e, settled)).toBe(false);

        world.advanceTick(); // next frame: the game turns the platform off
        world.set(e, BoxCollider2D, { ...world.get(e, BoxCollider2D), enabled: false });
        expect(collidersChangedSince(world, e, settled)).toBe(true);
    });
});
