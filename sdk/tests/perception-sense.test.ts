// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { senseTarget, facingFromQuat, normalizeAngle } from '../src/ai/perception/sense';

const OMNI = Math.PI; // halfFov ≥ π → omnidirectional

describe('senseTarget', () => {
    it('sees a target in range with clear line of sight', () => {
        const r = senseTarget(0, 0, 0, 30, 40, 100, OMNI);
        expect(r.visible).toBe(true);
        expect(r.distance).toBeCloseTo(50);
        expect(r.dirX).toBeCloseTo(0.6);
        expect(r.dirY).toBeCloseTo(0.8);
    });

    it('does not see a target out of range', () => {
        const r = senseTarget(0, 0, 0, 200, 0, 100, OMNI);
        expect(r.visible).toBe(false);
        expect(r.distance).toBeCloseTo(200);
    });

    it('respects the field-of-view cone', () => {
        // Facing +X (0 rad), 45° half-cone. Target straight ahead is seen…
        expect(senseTarget(0, 0, 0, 100, 0, 200, Math.PI / 4).visible).toBe(true);
        // …target directly behind is not.
        expect(senseTarget(0, 0, 0, -100, 0, 200, Math.PI / 4).visible).toBe(false);
        // …target to the side, just outside the cone.
        expect(senseTarget(0, 0, 0, 0, 100, 200, Math.PI / 4).visible).toBe(false);
    });

    it('honors an occlusion callback', () => {
        const blocked = senseTarget(0, 0, 0, 50, 0, 100, OMNI, () => true);
        expect(blocked.visible).toBe(false);
        const clear = senseTarget(0, 0, 0, 50, 0, 100, OMNI, () => false);
        expect(clear.visible).toBe(true);
    });

    it('treats standing on the target as visible', () => {
        const r = senseTarget(10, 10, 0, 10, 10, 100, Math.PI / 8);
        expect(r.visible).toBe(true);
        expect(r.distance).toBe(0);
    });
});

describe('facingFromQuat', () => {
    it('reads the 2D angle from a Z rotation quaternion', () => {
        expect(facingFromQuat(0, 1)).toBeCloseTo(0); // identity
        // 90° about Z: z=sin(45°), w=cos(45°)
        expect(facingFromQuat(Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(Math.PI / 2);
    });
});

describe('normalizeAngle', () => {
    it('wraps to (-π, π]', () => {
        expect(normalizeAngle(0)).toBeCloseTo(0);
        expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
        expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    });
});
