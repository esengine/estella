// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a walker leaves behind: which surface a step lands on, where each foot goes, and how a ring and a print age.
 */
import { describe, expect, it } from 'vitest';
import { StepKind, footAt, stampLook, surfaceAt } from '../src/render/footsteps';

const cover = (kind: StepKind, x: number, y: number, hx: number, hy: number, layer = 0, round = false) =>
    ({ kind, layer, centre: { x, y }, half: { x: hx, y: hy }, margin: 0, round });

describe('the surface a step lands on', () => {
    const pond = cover(StepKind.Water, 0, 0, 100, 100, 0);
    const mud = cover(StepKind.Print, 300, 0, 50, 50, 0);

    it('is the one that covers the point, or none', () => {
        expect(surfaceAt(10, 10, [pond, mud])).toBe(StepKind.Water);
        expect(surfaceAt(310, 0, [pond, mud])).toBe(StepKind.Print);
        expect(surfaceAt(200, 0, [pond, mud])).toBeNull();
    });

    it('is the highest layer where two cover it, and the later one on a tie', () => {
        const dock = cover(StepKind.Print, 0, 0, 20, 20, 5);
        expect(surfaceAt(0, 0, [pond, dock])).toBe(StepKind.Print);
        expect(surfaceAt(60, 0, [pond, dock])).toBe(StepKind.Water);
        expect(surfaceAt(0, 0, [pond, cover(StepKind.Print, 0, 0, 20, 20, 0)])).toBe(StepKind.Print);
    });

    it('takes a round surface as the ellipse inside its rectangle', () => {
        const round = cover(StepKind.Water, 0, 0, 100, 100, 0, true);
        expect(surfaceAt(90, 90, [round])).toBeNull();
        expect(surfaceAt(60, 60, [round])).toBe(StepKind.Water);
    });
});

describe('the feet', () => {
    it('stand either side of the way the walker heads, a width apart', () => {
        const l = footAt(0, 0, 0, 10, true), r = footAt(0, 0, 0, 10, false);
        expect(l.x).toBeCloseTo(0, 6);
        expect(l.y).toBeCloseTo(5, 6);
        expect(r.y).toBeCloseTo(-5, 6);
        // Heading up the screen, the left foot is on the -x side.
        const up = footAt(0, 0, Math.PI / 2, 10, true);
        expect(up.x).toBeCloseTo(-5, 6);
        expect(up.y).toBeCloseTo(0, 6);
    });
});

describe('a step ageing', () => {
    it('spreads and fades a ring, from a third of its size to all of it and from clear to none', () => {
        const born = stampLook(StepKind.Water, 0, 2), done = stampLook(StepKind.Water, 2, 2);
        expect(born.scale).toBeCloseTo(0.33, 6);
        expect(born.alpha).toBe(1);
        expect(done.scale).toBeCloseTo(1, 6);
        expect(done.alpha).toBe(0);
        expect(stampLook(StepKind.Water, 1, 2).scale).toBeGreaterThan(0.6);
    });

    it('keeps a print its size and fades it', () => {
        expect(stampLook(StepKind.Print, 0, 6)).toEqual({ scale: 1, alpha: 1 });
        const half = stampLook(StepKind.Print, 3, 6);
        expect(half.scale).toBe(1);
        expect(half.alpha).toBeCloseTo(0.75, 6);
        expect(stampLook(StepKind.Print, 99, 6).alpha).toBe(0);
    });
});
