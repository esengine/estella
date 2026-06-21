/**
 * @file  Physics reconciler change-detection. The unified reconciler rebuilds
 *        shapes / joints from these signals, so they're the load-bearing logic:
 *        colliderSignature (which colliders are present → bitmask) and
 *        jointChangedOrGone (a tracked joint's component removed or edited).
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/world';
import { createMockModule } from './mocks/wasm';
import {
    BoxCollider, CircleCollider, CapsuleCollider, RevoluteJoint,
} from '../src/physics/PhysicsComponents';
import { colliderSignature, jointChangedOrGone } from '../src/physics/PhysicsSystem';

function testWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

describe('colliderSignature', () => {
    it('is 0 when the entity has no collider', () => {
        const world = testWorld();
        const e = world.spawn();
        expect(colliderSignature(world, e)).toBe(0);
    });

    it('sets one bit per present collider type (Box=bit0, Circle=bit1)', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, BoxCollider, {} as never);
        expect(colliderSignature(world, e)).toBe(0b1);
        world.insert(e, CircleCollider, {} as never);
        expect(colliderSignature(world, e)).toBe(0b11);
    });

    it('changes when the collider set changes (drives shape rebuild)', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, BoxCollider, {} as never);
        const before = colliderSignature(world, e);
        world.insert(e, CapsuleCollider, {} as never); // bit 2
        expect(colliderSignature(world, e)).not.toBe(before);
        expect(colliderSignature(world, e)).toBe(0b101);
    });
});

describe('jointChangedOrGone', () => {
    it('is true when the entity no longer has any joint component (gone)', () => {
        const world = testWorld();
        const e = world.spawn(); // no joint
        expect(jointChangedOrGone(world, e, 0)).toBe(true);
    });

    it('is false for a present joint not changed since the given tick', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, RevoluteJoint, {} as never);
        // isChangedSince(currentTick) is false (it was last touched this tick),
        // so a present, unedited joint is left intact.
        expect(jointChangedOrGone(world, e, world.getWorldTick())).toBe(false);
    });
});
