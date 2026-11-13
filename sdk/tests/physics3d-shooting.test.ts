// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    physics3d-shooting.test.ts
 * @brief   What a shooter asks of the 3D world, as the SDK reads it from the module and acts on it.
 *
 *          Held here: a line's every crossing comes back in world units with how thick each was; a joint that held with more than
 *          its breakForce or breakTorque is taken out, its `enabled` lowered and the break told, and one within them is left; a
 *          character's meetings are read as contacts are, with the impulse they strike with; and a part a ray met is named by
 *          the character above it. What the solver does is the real-solver smoke's (physics3d-smoke.mjs).
 */
import { describe, it, expect } from 'vitest';
import type { Entity } from '../src/types';
import type { App } from '../src/app/app';
import type { Physics3DWasmModule, Physics3DEventsData } from '../src/physics3d/Physics3DModule';
import { drainPhysics3DEvents } from '../src/physics3d/Physics3DModule';
import { Physics3DQueries } from '../src/physics3d/Physics3DQueries';
import { breakJoints3D, DistanceJoint3D, HingeJoint3D, type Joint3DMap } from '../src/physics3d/Physics3DJoints';

function heapModule(extra: Record<string, unknown>) {
    const heap = new Float32Array(1024);
    const calls: { name: string; args: number[] }[] = [];
    return { heap, calls, module: { HEAPF32: heap, _physics3d_queryResult: () => 0, ...extra } as unknown as Physics3DWasmModule };
}

describe('a line through cover', () => {
    it('comes back nearest first in world units, each with how thick it was', () => {
        const { heap, module } = heapModule({});
        let asked: number[] = [];
        Object.assign(module, { _physics3d_raycastAll: (...args: number[]) => {
            asked = args;
            heap.set([7, 0.495, 0.505, 9.9, 1, 0, -1, 0, 0, 8, 0.575, 0.625, 11.5, 1, 0, -1, 0, 0], 0);
            return 2;
        } });
        const physics = new Physics3DQueries(module, 100, new Map(), new Map());
        const hits = physics.raycastAll({ x: 0, y: 100, z: 0 }, { x: 2000, y: 0, z: 0 }, 2, 4);
        expect(asked).toEqual([0, 1, 0, 20, 0, 0, 2, 4]);
        expect(hits.map((h) => h.entity)).toEqual([7, 8]);
        expect(hits[0]!.thickness).toBeCloseTo(20, 2);
        expect(hits[1]!.thickness).toBeCloseTo(100, 2);
        expect(hits[0]!.x).toBeCloseTo(990, 3);
        expect(hits[0]).toMatchObject({ y: 100, normalX: -1 });
    });

    it('is no crossings in a world built before the call', () => {
        const { module } = heapModule({});
        expect(new Physics3DQueries(module, 100).raycastAll({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toEqual([]);
    });
});

/** A world of joint components held in a map, as much of a World as breaking joints touches. */
function jointWorld(rows: [Entity, typeof DistanceJoint3D | typeof HingeJoint3D, Record<string, unknown>][]) {
    const store = new Map<Entity, Map<unknown, Record<string, unknown>>>();
    for (const [e, def, data] of rows) store.set(e, new Map([[def, { ...(def._default as object), ...data }]]));
    const world = {
        valid: (e: Entity) => store.has(e),
        has: (e: Entity, def: unknown) => store.get(e)?.has(def) ?? false,
        get: (e: Entity, def: unknown) => store.get(e)!.get(def)!,
        set: (e: Entity, def: unknown, data: Record<string, unknown>) => { store.get(e)!.set(def, data); },
    };
    return { app: { world } as unknown as App, world };
}

describe('a joint that gives way', () => {
    it('is taken out of the world past its breakForce, with its enabled lowered and the break told', () => {
        const { app, world } = jointWorld([
            [1 as Entity, DistanceJoint3D, { breakForce: 15 }],
            [2 as Entity, DistanceJoint3D, { breakForce: 30 }],
            [3 as Entity, HingeJoint3D, { breakTorque: 5 }],
            [4 as Entity, DistanceJoint3D, {}],
        ]);
        const forces: Record<number, [number, number]> = { 1: [19.6, 0], 2: [19.6, 0], 3: [0, 8], 4: [1e6, 1e6] };
        const removed: number[] = [];
        const asked: number[] = [];
        const { heap, module } = heapModule({
            _physics3d_jointForce: (e: number) => { asked.push(e); heap.set(forces[e]!, 0); return 1; },
            _physics3d_removeJoint: (e: number) => { removed.push(e); },
        });
        const joints: Joint3DMap = new Map([1, 2, 3, 4].map((e) => [e as Entity, {
            bodyA: 10 + e, bodyB: 20 + e, type: e === 3 ? HingeJoint3D._name : DistanceJoint3D._name, motorOn: false, motorSpeed: 0,
        }]));
        const broken: { entity: Entity; force: number; torque: number }[] = [];
        breakJoints3D(app, module, joints, broken);
        expect(removed).toEqual([1, 3]);
        expect(broken.map((b) => [b.entity, +b.force.toFixed(1), b.torque])).toEqual([[1, 19.6, 0], [3, 0, 8]]);
        expect((world.get(1 as Entity, DistanceJoint3D) as { enabled: boolean }).enabled).toBe(false);
        expect((world.get(2 as Entity, DistanceJoint3D) as { enabled: boolean }).enabled).toBe(true);
        expect([...joints.keys()]).toEqual([2, 4]);
        // One with no threshold is never even asked: a world full of joints pays nothing for the few that can break.
        expect(asked).not.toContain(4);
    });

    it('does nothing in a world that cannot say the force', () => {
        const { app } = jointWorld([[1 as Entity, DistanceJoint3D, { breakForce: 1 }]]);
        const { module } = heapModule({});
        const joints: Joint3DMap = new Map([[1 as Entity, { bodyA: 1, bodyB: 2, type: DistanceJoint3D._name, motorOn: false, motorSpeed: 0 }]]);
        breakJoints3D(app, module, joints);
        expect(joints.size).toBe(1);
    });
});

describe('a character that runs into something', () => {
    it('is read as a contact is: in world units, with the impulse it strikes with', () => {
        const { heap, module } = heapModule({
            _physics3d_contactEnters: () => 0, _physics3d_contactEntersBytes: () => 0,
            _physics3d_contactExits: () => 0, _physics3d_contactExitsBytes: () => 0,
            _physics3d_sensorEnters: () => 0, _physics3d_sensorEntersBytes: () => 0,
            _physics3d_sensorExits: () => 0, _physics3d_sensorExitsBytes: () => 0,
            _physics3d_characterHits: () => 400 * 4, _physics3d_characterHitsBytes: () => 40,
        });
        heap.set([5, 9, 1, 0.5, 0, -1, 0, 0, 3, 70], 400);
        const events = { contactEnters: [], contactExits: [], sensorEnters: [], sensorExits: [] } as Physics3DEventsData;
        drainPhysics3DEvents(module, events, 100);
        expect(events.characterHits).toEqual([{ character: 5, other: 9, pointX: 100, pointY: 50, pointZ: 0, normalX: -1, normalY: 0, normalZ: 0, speed: 300, mass: 70, impulse: 21000 }]);
        expect(events.jointBreaks).toEqual([]);
    });
});
