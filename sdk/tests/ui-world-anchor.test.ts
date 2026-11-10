// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A UI node over a point in the world: where the projection puts it, and what an off-screen marker does.
 */
import { describe, it, expect } from 'vitest';
import { placeOnScreen, type AnchorLens } from '../src/ui/core/world-anchor';

const BOX = { width: 1600, height: 900 };
// An eye at the origin looking down -z, 90 degrees tall: at depth d the screen reaches d up and d * 16/9 across.
const eye = (over: Partial<AnchorLens> = {}): AnchorLens => ({
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, perspective: true, fov: 90, orthoSize: 5, near: 0.1, ...over,
});

describe('placeOnScreen', () => {
    it('puts a point straight ahead at the centre, at its distance', () => {
        const p = placeOnScreen({ x: 0, y: 0, z: -10 }, eye(), BOX, false, 0);
        expect([p.left, p.top]).toEqual([800, 450]);
        expect(p.onScreen).toBe(true);
        expect(p.distance).toBeCloseTo(10);
    });

    it('puts a point where the lens says: half way to the right edge, a quarter of the way up', () => {
        const p = placeOnScreen({ x: (10 * 16) / 9 / 2, y: 2.5, z: -10 }, eye(), BOX, false, 0);
        expect(p.left).toBeCloseTo(1200);
        expect(p.top).toBeCloseTo(337.5);
    });

    it('turns with the eye: a quarter turn left brings a point on the -x axis to the centre', () => {
        const left = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
        const p = placeOnScreen({ x: -10, y: 0, z: 0 }, eye({ rotation: left, position: { x: 0, y: 0, z: 0 } }), BOX, false, 0);
        expect(p.left).toBeCloseTo(800);
        expect(p.onScreen).toBe(true);
    });

    it('says a point behind is behind, and a clamped marker stands on the edge on the side it really is', () => {
        const free = placeOnScreen({ x: 5, y: 0, z: 10 }, eye(), BOX, false, 0);
        expect(free.behind).toBe(true);
        expect(free.onScreen).toBe(false);
        const pinned = placeOnScreen({ x: 5, y: 0, z: 10 }, eye(), BOX, true, 20);
        expect(pinned.left).toBeCloseTo(1580);   // right edge less the margin: the point is to the right
        const ahead = placeOnScreen({ x: 0, y: 0, z: 10 }, eye(), BOX, true, 20);
        expect(ahead.top).toBeCloseTo(880);      // straight behind: the bottom edge, not the centre
    });

    it('pins an off-screen point in front to the edge, keeping its direction', () => {
        const p = placeOnScreen({ x: 100, y: 10, z: -10 }, eye(), BOX, true, 0);
        expect(p.left).toBeCloseTo(1600);
        expect(p.top).toBeGreaterThan(0);
        expect(p.top).toBeLessThan(450);
    });

    it('projects orthographically: half the size up is the top edge', () => {
        const p = placeOnScreen({ x: 0, y: 5, z: -3 }, eye({ perspective: false }), BOX, false, 0);
        expect([p.left, p.top]).toEqual([800, 0]);
    });
});
