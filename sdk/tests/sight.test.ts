// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a 2D viewer sees: the walls are the shadow casters, and a line through one is blocked, except for a viewer or a target that stands in it.
 */
import { describe, expect, it } from 'vitest';
import { ringContains, seesPoint, segmentBlocked, sightRingOf, type SightRing } from '../src/render/sight';
import type { ShadowCaster2DData, TransformData } from '../src/ecs/component';

const at = (x: number, y: number, angle = 0, scale = 1): TransformData => ({
    worldPosition: { x, y, z: 0 }, worldScale: { x: scale, y: scale, z: 1 },
    worldRotation: { w: Math.cos(angle / 2), x: 0, y: 0, z: Math.sin(angle / 2) },
}) as TransformData;
const box = (w: number, h: number): ShadowCaster2DData => ({ size: { x: w, y: h }, path: [], enabled: true });

/** A wall 20 wide and 200 tall at x = 100. */
const wall: SightRing = sightRingOf(box(20, 200), at(100, 0))!;

describe('the walls a viewer is blocked by', () => {
    it('takes a box caster as its four corners, placed, scaled and turned by its transform', () => {
        expect(wall).toEqual([{ x: 90, y: -100 }, { x: 110, y: -100 }, { x: 110, y: 100 }, { x: 90, y: 100 }]);
        const turned = sightRingOf(box(20, 200), at(0, 0, Math.PI / 2))!;
        expect(Math.max(...turned.map((p) => Math.abs(p.x)))).toBeCloseTo(100, 6);
        expect(Math.max(...turned.map((p) => Math.abs(p.y)))).toBeCloseTo(10, 6);
        expect(sightRingOf(box(20, 200), at(0, 0, 0, 2))![1]).toEqual({ x: 20, y: -200 });
    });

    it('takes a traced outline over the box, and nothing from a disabled or empty caster', () => {
        const traced: ShadowCaster2DData = { size: { x: 1, y: 1 }, path: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], enabled: true };
        expect(sightRingOf(traced, at(5, 5))).toEqual([{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 5, y: 15 }]);
        expect(sightRingOf({ ...box(20, 200), enabled: false }, at(0, 0))).toBeNull();
        expect(sightRingOf(box(0, 200), at(0, 0))).toBeNull();
    });
});

describe('a line through a wall', () => {
    it('is blocked when it crosses the wall and clear when it goes round or stops short', () => {
        expect(segmentBlocked({ x: 0, y: 0 }, { x: 200, y: 0 }, [wall])).toBe(true);
        expect(segmentBlocked({ x: 0, y: 0 }, { x: 80, y: 0 }, [wall])).toBe(false);
        expect(segmentBlocked({ x: 0, y: 150 }, { x: 200, y: 150 }, [wall])).toBe(false);
        expect(segmentBlocked({ x: 0, y: 0 }, { x: 200, y: 0 }, [])).toBe(false);
    });

    it('is not blocked by a wall the viewer or the target stands in', () => {
        expect(segmentBlocked({ x: 100, y: 0 }, { x: 200, y: 0 }, [wall])).toBe(false);
        expect(segmentBlocked({ x: 0, y: 0 }, { x: 105, y: 40 }, [wall])).toBe(false);
        expect(ringContains(wall, { x: 100, y: 0 })).toBe(true);
        expect(ringContains(wall, { x: 120, y: 0 })).toBe(false);
    });

    it('is not blocked by a wall it only touches at its own end', () => {
        expect(segmentBlocked({ x: 0, y: 0 }, { x: 90, y: 0 }, [wall])).toBe(false);
    });
});

describe('what a viewer sees', () => {
    it('sees what is within its radius and not behind a wall, and with no radius sees as far as the line is clear', () => {
        const eye = { x: 0, y: 0 };
        expect(seesPoint(eye, 50, { x: 40, y: 0 }, [wall])).toBe(true);
        expect(seesPoint(eye, 50, { x: 60, y: 0 }, [wall])).toBe(false);
        expect(seesPoint(eye, 0, { x: 5000, y: 8000 }, [wall])).toBe(true);
        expect(seesPoint(eye, 0, { x: 200, y: 0 }, [wall])).toBe(false);
    });
});
