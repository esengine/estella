// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { moveAndSlide, type SlideCast, type MoveAndSlideParams } from '../src/physics/CharacterController';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

/**
 * A solid half-space for the move-and-slide tests: surface through `point` with
 * unit normal `n` (pointing toward the moving body). Reports the sweep hit only
 * when the body moves into the surface.
 */
function planeCast(n: { x: number; y: number }, point: { x: number; y: number }): SlideCast {
    const d = n.x * point.x + n.y * point.y;
    return (ox, oy, dx, dy) => {
        const nDotD = n.x * dx + n.y * dy;
        if (nDotD >= 0) return null;
        const f = (d - (n.x * ox + n.y * oy)) / nDotD;
        if (f < 0 || f > 1) return null;
        return { nx: n.x, ny: n.y, fraction: f };
    };
}

const NEVER: SlideCast = () => null;

function params(over: Partial<MoveAndSlideParams>): MoveAndSlideParams {
    return {
        startX: 0, startY: 0, motionX: 0, motionY: 0, velX: 0, velY: 0,
        upX: 0, upY: 1, floorMaxAngle: Math.PI / 4, maxSlides: 4,
        skinWidth: 0, snapLength: 0, slideOnCeiling: true, wasOnFloor: false,
        ...over,
    };
}

describe('moveAndSlide', () => {
    it('moves the full motion on a clear path', () => {
        const r = moveAndSlide(params({ motionX: 7, motionY: -3, velX: 70, velY: -30 }), NEVER);
        close(r.x, 7); close(r.y, -3);
        expect(r.isOnFloor || r.isOnWall || r.isOnCeiling).toBe(false);
        close(r.velX, 70); close(r.velY, -30);
    });

    it('lands on a floor: stops at the surface, zeroes vertical velocity', () => {
        const r = moveAndSlide(
            params({ startY: 5, motionY: -10, velY: -100 }),
            planeCast({ x: 0, y: 1 }, { x: 0, y: 0 }),
        );
        close(r.y, 0);
        expect(r.isOnFloor).toBe(true);
        close(r.velY, 0);
        close(r.floorNormalY, 1);
    });

    it('preserves horizontal motion while landing (slide along floor)', () => {
        const r = moveAndSlide(
            params({ startX: 0, startY: 5, motionX: 5, motionY: -10, velX: 50, velY: -100 }),
            planeCast({ x: 0, y: 1 }, { x: 0, y: 0 }),
        );
        close(r.x, 5); close(r.y, 0);
        expect(r.isOnFloor).toBe(true);
        close(r.velX, 50); close(r.velY, 0);
    });

    it('stops at a wall and zeroes horizontal velocity', () => {
        const r = moveAndSlide(
            params({ motionX: 10, velX: 100 }),
            planeCast({ x: -1, y: 0 }, { x: 10, y: 0 }),
        );
        close(r.x, 10);
        expect(r.isOnWall).toBe(true);
        close(r.velX, 0);
        expect(r.isOnFloor).toBe(false);
    });

    it('classifies an overhang as ceiling', () => {
        const r = moveAndSlide(
            params({ motionY: 10, velY: 100 }),
            planeCast({ x: 0, y: -1 }, { x: 0, y: 10 }),
        );
        close(r.y, 10);
        expect(r.isOnCeiling).toBe(true);
    });

    it('keeps a skin-width gap from the surface', () => {
        const r = moveAndSlide(
            params({ startY: 5, motionY: -10, velY: -100, skinWidth: 1 }),
            planeCast({ x: 0, y: 1 }, { x: 0, y: 0 }),
        );
        close(r.y, 1); // stops 1px short of the floor at y=0
        expect(r.isOnFloor).toBe(true);
    });

    it('treats a slope steeper than floorMaxAngle as a wall', () => {
        // Normal 60° from up → walkable only if floorMaxAngle ≥ 60°; default is 45°.
        const n = { x: Math.sin(Math.PI / 3), y: Math.cos(Math.PI / 3) }; // (0.866, 0.5)
        const r = moveAndSlide(
            params({ startX: 0, startY: 5, motionX: 0, motionY: -10, velY: -100 }),
            planeCast(n, { x: 0, y: 0 }),
        );
        expect(r.isOnWall).toBe(true);
        expect(r.isOnFloor).toBe(false);
    });

    it('walks a shallow slope as floor', () => {
        // Normal 30° from up → walkable under the 45° default.
        const n = { x: Math.sin(Math.PI / 6), y: Math.cos(Math.PI / 6) }; // (0.5, 0.866)
        const r = moveAndSlide(
            params({ startX: 0, startY: 5, motionY: -10, velY: -100 }),
            planeCast(n, { x: 0, y: 0 }),
        );
        expect(r.isOnFloor).toBe(true);
    });

    it('snaps to a floor below when descending (stair/slope stick)', () => {
        // Flat horizontal move that ends in the air; a floor sits 2px below.
        const cast: SlideCast = (ox, oy, dx, dy) => {
            if (dy >= 0) return null; // only the downward snap probe sees the floor
            const f = (0 - oy) / dy; // floor plane at y=0, normal up
            if (f < 0 || f > 1) return null;
            return { nx: 0, ny: 1, fraction: f };
        };
        const r = moveAndSlide(
            params({ startX: 0, startY: 2, motionX: 5, velX: 50, snapLength: 3, wasOnFloor: true }),
            cast,
        );
        close(r.x, 5);
        close(r.y, 0);
        expect(r.isOnFloor).toBe(true);
    });

    it('does not snap while moving up (a jump must leave the floor)', () => {
        const cast: SlideCast = (ox, oy, dx, dy) => {
            if (dy >= 0) return null;
            const f = (0 - oy) / dy;
            if (f < 0 || f > 1) return null;
            return { nx: 0, ny: 1, fraction: f };
        };
        const r = moveAndSlide(
            params({ startX: 0, startY: 2, motionY: 4, velY: 40, snapLength: 3, wasOnFloor: true }),
            cast,
        );
        close(r.y, 6); // moved up, no snap
        expect(r.isOnFloor).toBe(false);
    });

    it('stops the move at a ceiling when slideOnCeiling is false', () => {
        // Up-and-right motion into a ceiling; with sliding off, the leftover is dropped.
        const r = moveAndSlide(
            params({ motionX: 10, motionY: 10, velX: 100, velY: 100, slideOnCeiling: false }),
            planeCast({ x: 0, y: -1 }, { x: 0, y: 5 }),
        );
        expect(r.isOnCeiling).toBe(true);
        close(r.y, 5);
        // leftover horizontal slide is suppressed → x stays at the contact point
        close(r.x, 5);
    });
});
