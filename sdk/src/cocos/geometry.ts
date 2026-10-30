// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/geometry.ts
 * @brief   `cc.geometry`: the boxes, rays and planes scripts test against, and the intersection tests between them.
 *
 * Plain maths on the layer's `Vec3`; nothing here touches the engine. Only the shapes and tests scripts actually reach for are here.
 */
import { Vec3 } from './math';

/** An axis-aligned box: its centre and half the size along each axis. */
export class AABB {
    center: Vec3;
    halfExtents: Vec3;

    constructor(px = 0, py = 0, pz = 0, hw = 1, hh = 1, hl = 1) {
        this.center = new Vec3(px, py, pz);
        this.halfExtents = new Vec3(hw, hh, hl);
    }

    static create(px = 0, py = 0, pz = 0, hw = 1, hh = 1, hl = 1): AABB { return new AABB(px, py, pz, hw, hh, hl); }
    static clone(a: AABB): AABB { return new AABB(a.center.x, a.center.y, a.center.z, a.halfExtents.x, a.halfExtents.y, a.halfExtents.z); }
    static copy(out: AABB, a: AABB): AABB { out.center.set(a.center); out.halfExtents.set(a.halfExtents); return out; }

    /** The box that spans two corners. */
    static fromPoints(minPos: Vec3, maxPos: Vec3, out: AABB = new AABB()): AABB {
        out.center.set((maxPos.x + minPos.x) * 0.5, (maxPos.y + minPos.y) * 0.5, (maxPos.z + minPos.z) * 0.5);
        out.halfExtents.set((maxPos.x - minPos.x) * 0.5, (maxPos.y - minPos.y) * 0.5, (maxPos.z - minPos.z) * 0.5);
        return out;
    }

    /** The box that holds both. */
    static merge(out: AABB, a: AABB, b: AABB): AABB {
        const min = new Vec3(Math.min(a.center.x - a.halfExtents.x, b.center.x - b.halfExtents.x), Math.min(a.center.y - a.halfExtents.y, b.center.y - b.halfExtents.y), Math.min(a.center.z - a.halfExtents.z, b.center.z - b.halfExtents.z));
        const max = new Vec3(Math.max(a.center.x + a.halfExtents.x, b.center.x + b.halfExtents.x), Math.max(a.center.y + a.halfExtents.y, b.center.y + b.halfExtents.y), Math.max(a.center.z + a.halfExtents.z, b.center.z + b.halfExtents.z));
        return AABB.fromPoints(min, max, out);
    }

    set(px: number, py: number, pz: number, hw: number, hh: number, hl: number): void {
        this.center.set(px, py, pz);
        this.halfExtents.set(hw, hh, hl);
    }

    clone(): AABB { return AABB.clone(this); }
    copy(a: AABB): AABB { return AABB.copy(this, a); }
    getBoundary(minPos: Vec3, maxPos: Vec3): void {
        minPos.set(this.center.x - this.halfExtents.x, this.center.y - this.halfExtents.y, this.center.z - this.halfExtents.z);
        maxPos.set(this.center.x + this.halfExtents.x, this.center.y + this.halfExtents.y, this.center.z + this.halfExtents.z);
    }
}

/** A ray from `o` along `d`. */
export class Ray {
    o: Vec3;
    d: Vec3;

    constructor(ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = -1) {
        this.o = new Vec3(ox, oy, oz);
        this.d = new Vec3(dx, dy, dz);
    }

    static create(ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = -1): Ray { return new Ray(ox, oy, oz, dx, dy, dz); }
    static clone(r: Ray): Ray { return new Ray(r.o.x, r.o.y, r.o.z, r.d.x, r.d.y, r.d.z); }
    static copy(out: Ray, r: Ray): Ray { out.o.set(r.o); out.d.set(r.d); return out; }

    /** The ray from one point towards another. */
    static fromPoints(out: Ray, origin: Vec3, target: Vec3): Ray {
        out.o.set(origin);
        out.d.set(target.x - origin.x, target.y - origin.y, target.z - origin.z).normalize();
        return out;
    }

    /** The point `distance` along the ray. */
    computeHit(out: Vec3, distance: number): void {
        out.set(this.o.x + this.d.x * distance, this.o.y + this.d.y * distance, this.o.z + this.d.z * distance);
    }

    clone(): Ray { return Ray.clone(this); }
    copy(r: Ray): Ray { return Ray.copy(this, r); }
}

/** The plane `n · p = d`. */
export class Plane {
    n: Vec3;
    d: number;

    constructor(nx = 0, ny = 1, nz = 0, d = 0) {
        this.n = new Vec3(nx, ny, nz);
        this.d = d;
    }

    static create(nx = 0, ny = 1, nz = 0, d = 0): Plane { return new Plane(nx, ny, nz, d); }
    static clone(p: Plane): Plane { return new Plane(p.n.x, p.n.y, p.n.z, p.d); }
    static copy(out: Plane, p: Plane): Plane { out.n.set(p.n); out.d = p.d; return out; }

    /** The plane through @p point with the given normal. */
    static fromNormalAndPoint(out: Plane, normal: Vec3, point: Vec3): Plane {
        out.n.set(normal);
        out.d = normal.x * point.x + normal.y * point.y + normal.z * point.z;
        return out;
    }

    clone(): Plane { return Plane.clone(this); }
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The intersection tests. A ray test answers the distance along the ray, or 0 when it misses. */
export const intersect = {
    aabbWithAABB(a: AABB, b: AABB): boolean {
        return Math.abs(a.center.x - b.center.x) <= a.halfExtents.x + b.halfExtents.x
            && Math.abs(a.center.y - b.center.y) <= a.halfExtents.y + b.halfExtents.y
            && Math.abs(a.center.z - b.center.z) <= a.halfExtents.z + b.halfExtents.z;
    },

    rayPlane(ray: Ray, plane: Plane): number {
        const denom = dot(ray.d, plane.n);
        if (Math.abs(denom) < 1e-12) return 0;
        const t = (plane.d - dot(ray.o, plane.n)) / denom;
        return t < 0 ? 0 : t;
    },

    rayAABB(ray: Ray, aabb: AABB): number {
        let tmin = -Infinity, tmax = Infinity;
        for (const axis of ['x', 'y', 'z'] as const) {
            const lo = aabb.center[axis] - aabb.halfExtents[axis], hi = aabb.center[axis] + aabb.halfExtents[axis];
            const o = ray.o[axis], d = ray.d[axis];
            if (Math.abs(d) < 1e-12) {
                if (o < lo || o > hi) return 0;
                continue;
            }
            const t1 = (lo - o) / d, t2 = (hi - o) / d;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        }
        if (tmax < Math.max(tmin, 0)) return 0;
        return tmin > 0 ? tmin : tmax > 0 ? tmax : 0;
    },
};

/** `cc.geometry`. */
export const geometry = { AABB, Ray, Plane, intersect };
