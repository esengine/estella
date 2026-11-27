// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { SystemRunner } from '../src/ecs/system';
import { ResourceStorage, Time } from '../src/ecs/resource';
import { EventRegistry } from '../src/ecs/event';
import { Transform, Velocity, defineComponent } from '../src/ecs/component';
import { velocitySystem } from '../src/velocity';
import { createMockModule } from './mocks/wasm';

describe('VelocitySystem', () => {
    let world: World;
    let resources: ResourceStorage;
    let runner: SystemRunner;

    beforeEach(() => {
        world = new World();
        const mod = createMockModule();
        world.connectCpp(mod.getRegistry(), mod);
        resources = new ResourceStorage();
        resources.insert(Time, { delta: 0.5, elapsed: 0, frameCount: 0 } as never);
        runner = new SystemRunner(world, resources, new EventRegistry());
    });

    it('integrates linear velocity into position', () => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 1, y: 2, z: 0 } });
        world.insert(e, Velocity, { linear: { x: 10, y: -4, z: 0 } });

        runner.run(velocitySystem);

        const t = world.get(e, Transform)!;
        expect(t.position.x).toBeCloseTo(6);
        expect(t.position.y).toBeCloseTo(0);
        expect(t.position.z).toBeCloseTo(0);
    });

    it('integrates z angular velocity as planar rotation', () => {
        const e = world.spawn();
        world.insert(e, Transform, {});
        world.insert(e, Velocity, { angular: { x: 0, y: 0, z: Math.PI } });

        runner.run(velocitySystem);

        // 90° around z: q = (cos45°, 0, 0, sin45°). First-order integration
        // renormalized — allow a small tolerance.
        const q = world.get(e, Transform)!.rotation;
        expect(q.w).toBeCloseTo(Math.SQRT1_2, 1);
        expect(q.z).toBeCloseTo(Math.SQRT1_2, 1);
        expect(q.x).toBeCloseTo(0);
        expect(q.y).toBeCloseTo(0);
    });

    // Resolved by name, as the system does: the physics modules register them.
    const RigidBody2D = defineComponent('RigidBody2D', { bodyType: 2, enabled: true });
    const RigidBody3D = defineComponent('RigidBody3D', { bodyType: 2, enabled: true });
    const moved = (body: typeof RigidBody2D, data: { bodyType: number; enabled?: boolean }): number => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, Velocity, { linear: { x: 100, y: 0, z: 0 } });
        world.insert(e, body, data);
        runner.run(velocitySystem);
        return world.get(e, Transform)!.position.x;
    };

    it('leaves a dynamic body, 2D or 3D, to its solver', () => {
        // The solver writes a dynamic body's pose back each step: a move made here would be undone there.
        expect(moved(RigidBody2D, { bodyType: 2 })).toBe(0);
        expect(moved(RigidBody3D, { bodyType: 2 })).toBe(0);
    });

    it('moves a kinematic or static body, 2D or 3D, whose physics follows its Transform', () => {
        // A platform on Velocity: 2D drives a kinematic body toward its Transform, 3D sets the body to it.
        expect(moved(RigidBody2D, { bodyType: 1 })).toBeCloseTo(50);
        expect(moved(RigidBody3D, { bodyType: 1 })).toBeCloseTo(50);
        expect(moved(RigidBody3D, { bodyType: 0 })).toBeCloseTo(50);
    });

    it('moves a dynamic body that is switched off, which no solver is moving', () => {
        expect(moved(RigidBody3D, { bodyType: 2, enabled: false })).toBeCloseTo(50);
    });

    it('leaves entities without Velocity untouched', () => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 7, y: 8, z: 9 } });

        runner.run(velocitySystem);

        expect(world.get(e, Transform)!.position).toEqual({ x: 7, y: 8, z: 9 });
    });
});
