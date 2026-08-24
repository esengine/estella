// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One-way platform + motor joint component contracts. The runtime behaviour
 *        (pass-through, drive, drag) is proven end-to-end against the real wasm in
 *        physics-features-smoke.mjs; these guard the TS-side wiring that feeds it —
 *        defaults, registration, and MotorJoint2D's place in the joint reconcile.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { createMockModule } from './mocks/wasm';
import {
    OneWayPlatform2D, MotorJoint2D,
    type OneWayPlatform2DData, type MotorJoint2DData,
} from '../src/physics/PhysicsComponents';
import { jointChangedOrGone } from '../src/physics/PhysicsSystem';

function testWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

describe('OneWayPlatform2D component', () => {
    it('defaults to a solid top (+Y) and enabled', () => {
        const d = OneWayPlatform2D._default as OneWayPlatform2DData;
        expect(d.normal).toEqual({ x: 0, y: 1 });
        expect(d.enabled).toBe(true);
    });
});

describe('MotorJoint2D component', () => {
    it('defaults are inert (no drive) with connectedEntity unset', () => {
        const d = MotorJoint2D._default as MotorJoint2DData;
        expect(d.connectedEntity).toBe(-1);
        expect(d.linearVelocity).toEqual({ x: 0, y: 0 });
        expect(d.maxVelocityForce).toBe(0);
        expect(d.enabled).toBe(true);
    });

    it('participates in the joint reconcile — present + unedited is left intact', () => {
        const world = testWorld();
        const e = world.spawn();
        world.insert(e, MotorJoint2D, {} as never);
        expect(jointChangedOrGone(world, e, world.getWorldTick())).toBe(false);
    });

    it('reports gone when no joint component remains', () => {
        const world = testWorld();
        const e = world.spawn();
        expect(jointChangedOrGone(world, e, 0)).toBe(true);
    });
});
