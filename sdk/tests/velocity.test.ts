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

    it('skips entities owned by the physics solver', () => {
        const RigidBody = defineComponent('RigidBody', { bodyType: 0 });
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, Velocity, { linear: { x: 100, y: 0, z: 0 } });
        world.insert(e, RigidBody, {});

        runner.run(velocitySystem);

        expect(world.get(e, Transform)!.position.x).toBe(0);
    });

    it('leaves entities without Velocity untouched', () => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 7, y: 8, z: 9 } });

        runner.run(velocitySystem);

        expect(world.get(e, Transform)!.position).toEqual({ x: 7, y: 8, z: 9 });
    });
});
