// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { Vec3 } from '../../src/cocos/math';
import { geometry } from '../../src/cocos/geometry';

const { AABB, Ray, Plane, intersect } = geometry;

describe('geometry.AABB', () => {
    it('is a centre and half sizes, from corners or by itself', () => {
        const box = AABB.fromPoints(new Vec3(0, 0, 0), new Vec3(4, 2, 6));
        expect([box.center.x, box.center.y, box.center.z]).toEqual([2, 1, 3]);
        expect([box.halfExtents.x, box.halfExtents.y, box.halfExtents.z]).toEqual([2, 1, 3]);
        expect(new AABB().halfExtents.x).toBe(1);
        const min = new Vec3(), max = new Vec3();
        box.getBoundary(min, max);
        expect([min.x, max.z]).toEqual([0, 6]);
    });

    it('merges into the box that holds both', () => {
        const merged = AABB.merge(new AABB(), new AABB(0, 0, 0, 1, 1, 1), new AABB(10, 0, 0, 1, 1, 1));
        expect(merged.center.x).toBe(5);
        expect(merged.halfExtents.x).toBe(6);
    });
});

describe('geometry.intersect', () => {
    it('tells boxes that overlap (touching counts) from ones that do not', () => {
        expect(intersect.aabbWithAABB(new AABB(0, 0, 0, 1, 1, 1), new AABB(1.5, 0, 0, 1, 1, 1))).toBe(true);
        expect(intersect.aabbWithAABB(new AABB(0, 0, 0, 1, 1, 1), new AABB(2, 0, 0, 1, 1, 1))).toBe(true);
        expect(intersect.aabbWithAABB(new AABB(0, 0, 0, 1, 1, 1), new AABB(2.1, 0, 0, 1, 1, 1))).toBe(false);
    });

    it('answers how far along a ray a plane is, and 0 for a miss', () => {
        const plane = Plane.fromNormalAndPoint(new Plane(), new Vec3(0, 1, 0), new Vec3(0, 5, 0));
        expect(intersect.rayPlane(new Ray(0, 0, 0, 0, 1, 0), plane)).toBe(5);
        expect(intersect.rayPlane(new Ray(0, 0, 0, 1, 0, 0), plane)).toBe(0);     // parallel
        expect(intersect.rayPlane(new Ray(0, 0, 0, 0, -1, 0), plane)).toBe(0);    // behind
    });

    it('answers how far along a ray a box is, from outside and from inside', () => {
        const box = new AABB(0, 0, -10, 1, 1, 1);
        expect(intersect.rayAABB(new Ray(0, 0, 0, 0, 0, -1), box)).toBe(9);
        expect(intersect.rayAABB(new Ray(5, 0, 0, 0, 0, -1), box)).toBe(0);
        expect(intersect.rayAABB(new Ray(0, 0, -10, 0, 0, -1), box)).toBe(1);   // starts inside: where it leaves
    });
});

describe('geometry.Ray', () => {
    it('points from one place to another, and finds a point along itself', () => {
        const ray = Ray.fromPoints(new Ray(), new Vec3(0, 0, 0), new Vec3(0, 0, -4));
        expect([ray.d.x, ray.d.y, ray.d.z]).toEqual([0, 0, -1]);
        const hit = new Vec3();
        ray.computeHit(hit, 3);
        expect(hit.z).toBe(-3);
    });
});
