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
import { describe, it, expect, vi } from 'vitest';
import { makeLosCheck, makeLosCheck3D } from '../src/ai/perception/PerceptionPlugin';
import type { PhysicsAPI, RaycastHit } from '../src/physics';
import type { Physics3DQueries, Cast3DHit } from '../src/physics3d/Physics3DQueries';
import type { Entity, Vec3 } from '../src/types';

const OBSERVER = 11 as Entity;
const TARGET = 22 as Entity;
const WALL = 33 as Entity;

const at = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
const FROM = at(0, 0);
const TO = at(100, 0);

const hit = (entity: Entity, fraction: number): RaycastHit => ({
    entity, fraction, point: { x: 0, y: 0 }, normal: { x: 0, y: 1 },
});

const physicsReturning = (hits: RaycastHit[]): PhysicsAPI =>
    ({ raycast: () => hits }) as unknown as PhysicsAPI;

describe('makeLosCheck', () => {
    it('is not blocked by the target it is looking at', () => {
        const los = makeLosCheck(physicsReturning([hit(TARGET, 0.6)]));
        expect(los(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
    });

    it('is not blocked by the observer it is looking from', () => {
        const los = makeLosCheck(physicsReturning([hit(OBSERVER, 0.02)]));
        expect(los(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
    });

    it('is blocked by anything else in between', () => {
        const los = makeLosCheck(physicsReturning([hit(WALL, 0.5)]));
        expect(los(FROM, TO, OBSERVER, TARGET, 0)).toBe(true);
    });

    it('still sees past a wall that is behind the target', () => {
        const los = makeLosCheck(physicsReturning([hit(WALL, 0.99)]));
        expect(los(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
    });

    it('needs no ray at all when the two are on the same spot', () => {
        const los = makeLosCheck(physicsReturning([hit(WALL, 0)]));
        expect(los(at(50, 50), at(50, 50), OBSERVER, TARGET, 0)).toBe(false);
    });
});

// The 3D solver answers with the NEAREST body rather than every body on the
// line, so the same three cases are decided by that one hit — and the ray has to
// carry all three axes, or a guard on the floor above is looked straight through.
const cast3d = (h: Cast3DHit | null) => {
    const raycast = vi.fn(() => h);
    return { queries: { raycast } as unknown as Physics3DQueries, raycast };
};
const hit3 = (entity: Entity, fraction: number): Cast3DHit => ({
    entity, fraction, x: 0, y: 0, z: 0, normalX: 0, normalY: 1, normalZ: 0,
});

describe('makeLosCheck3D', () => {
    it('is not blocked by the target, the observer, or an empty line', () => {
        expect(makeLosCheck3D(cast3d(hit3(TARGET, 0.6)).queries)(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
        expect(makeLosCheck3D(cast3d(hit3(OBSERVER, 0.02)).queries)(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
        expect(makeLosCheck3D(cast3d(null).queries)(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
    });

    it('is blocked by anything else in between, and not by what is past the target', () => {
        expect(makeLosCheck3D(cast3d(hit3(WALL, 0.5)).queries)(FROM, TO, OBSERVER, TARGET, 0)).toBe(true);
        expect(makeLosCheck3D(cast3d(hit3(WALL, 0.99)).queries)(FROM, TO, OBSERVER, TARGET, 0)).toBe(false);
    });

    it('casts the whole three-dimensional line, and the layers it was given', () => {
        const { queries, raycast } = cast3d(null);
        makeLosCheck3D(queries)(at(1, 2, 3), at(4, 6, 11), OBSERVER, TARGET, 0b1010);
        expect(raycast).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 }, { x: 3, y: 4, z: 8 }, 0b1010);
    });

    it('needs no ray at all when the two are on the same spot', () => {
        const { queries, raycast } = cast3d(hit3(WALL, 0));
        expect(makeLosCheck3D(queries)(at(5, 5, 5), at(5, 5, 5), OBSERVER, TARGET, 0)).toBe(false);
        expect(raycast).not.toHaveBeenCalled();
    });
});
