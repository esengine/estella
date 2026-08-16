// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The 3D world drives Transform, in the units a scene is authored in.
 *
 * check-physics3d proves the solver; this proves the wiring around it, which is
 * where the units live. A scene is authored in world units and the solver works
 * in metres, so a body that arrives unscaled is a character 180 metres tall
 * falling through a floor 0.1m thick — every number still "works", and nothing
 * behaves.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component.generated';
import {
    RigidBody3D, BoxCollider3D, SphereCollider3D, CapsuleCollider3D,
} from '../src/physics3d/Physics3DComponents';
import { stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG } from '../src/physics3d/Physics3DSystem';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { App } from '../src/app/app';
import type { Entity } from '../src/types';

/** A module that records what it was told, and can be made to answer a readback. */
function fakeModule(): Physics3DWasmModule & {
    calls: { name: string; args: number[] }[];
    publish(records: number[]): void;
} {
    const calls: { name: string; args: number[] }[] = [];
    const heap = new Float32Array(1024);
    const record = (name: string) => (...args: number[]): number => {
        calls.push({ name, args });
        return calls.length;  // a non-zero body id
    };
    let published = 0;
    return {
        calls,
        publish(records: number[]) {
            heap.set(records, 0);
            published = records.length * 4;
        },
        HEAPF32: heap,
        HEAPU32: new Uint32Array(heap.buffer),
        _physics3d_init: record('init'),
        _physics3d_shutdown: record('shutdown'),
        _physics3d_isReady: () => 1,
        _physics3d_step: record('step'),
        _physics3d_optimize: record('optimize'),
        _physics3d_addBox: record('addBox'),
        _physics3d_addSphere: record('addSphere'),
        _physics3d_addCapsule: record('addCapsule'),
        _physics3d_removeBody: record('removeBody'),
        _physics3d_setTransform: record('setTransform'),
        _physics3d_setLinearVelocity: record('setLinearVelocity'),
        _physics3d_getBodyState: record('getBodyState'),
        _physics3d_raycast: record('raycast'),
        _physics3d_transforms: () => 0,
        _physics3d_transformsBytes: () => published,
        _physics3d_queryResult: () => 0,
        _physics3d_queryResultBytes: () => 0,
    } as unknown as Physics3DWasmModule & {
        calls: { name: string; args: number[] }[];
        publish(records: number[]): void;
    };
}

/** The slice of a World that stepPhysics3D touches. Real components, plain
 *  storage: what is under test is the sync, and a World needs a C++ registry. */
function fakeWorld() {
    const store = new Map<Entity, Map<unknown, Record<string, unknown>>>();
    let next = 1;
    return {
        spawn(): Entity {
            const e = next++ as Entity;
            store.set(e, new Map());
            return e;
        },
        insert<T>(e: Entity, def: unknown, data?: Partial<T>): T {
            const defaults = (def as { _default?: object })._default ?? {};
            const value = structuredClone({ ...defaults, ...(data ?? {}) });
            store.get(e)!.set(def, value as Record<string, unknown>);
            return value as T;
        },
        remove(e: Entity, def: unknown): void { store.get(e)?.delete(def); },
        get(e: Entity, def: unknown): unknown { return store.get(e)?.get(def); },
        set(e: Entity, def: unknown, value: unknown): void {
            store.get(e)?.set(def, value as Record<string, unknown>);
        },
        has(e: Entity, def: unknown): boolean { return store.get(e)?.has(def) ?? false; },
        valid(e: Entity): boolean { return store.has(e); },
        queryEntities(defs: unknown[]): Entity[] {
            return [...store.entries()]
                .filter(([, comps]) => defs.every((d) => comps.has(d)))
                .map(([e]) => e);
        },
    };
}

describe('the 3D world and the ECS', () => {
    let world: ReturnType<typeof fakeWorld>;
    let app: App;
    let module: ReturnType<typeof fakeModule>;
    let bodies: Map<Entity, number>;

    beforeEach(() => {
        world = fakeWorld();
        app = { world } as unknown as App;
        module = fakeModule();
        bodies = new Map();
    });

    const spawn = (position = { x: 0, y: 0, z: 0 }): Entity => {
        const e = world.spawn();
        world.insert<TransformData>(e, Transform, {
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { ...position },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
            worldScale: { x: 1, y: 1, z: 1 },
        });
        world.insert(e, RigidBody3D);
        return e;
    };

    const called = (name: string) => module.calls.filter((c) => c.name === name);

    it('registers a body for each shape a scene authors', () => {
        const box = spawn();
        world.insert(box, BoxCollider3D);
        const ball = spawn();
        world.insert(ball, SphereCollider3D);
        const character = spawn();
        world.insert(character, CapsuleCollider3D);

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        expect(called('addBox')).toHaveLength(1);
        expect(called('addSphere')).toHaveLength(1);
        expect(called('addCapsule')).toHaveLength(1);
        expect(bodies.size).toBe(3);
    });

    it('registers nothing for a body with no shape', () => {
        spawn();
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        // An extent-less body is a point that falls forever — and, worse, one the
        // readback would then try to write back to a Transform.
        expect(bodies.size).toBe(0);
        expect(called('step')).toHaveLength(1);
    });

    it('sends the solver metres, not world units', () => {
        const e = spawn({ x: 300, y: 150, z: 0 });
        world.insert(e, SphereCollider3D);
        (world.get(e, SphereCollider3D) as { radius: number }).radius = 50;

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        // 100 world units to the metre: a 50-unit ball is half a metre across and
        // stands 1.5m from the origin.
        const [call] = called('addSphere');
        expect(call!.args[1]).toBeCloseTo(0.5, 6);
        expect(call!.args[2]).toBeCloseTo(3, 6);
        expect(call!.args[3]).toBeCloseTo(1.5, 6);
    });

    it('writes the solver’s answer back in world units', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        // (entity, position, rotation) — a body at 2m up and a quarter turn about Y.
        const s = Math.SQRT1_2;
        module.publish([e as number, 0, 2, 0, 0, s, 0, s]);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        const t = world.get(e, Transform) as TransformData;
        expect(t.position.y).toBeCloseTo(200, 4);
        expect(t.rotation.y).toBeCloseTo(s, 6);
        expect(t.rotation.w).toBeCloseTo(s, 6);
    });

    it('gives a body back when its component goes', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        expect(bodies.size).toBe(1);

        world.remove(e, RigidBody3D);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        expect(called('removeBody')).toHaveLength(1);
        expect(bodies.size).toBe(0);
    });

    it('leaves a disabled body out of the world', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        (world.get(e, RigidBody3D) as { enabled: boolean }).enabled = false;

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        expect(bodies.size).toBe(0);
    });
});
