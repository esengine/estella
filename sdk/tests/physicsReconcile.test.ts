// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Physics reconciler change-detection. The unified reconciler rebuilds
 *        shapes / joints from these signals, so they're the load-bearing logic:
 *        colliderSignature (which colliders are present → bitmask) and
 *        jointChangedOrGone (a tracked joint's component removed or edited).
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { createMockModule } from './mocks/wasm';
import {
    BoxCollider, CircleCollider, CapsuleCollider, RevoluteJoint,
} from '../src/physics/PhysicsComponents';
import { colliderSignature, jointChangedOrGone, jointPartnerGone } from '../src/physics/PhysicsSystem';

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

describe('jointPartnerGone', () => {
    it('is false while the connected partner is still tracked', () => {
        const world = testWorld();
        const owner = world.spawn();
        const partner = world.spawn();
        world.insert(owner, RevoluteJoint, { connectedEntity: partner } as never);
        expect(jointPartnerGone(world, owner, new Set([owner, partner]))).toBe(false);
    });

    it('is true once the connected partner drops out of the tracked set (despawn)', () => {
        const world = testWorld();
        const owner = world.spawn();
        const partner = world.spawn();
        world.insert(owner, RevoluteJoint, { connectedEntity: partner } as never);
        // Partner despawned → no longer tracked; the joint (auto-destroyed by
        // Box2D) must be re-established, not left silently dead forever.
        expect(jointPartnerGone(world, owner, new Set([owner]))).toBe(true);
    });

    it('is false when there is no joint component (that is jointChangedOrGone\'s job)', () => {
        const world = testWorld();
        const e = world.spawn();
        expect(jointPartnerGone(world, e, new Set([e]))).toBe(false);
    });
});
