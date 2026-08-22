// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { advanceAlongPath } from '../src/ai/nav/follow';

// Every case below is the FLAT one, written in three axes with a constant third:
// what a 2D game does is what this function did before it learnt about depth.
describe('advanceAlongPath', () => {
    it('moves part-way toward a single waypoint', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const idx = advanceAlongPath(pos, [{ x: 10, y: 0, z: 0 }], 0, 4);
        expect(pos).toEqual({ x: 4, y: 0, z: 0 });
        expect(idx).toBe(0); // not yet reached
    });

    it('snaps onto a waypoint reached exactly', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const idx = advanceAlongPath(pos, [{ x: 10, y: 0, z: 0 }], 0, 10);
        expect(pos).toEqual({ x: 10, y: 0, z: 0 });
        expect(idx).toBe(1);
    });

    it('crosses multiple waypoints in one step', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const waypoints = [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }];
        const idx = advanceAlongPath(pos, waypoints, 0, 25);
        expect(pos).toEqual({ x: 25, y: 0, z: 0 });
        expect(idx).toBe(2); // consumed wp0 and wp1, part-way to wp2
    });

    it('reports end reached when budget exceeds the whole chain', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const waypoints = [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }];
        const idx = advanceAlongPath(pos, waypoints, 0, 1000);
        expect(pos).toEqual({ x: 20, y: 0, z: 0 });
        expect(idx).toBe(2); // == waypoints.length → done
    });

    it('follows a diagonal correctly', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const idx = advanceAlongPath(pos, [{ x: 3, y: 4, z: 0 }], 0, 5);
        expect(pos.x).toBeCloseTo(3);
        expect(pos.y).toBeCloseTo(4);
        expect(idx).toBe(1);
    });

    // A slope is longer than its shadow: budgeting on the shadow walks an agent
    // uphill faster than along the flat, and every case above has a constant
    // third axis, so none of them can tell.
    it('spends the budget on the real distance, not on its shadow', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const idx = advanceAlongPath(pos, [{ x: 0, y: 40, z: 30 }], 0, 25);
        expect(pos.y).toBeCloseTo(20); // half of a 50-unit leg, not of a 40 one
        expect(pos.z).toBeCloseTo(15);
        expect(idx).toBe(0);
    });

    it('snaps onto a waypoint on another level, and carries the height', () => {
        const pos = { x: 0, y: 0, z: 0 };
        const idx = advanceAlongPath(pos, [{ x: 0, y: 40, z: 30 }], 0, 50);
        expect(pos).toEqual({ x: 0, y: 40, z: 30 });
        expect(idx).toBe(1);
    });

    it('skips a waypoint already at pos without looping', () => {
        const pos = { x: 5, y: 5, z: 0 };
        const idx = advanceAlongPath(pos, [{ x: 5, y: 5, z: 0 }, { x: 15, y: 5, z: 0 }], 0, 4);
        expect(pos).toEqual({ x: 9, y: 5, z: 0 });
        expect(idx).toBe(1);
    });
});
