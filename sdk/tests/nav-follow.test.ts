// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { advanceAlongPath } from '../src/ai/nav/follow';

describe('advanceAlongPath', () => {
    it('moves part-way toward a single waypoint', () => {
        const pos = { x: 0, y: 0 };
        const idx = advanceAlongPath(pos, [{ x: 10, y: 0 }], 0, 4);
        expect(pos).toEqual({ x: 4, y: 0 });
        expect(idx).toBe(0); // not yet reached
    });

    it('snaps onto a waypoint reached exactly', () => {
        const pos = { x: 0, y: 0 };
        const idx = advanceAlongPath(pos, [{ x: 10, y: 0 }], 0, 10);
        expect(pos).toEqual({ x: 10, y: 0 });
        expect(idx).toBe(1);
    });

    it('crosses multiple waypoints in one step', () => {
        const pos = { x: 0, y: 0 };
        const waypoints = [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
        const idx = advanceAlongPath(pos, waypoints, 0, 25);
        expect(pos).toEqual({ x: 25, y: 0 });
        expect(idx).toBe(2); // consumed wp0 and wp1, part-way to wp2
    });

    it('reports end reached when budget exceeds the whole chain', () => {
        const pos = { x: 0, y: 0 };
        const waypoints = [{ x: 10, y: 0 }, { x: 20, y: 0 }];
        const idx = advanceAlongPath(pos, waypoints, 0, 1000);
        expect(pos).toEqual({ x: 20, y: 0 });
        expect(idx).toBe(2); // == waypoints.length → done
    });

    it('follows a diagonal correctly', () => {
        const pos = { x: 0, y: 0 };
        const idx = advanceAlongPath(pos, [{ x: 3, y: 4 }], 0, 5);
        expect(pos.x).toBeCloseTo(3);
        expect(pos.y).toBeCloseTo(4);
        expect(idx).toBe(1);
    });

    it('skips a waypoint already at pos without looping', () => {
        const pos = { x: 5, y: 5 };
        const idx = advanceAlongPath(pos, [{ x: 5, y: 5 }, { x: 15, y: 5 }], 0, 4);
        expect(pos).toEqual({ x: 9, y: 5 });
        expect(idx).toBe(1);
    });
});
