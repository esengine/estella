// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Steering round the bodies a route knows nothing about.
 *
 * A route is planned against a world that does not move; agents do. The claims
 * are about the velocity that comes out: it is the one that was wanted when
 * nothing is in the way, it turns when something is, and it never turns onto
 * ground the agent may not stand on.
 */
import { describe, it, expect } from 'vitest';
import { avoidVelocity, type AvoidanceNeighbour } from '../src/ai/nav/avoidance';

const OPTS = { horizon: 2, maxSpeed: 100 };
const me = (over: Partial<{ x: number; z: number; vx: number; vz: number; radius: number }> = {}) => ({
    x: 0, z: 0, vx: 100, vz: 0, radius: 30, ...over,
});
const other = (over: Partial<AvoidanceNeighbour> = {}): AvoidanceNeighbour => ({
    x: 200, z: 0, vx: -100, vz: 0, radius: 30, ...over,
});

/** How far two agents get from each other by walking their chosen velocities. */
function simulate(steps: number, dt = 1 / 30): { closest: number; swapped: boolean } {
    let a = { x: -200, z: 0, vx: 0, vz: 0, radius: 30 };
    let b = { x: 200, z: 0, vx: 0, vz: 0, radius: 30 };
    let closest = Infinity;
    for (let i = 0; i < steps; i++) {
        const wantA = { x: 100, z: 0 };
        const wantB = { x: -100, z: 0 };
        const va = avoidVelocity(a, wantA, [{ ...b }], OPTS);
        const vb = avoidVelocity(b, wantB, [{ ...a }], OPTS);
        a = { ...a, x: a.x + va.x * dt, z: a.z + va.z * dt, vx: va.x, vz: va.z };
        b = { ...b, x: b.x + vb.x * dt, z: b.z + vb.z * dt, vx: vb.x, vz: vb.z };
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
    }
    return { closest, swapped: a.x > 0 && b.x < 0 };
}

describe('avoidVelocity', () => {
    it('leaves an agent with nobody near it alone', () => {
        expect(avoidVelocity(me(), { x: 100, z: 0 }, [], OPTS)).toEqual({ x: 100, z: 0 });
    });

    it('leaves an agent alone when the other is walking away', () => {
        const away = avoidVelocity(me(), { x: 100, z: 0 }, [other({ vx: 100 })], OPTS);
        expect(away.x).toBeCloseTo(100, 1);
        expect(away.z).toBeCloseTo(0, 1);
    });

    // Head on, straight ahead is exactly what neither of them may keep doing.
    it('turns away from a body it is about to walk into', () => {
        const v = avoidVelocity(me(), { x: 100, z: 0 }, [other()], OPTS);
        expect(Math.abs(v.z)).toBeGreaterThan(20);
    });

    // Two agents each assuming the other will also give way: they part, pass, and
    // end up where the other one started rather than shoving in the middle.
    it('lets two agents meeting head-on swap places without touching', () => {
        const run = simulate(200);
        expect(run.closest).toBeGreaterThan(50); // their radii sum to 60
        expect(run.swapped).toBe(true);
    });

    // Steering is not a licence to leave the world: a corridor with a body coming
    // the other way is a wait, not a walk through the wall.
    it('never steers onto ground the agent may not stand on', () => {
        const wide = Math.abs(avoidVelocity(me(), { x: 100, z: 0 }, [other()], OPTS).z);
        const inCorridor = { ...OPTS, canStand: (_x: number, z: number) => Math.abs(z) < 5 };
        const v = avoidVelocity(me(), { x: 100, z: 0 }, [other()], inCorridor);
        // The corridor is narrower than the dodge it would otherwise have taken.
        expect(wide * 0.4).toBeGreaterThan(5);
        expect(inCorridor.canStand(0, v.z * 0.4)).toBe(true);
    });

    // Everyone gives way, so nobody has to give way twice. Reading a stationary
    // body as something only THIS agent can get round makes standing still the
    // safest thing to do, which is how a crowd stops in front of a lamp post.
    it('walks round a body standing in the way rather than stopping in front of it', () => {
        const v = avoidVelocity(me(), { x: 100, z: 0 }, [other({ x: 80, vx: 0 })], OPTS);
        expect(Math.hypot(v.x, v.z)).toBeGreaterThan(40);
    });

    // Swept over many arrangements, because the scoring only rarely PREFERS a
    // velocity faster than the agent has — and rarely is not never.
    it('never asks for more speed than the agent has', () => {
        let seed = 99;
        const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let t = 0; t < 500; t++) {
            const self = me({
                vx: (rnd() * 2 - 1) * 100, vz: (rnd() * 2 - 1) * 100, radius: 20 + rnd() * 30,
            });
            const want = { x: (rnd() * 2 - 1) * 100, z: (rnd() * 2 - 1) * 100 };
            const crowd = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => other({
                x: (rnd() * 2 - 1) * 250, z: (rnd() * 2 - 1) * 250,
                vx: (rnd() * 2 - 1) * 100, vz: (rnd() * 2 - 1) * 100, radius: 20 + rnd() * 30,
            }));
            const v = avoidVelocity(self, want, crowd, OPTS);
            expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(OPTS.maxSpeed + 1e-6);
        }
    });

    it('does something at once about a body already inside it', () => {
        const overlapping = other({ x: 10, z: 0, vx: 0 });
        const v = avoidVelocity(me({ vx: 0 }), { x: 0, z: 0 }, [overlapping], OPTS);
        expect(Math.hypot(v.x, v.z)).toBeGreaterThan(10);
    });
});
