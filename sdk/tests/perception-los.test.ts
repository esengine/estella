// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What blocks a line of sight, and what only looks like it does.
 *
 * A collider is authored where a body stands, not at its origin — for a 3/4
 * character, at its feet. A ray aimed at the origin therefore passes through
 * the target's own capsule on the way in, and through the observer's on the way
 * out. Counting either as an occluder makes enemies blind to anything they
 * approach from below while leaving them able to see it from the side, which is
 * the shape of a bug nobody would think to look for in a raycast.
 */
import { describe, it, expect } from 'vitest';
import { makeLosCheck } from '../src/ai/perception/PerceptionPlugin';
import type { PhysicsAPI, RaycastHit } from '../src/physics';
import type { Entity } from '../src/types';

const OBSERVER = 11 as Entity;
const TARGET = 22 as Entity;
const WALL = 33 as Entity;

const hit = (entity: Entity, fraction: number): RaycastHit => ({
    entity, fraction, point: { x: 0, y: 0 }, normal: { x: 0, y: 1 },
});

const physicsReturning = (hits: RaycastHit[]): PhysicsAPI =>
    ({ raycast: () => hits }) as unknown as PhysicsAPI;

describe('makeLosCheck', () => {
    it('is not blocked by the target it is looking at', () => {
        const los = makeLosCheck(physicsReturning([hit(TARGET, 0.6)]));
        expect(los(0, 0, 100, 0, OBSERVER, TARGET)).toBe(false);
    });

    it('is not blocked by the observer it is looking from', () => {
        const los = makeLosCheck(physicsReturning([hit(OBSERVER, 0.02)]));
        expect(los(0, 0, 100, 0, OBSERVER, TARGET)).toBe(false);
    });

    it('is blocked by anything else in between', () => {
        const los = makeLosCheck(physicsReturning([hit(WALL, 0.5)]));
        expect(los(0, 0, 100, 0, OBSERVER, TARGET)).toBe(true);
    });

    it('still sees past a wall that is behind the target', () => {
        const los = makeLosCheck(physicsReturning([hit(WALL, 0.99)]));
        expect(los(0, 0, 100, 0, OBSERVER, TARGET)).toBe(false);
    });

    it('needs no ray at all when the two are on the same spot', () => {
        const los = makeLosCheck(physicsReturning([hit(WALL, 0)]));
        expect(los(50, 50, 50, 50, OBSERVER, TARGET)).toBe(false);
    });
});
