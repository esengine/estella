// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an observer can see — range, cone and occlusion.
 *
 * Three-dimensional, with the flat case as its degenerate: the 2D expectations
 * below are the same function called with equal z, which is what says the flat
 * behaviour was kept rather than re-implemented beside a 3D one.
 */
import { describe, it, expect } from 'vitest';
import { senseTarget, facingFromRotation, normalizeAngle } from '../src/ai/perception/sense';
import { q } from '../src/math/quat';
import type { Vec3 } from '../src/types';

const OMNI = Math.PI; // halfFov ≥ π → omnidirectional
const at = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
const RIGHT = at(1, 0); // an unrotated entity's 'x' facing

describe('senseTarget', () => {
    it('sees a target in range with clear line of sight', () => {
        const r = senseTarget(at(0, 0), RIGHT, at(30, 40), 100, OMNI);
        expect(r.visible).toBe(true);
        expect(r.distance).toBeCloseTo(50);
        expect(r.dir.x).toBeCloseTo(0.6);
        expect(r.dir.y).toBeCloseTo(0.8);
    });

    it('does not see a target out of range', () => {
        const r = senseTarget(at(0, 0), RIGHT, at(200, 0), 100, OMNI);
        expect(r.visible).toBe(false);
        expect(r.distance).toBeCloseTo(200);
    });

    it('respects the field-of-view cone', () => {
        // Facing +X, 45° half-cone. Target straight ahead is seen…
        expect(senseTarget(at(0, 0), RIGHT, at(100, 0), 200, Math.PI / 4).visible).toBe(true);
        // …target directly behind is not.
        expect(senseTarget(at(0, 0), RIGHT, at(-100, 0), 200, Math.PI / 4).visible).toBe(false);
        // …target to the side, just outside the cone.
        expect(senseTarget(at(0, 0), RIGHT, at(0, 100), 200, Math.PI / 4).visible).toBe(false);
    });

    it('honors an occlusion callback', () => {
        const blocked = senseTarget(at(0, 0), RIGHT, at(50, 0), 100, OMNI, () => true);
        expect(blocked.visible).toBe(false);
        const clear = senseTarget(at(0, 0), RIGHT, at(50, 0), 100, OMNI, () => false);
        expect(clear.visible).toBe(true);
    });

    it('treats standing on the target as visible', () => {
        const r = senseTarget(at(10, 10), RIGHT, at(10, 10), 100, Math.PI / 8);
        expect(r.visible).toBe(true);
        expect(r.distance).toBe(0);
    });

    // Depth is a distance like any other. A range that drops z sees a guard two
    // floors up as standing next to you.
    it('measures range through depth', () => {
        expect(senseTarget(at(0, 0, 0), RIGHT, at(0, 0, 200), 100, OMNI).visible).toBe(false);
        expect(senseTarget(at(0, 0, 0), RIGHT, at(0, 0, 50), 100, OMNI).distance).toBeCloseTo(50);
    });

    // …and the cone is a cone, not a wedge extruded through every floor: straight
    // up is outside a forward-facing 45° half-cone however close it is.
    it('closes the cone in every direction, not just in the plane', () => {
        expect(senseTarget(at(0, 0, 0), RIGHT, at(0, 0, -30), 200, Math.PI / 4).visible).toBe(false);
        expect(senseTarget(at(0, 0, 0), RIGHT, at(0, 30, 0), 200, Math.PI / 4).visible).toBe(false);
        // On the axis, at depth, inside the cone: seen, and the direction says so.
        const r = senseTarget(at(0, 0, 0), at(0, 0, -1), at(0, 0, -100), 200, Math.PI / 4);
        expect(r.visible).toBe(true);
        expect(r.dir.z).toBeCloseTo(-1);
    });

    it('sees nothing through a cone with no axis', () => {
        expect(senseTarget(at(0, 0), at(0, 0, 0), at(10, 0), 100, Math.PI / 4).visible).toBe(false);
    });
});

describe('facingFromRotation', () => {
    // Two conventions that both exist in this engine: a flat scene's character
    // faces screen-right, an imported model faces −Z. Neither derives the other.
    it("'x' is an unrotated entity's screen-right, turned by a Z rotation", () => {
        const flat = facingFromRotation({ w: 1, x: 0, y: 0, z: 0 }, 'x');
        expect(flat.x).toBeCloseTo(1);
        expect(flat.y).toBeCloseTo(0);
        const turned = facingFromRotation(q.axis('z', Math.PI / 2), 'x');
        expect(turned.x).toBeCloseTo(0);
        expect(turned.y).toBeCloseTo(1);
    });

    it("'-z' is where a model faces, turned by a Y rotation", () => {
        const ahead = facingFromRotation({ w: 1, x: 0, y: 0, z: 0 }, '-z');
        expect(ahead.z).toBeCloseTo(-1);
        const turned = facingFromRotation(q.axis('y', Math.PI / 2), '-z');
        expect(turned.x).toBeCloseTo(-1);
        expect(Math.abs(turned.z)).toBeLessThan(1e-6);
    });
});

describe('normalizeAngle', () => {
    it('wraps to (-π, π]', () => {
        expect(normalizeAngle(0)).toBeCloseTo(0);
        expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
        expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    });
});
