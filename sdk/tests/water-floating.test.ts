// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { floatingForce, type FloatingBody, type FloatingData } from '../src/water/floating';
import type { WaterSample } from '../src/water/waterPlugin';

const gravity: [number, number, number] = [0, -9.81, 0];
const floating = (extra: Partial<FloatingData> = {}): FloatingData => ({ buoyancy: 1, drag: 0, radius: 50, points: [], wake: 1, ...extra });
const body = (extra: Partial<FloatingBody> = {}): FloatingBody => ({ position: [0, 0, 0], velocity: [0, 0, 0], angularVelocity: [0, 0, 0], mass: 100, ...extra });
const water = (depth: number, flow: [number, number, number] = [0, 0, 0]): WaterSample => ({
    entity: 1 as never, depth, normal: [0, 1, 0], flow, surface: [0, 0, 0], waterDepth: 1e6, bodyId: "", inside: true,
});
const at: [number, number, number] = [0, 0, 0];

describe('floatingForce', () => {
    it('holds a body up by exactly its weight when it is wholly under water of its own density', () => {
        const f = floatingForce(body(), at, water(-50), floating(), gravity, 100, 1 / 60, 1)!;
        expect(f.force[0]).toBeCloseTo(0, 9);
        expect(f.force[1]).toBeCloseTo(100 * 9.81, 6);
        expect(f.force[2]).toBeCloseTo(0, 9);
    });

    it('gives half the force half under, and more for denser water', () => {
        const half = floatingForce(body(), at, water(-25), floating(), gravity, 100, 1 / 60, 1)!;
        expect(half.force[1]).toBeCloseTo(0.5 * 100 * 9.81, 6);
        const dense = floatingForce(body(), at, water(-50), floating({ buoyancy: 2 }), gravity, 100, 1 / 60, 1)!;
        expect(dense.force[1]).toBeCloseTo(2 * 100 * 9.81, 6);
        // Deeper than the radius is no more wet than at it.
        const deep = floatingForce(body(), at, water(-5000), floating(), gravity, 100, 1 / 60, 1)!;
        expect(deep.force[1]).toBeCloseTo(100 * 9.81, 6);
    });

    it('does nothing in the air, or where there is no water', () => {
        expect(floatingForce(body(), at, water(0), floating(), gravity, 100, 1 / 60, 1)).toBeNull();
        expect(floatingForce(body(), at, water(30), floating(), gravity, 100, 1 / 60, 1)).toBeNull();
        expect(floatingForce(body(), at, null, floating(), gravity, 100, 1 / 60, 1)).toBeNull();
        expect(floatingForce(body(), at, water(-50), floating(), [0, 0, 0], 100, 1 / 60, 1)).toBeNull();
    });

    it('shares a body\'s weight among its points', () => {
        const f = floatingForce(body(), at, water(-50), floating(), gravity, 100, 1 / 60, 4)!;
        expect(f.force[1]).toBeCloseTo(100 * 9.81 / 4, 6);
    });

    it('lifts against whatever gravity there is', () => {
        const f = floatingForce(body(), at, water(-50), floating(), [9.81, 0, 0], 100, 1 / 60, 1)!;
        expect(f.force[0]).toBeCloseTo(-100 * 9.81, 6);
        expect(f.force[1]).toBeCloseTo(0, 9);
    });

    it('resists moving through still water, by the drag times the body\'s share', () => {
        const f = floatingForce(body({ velocity: [3, 0, 0] }), at, water(-50), floating({ drag: 2 }), gravity, 100, 1 / 60, 1)!;
        expect(f.force[0]).toBeCloseTo(-100 * 2 * 3, 6);
    });

    it('does not resist moving with the current, and pushes a body that is still along it', () => {
        // The water runs 200 world units a second along +x: two metres a second at 100 units to a metre.
        const along = floatingForce(body({ velocity: [2, 0, 0] }), at, water(-50, [200, 0, 0]), floating({ drag: 2 }), gravity, 100, 1 / 60, 1)!;
        expect(along.force[0]).toBeCloseTo(0, 6);
        const still = floatingForce(body(), at, water(-50, [200, 0, 0]), floating({ drag: 2 }), gravity, 100, 1 / 60, 1)!;
        expect(still.force[0]).toBeCloseTo(100 * 2 * 2, 6);
    });

    it('feels a turning body\'s own speed at the point, as well as its middle\'s', () => {
        // Spinning about +y at 1 rad/s, a point 2 m out along +x is moving at 2 m/s along -z.
        const f = floatingForce(body({ angularVelocity: [0, 1, 0] }), [2, 0, 0], water(-50), floating({ drag: 1 }), gravity, 100, 1 / 60, 1)!;
        expect(f.force[2]).toBeCloseTo(100 * 1 * 2, 6);
        expect(f.force[0]).toBeCloseTo(0, 6);
    });

    it('caps a drag that would reverse the velocity in one step', () => {
        const f = floatingForce(body({ velocity: [1, 0, 0] }), at, water(-50), floating({ drag: 1000 }), gravity, 100, 1 / 60, 1)!;
        // The most the step may take is nine tenths of the velocity, as a force: mass * (0.9 / dt) * v.
        expect(f.force[0]).toBeCloseTo(-100 * (0.9 * 60) * 1, 6);
    });
});
