// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    physics3d-body-control.test.ts
 * @brief   What a script hands Physics3D to push a body reaches the solver in its units, and a blast falls off.
 *
 *          Held here: world units become metres on the way in and back on the way out (a length once, an impulse once,
 *          a torque twice), a push with no point goes to the centre of mass, a blast strikes what it reaches less the
 *          further it is and every breakable in it as hard, and a world without the newer calls says so rather than
 *          throwing. What the solver does with a push is the real-solver smoke's (physics3d-smoke.mjs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Entity } from '../src/types';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import { Physics3DQueries } from '../src/physics3d/Physics3DQueries';
import { reportContact } from '../src/breakable/breakable';

// What a blast tells whatever breaks: caught here rather than through a world of breakables.
vi.mock('../src/breakable/breakable', async (original) => ({ ...(await original<object>()), reportContact: vi.fn() }));

interface Call { name: string; args: number[] }

/** Bodies 1 and 2 move (2 kg); body 3 stands still. Body states are (x, y, z) metres in a table. */
function fakeWorld(at: Record<number, [number, number, number]>, overlaps: number[] = []) {
    const calls: Call[] = [];
    const heap = new Float32Array(256);
    const moving = new Set([1, 2]);
    const record = (name: string) => (...args: number[]): void => { calls.push({ name, args }); };
    const module = {
        HEAPF32: heap,
        _physics3d_queryResult: () => 0,
        _physics3d_addForce: record('addForce'),
        _physics3d_addTorque: record('addTorque'),
        _physics3d_addImpulse: record('addImpulse'),
        _physics3d_addAngularImpulse: record('addAngularImpulse'),
        _physics3d_setAngularVelocity: record('setAngularVelocity'),
        _physics3d_setGravity: record('setGravity'),
        _physics3d_setAwake: record('setAwake'),
        _physics3d_isAwake: (id: number) => (moving.has(id) ? 1 : 0),
        _physics3d_getBodyState: (id: number) => {
            const p = at[id];
            if (!p) return 0;
            heap.set([p[0], p[1], p[2], 0, 0, 0, 1, 0.5, -1, 0], 0);
            return 1;
        },
        _physics3d_getBodyDynamics: (id: number) => {
            if (!moving.has(id)) return 0;
            heap.set([2, 0.1, 0.2, 0.3], 0);
            return 1;
        },
        _physics3d_boxCast: (...args: number[]) => { calls.push({ name: 'boxCast', args }); heap.set([30, 0.25, 1, 2, 3, 0, 1, 0], 0); return 1; },
        _physics3d_capsuleCast: (...args: number[]) => { calls.push({ name: 'capsuleCast', args }); return 0; },
        _physics3d_getBodyMassData: (id: number) => {
            if (!moving.has(id)) return 0;
            heap.set([2, 1, 0.5, 0, 0.2, Infinity, 0.3], 0);
            return 1;
        },
        _physics3d_overlapSphere: () => {
            // Read out before anything else uses the buffer, as the real one is.
            // Entities, as the real one names them: body n is entity 10 n here.
            overlaps.forEach((id, i) => heap.set([id * 10, ...(at[id] ?? [0, 0, 0])], i * 4));
            return overlaps.length;
        },
    };
    return { module: module as unknown as Physics3DWasmModule, calls };
}

const bodies = new Map<Entity, number>([[10 as Entity, 1], [20 as Entity, 2], [30 as Entity, 3]]);

describe('pushing a 3D body from a script', () => {
    let world: ReturnType<typeof fakeWorld>;
    let physics: Physics3DQueries;
    const gravity = { gravity: { x: 0, y: -9.81, z: 0 } };
    beforeEach(() => {
        world = fakeWorld({ 1: [1, 0, 0], 2: [0, 0, 3], 3: [0, 0, 0] });
        physics = new Physics3DQueries(world.module, 100, new Map(), bodies, gravity);
    });
    const last = (name: string) => world.calls.filter((c) => c.name === name).at(-1)?.args;

    it('hands the solver an impulse in newton seconds, at a point in metres or at the centre of mass', () => {
        expect(physics.applyImpulse(10 as Entity, { x: 200, y: 0, z: -100 })).toBe(true);
        const [id, ix, iy, iz, ...point] = last('addImpulse')!;
        expect([id, ix, iy, iz]).toEqual([1, 2, 0, -1]);
        expect(point.every(Number.isNaN)).toBe(true);
        physics.applyImpulse(10 as Entity, { x: 0, y: 100, z: 0 }, { x: 150, y: 50, z: 0 });
        expect(last('addImpulse')).toEqual([1, 0, 1, 0, 1.5, 0.5, 0]);
    });

    it('scales a force once and a torque twice, a length being in both', () => {
        physics.applyForce(10 as Entity, { x: 981, y: 0, z: 0 });
        expect(last('addForce')!.slice(0, 4)).toEqual([1, 9.81, 0, 0]);
        physics.applyTorque(10 as Entity, { x: 0, y: 10000, z: 0 });
        expect(last('addTorque')).toEqual([1, 0, 1, 0]);
        physics.applyAngularImpulse(10 as Entity, { x: 20000, y: 0, z: 0 });
        expect(last('addAngularImpulse')).toEqual([1, 2, 0, 0]);
    });

    it('reads velocity back in world units, spin in radians, and mass in kilograms', () => {
        expect(physics.getLinearVelocity(10 as Entity)).toEqual({ x: 50, y: -100, z: 0 });
        const spin = physics.getAngularVelocity(10 as Entity)!;
        expect([spin.x, spin.y, spin.z].map((v) => +v.toFixed(5))).toEqual([0.1, 0.2, 0.3]);
        expect(physics.getMass(10 as Entity)).toBe(2);
        // A body that does not move has neither spin nor mass to tell.
        expect(physics.getMass(30 as Entity)).toBeNull();
        expect(physics.getAngularVelocity(30 as Entity)).toBeNull();
    });

    it('sweeps a turned box and an upright capsule in metres, and reads the hit back in world units', () => {
        const turn = { x: 0, y: 0.3826834, z: 0, w: 0.9238795 };
        const hit = physics.boxCast({ x: 100, y: 500, z: 0 }, { x: 50, y: 25, z: 50 }, { x: 0, y: -1000, z: 0 }, 4, turn);
        expect(last('boxCast')).toEqual([1, 5, 0, 0.5, 0.25, 0.5, turn.x, turn.y, turn.z, turn.w, 0, -10, 0, 4]);
        expect(hit).toMatchObject({ entity: 30, fraction: 0.25, x: 100, y: 200, z: 300, normalY: 1 });
        // Unturned when no turn is given, and none hit is null.
        expect(physics.capsuleCast({ x: 0, y: 0, z: 0 }, 30, 60, { x: 0, y: 0, z: 500 })).toBeNull();
        expect(last('capsuleCast')).toEqual([0, 0, 0, 0.3, 0.6, 0, 0, 0, 1, 0, 0, 5, 0]);
    });

    it('reads mass data back: kilograms, the centre in world units, moments in kg by world units squared', () => {
        const data = physics.getMassData(10 as Entity)!;
        expect(data.mass).toBe(2);
        expect(data.centre).toEqual({ x: 100, y: 50, z: 0 });
        expect(data.inertia.x).toBeCloseTo(2000, 3);
        expect(data.inertia.y).toBe(Infinity);
        expect(physics.getMassData(30 as Entity)).toBeNull();
    });

    it('answers false and null for an entity the world has no body for', () => {
        expect(physics.applyImpulse(99 as Entity, { x: 1, y: 0, z: 0 })).toBe(false);
        expect(physics.applyForce(99 as Entity, { x: 1, y: 0, z: 0 })).toBe(false);
        expect(physics.getLinearVelocity(99 as Entity)).toBeNull();
        expect(physics.isAwake(99 as Entity)).toBe(false);
        expect(world.calls).toEqual([]);
    });

    it('wakes, sleeps, and keeps the gravity it was given in metres a second squared', () => {
        physics.setAwake(10 as Entity, false);
        expect(last('setAwake')).toEqual([1, 0]);
        expect(physics.isAwake(10 as Entity)).toBe(true);
        expect(physics.isAwake(30 as Entity)).toBe(false);
        physics.setGravity({ x: 0, y: -1.62, z: 0 });
        expect(last('setGravity')).toEqual([0, -1.62, 0]);
        expect(physics.getGravity()).toEqual({ x: 0, y: -1.62, z: 0 });
        physics.setGravity({ x: 0, y: -9.81, z: 0 });
    });

    it('says so, rather than throwing, in a world built before these calls', () => {
        const old = { ...world.module } as Record<string, unknown>;
        for (const name of ['_physics3d_addImpulse', '_physics3d_addAngularImpulse', '_physics3d_setAngularVelocity', '_physics3d_setGravity', '_physics3d_setAwake', '_physics3d_isAwake']) delete old[name];
        const before = new Physics3DQueries(old as unknown as Physics3DWasmModule, 100, new Map(), bodies);
        expect(before.applyImpulse(10 as Entity, { x: 1, y: 0, z: 0 })).toBe(false);
        expect(before.setGravity({ x: 0, y: -1, z: 0 })).toBe(false);
        expect(before.isAwake(10 as Entity)).toBe(false);
    });
});

describe('a blast', () => {
    it('strikes each moving body it reaches away from its centre, less the further it is, and none past its edge', () => {
        // Body 1 is 100 units from the blast, body 2 300, body 3 does not move; the blast reaches 400.
        const world = fakeWorld({ 1: [1, 0, 0], 2: [0, 0, 3], 3: [0, 0, 0.5] }, [1, 1, 2, 3]);
        const physics = new Physics3DQueries(world.module, 100, new Map(), bodies);
        const moved = physics.explode({ x: 0, y: 0, z: 0 }, 400, 1000);
        expect(moved).toBe(2);
        const blows = world.calls.filter((c) => c.name === 'addImpulse').map((c) => c.args);
        // Each once, though the overlap named body 1 twice: 1000 at 3/4 of the way in, 1000 at 1/4.
        expect(blows).toHaveLength(2);
        const [near, far] = blows;
        expect(near![0]).toBe(1);
        expect(near![1]).toBeCloseTo(7.5, 4);
        expect(far![0]).toBe(2);
        expect(far![3]).toBeCloseTo(2.5, 4);
        // And everything it caught is told how hard, the body that does not move too: that is how a blast breaks a pot.
        const told = vi.mocked(reportContact).mock.calls.map(([a, b, blow]) => [a, b, +blow.toFixed(3)]);
        expect(told).toEqual([[10, 10, 750], [20, 20, 250], [30, 30, 875]]);
    });

    beforeEach(() => vi.mocked(reportContact).mockClear());

    it('tips its push toward the sky by upward', () => {
        const world = fakeWorld({ 1: [1, 0, 0] }, [1]);
        const physics = new Physics3DQueries(world.module, 100, new Map(), bodies);
        physics.explode({ x: 0, y: 0, z: 0 }, 200, 1000, { upward: 1 });
        const [, ix, iy] = world.calls.find((c) => c.name === 'addImpulse')!.args;
        // Out and up alike, at half the blow: 500 along (1, 1)/sqrt 2, in newton seconds.
        expect(ix).toBeCloseTo(iy!, 5);
        expect(Math.hypot(ix!, iy!)).toBeCloseTo(5, 4);
    });

    it('does nothing with no reach or no strength', () => {
        const world = fakeWorld({ 1: [1, 0, 0] }, [1]);
        const physics = new Physics3DQueries(world.module, 100, new Map(), bodies);
        expect(physics.explode({ x: 0, y: 0, z: 0 }, 0, 1000)).toBe(0);
        expect(physics.explode({ x: 0, y: 0, z: 0 }, 100, -5)).toBe(0);
        expect(world.calls).toEqual([]);
    });
});
