// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/math.ts
 * @brief   The value types a Cocos Creator script reaches for: `Vec2`, `Vec3`, `Quat`, `Color`, `Size`, `Rect`, `math`.
 *
 * These are classes with public mutable fields, as in Cocos, because that is what the scripts are written against: they
 * copy them (`v.clone()`), mutate them in place (`v.x += 1`, `v.add(w)`), and pass an `out` parameter to the static forms.
 * They are not the engine's own `{x, y, z}` plain objects, and nothing here touches the engine: a {@link Node} converts at
 * its boundary.
 */

export class Vec2 {
    static readonly ZERO = Object.freeze(new Vec2(0, 0)) as Vec2;
    static readonly ONE = Object.freeze(new Vec2(1, 1)) as Vec2;
    static readonly UP = Object.freeze(new Vec2(0, 1)) as Vec2;
    static readonly RIGHT = Object.freeze(new Vec2(1, 0)) as Vec2;

    constructor(public x = 0, public y = 0) {}

    set(x: number | Vec2, y?: number): this {
        if (typeof x === 'object') { this.x = x.x; this.y = x.y; } else { this.x = x; this.y = y ?? 0; }
        return this;
    }
    clone(): Vec2 { return new Vec2(this.x, this.y); }
    add(v: Vec2): this { this.x += v.x; this.y += v.y; return this; }
    subtract(v: Vec2): this { this.x -= v.x; this.y -= v.y; return this; }
    multiplyScalar(s: number): this { this.x *= s; this.y *= s; return this; }
    length(): number { return Math.hypot(this.x, this.y); }
    lengthSqr(): number { return this.x * this.x + this.y * this.y; }
    normalize(): this { const l = this.length(); if (l > 0) { this.x /= l; this.y /= l; } return this; }
    dot(v: Vec2): number { return this.x * v.x + this.y * v.y; }
    lerp(to: Vec2, ratio: number): this { this.x += (to.x - this.x) * ratio; this.y += (to.y - this.y) * ratio; return this; }
    multiply(v: Vec2): this { this.x *= v.x; this.y *= v.y; return this; }
    angle(v: Vec2): number { return Vec2.angle(this, v); }
    equals(v: Vec2, epsilon = 1e-6): boolean { return Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon; }
    toString(): string { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }

    static distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
    static add(out: Vec2, a: Vec2, b: Vec2): Vec2 { out.x = a.x + b.x; out.y = a.y + b.y; return out; }
    static subtract(out: Vec2, a: Vec2, b: Vec2): Vec2 { out.x = a.x - b.x; out.y = a.y - b.y; return out; }
    static multiplyScalar(out: Vec2, a: Vec2, s: number): Vec2 { out.x = a.x * s; out.y = a.y * s; return out; }
    static lerp(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 { out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; return out; }
    static set(out: Vec2, x: number, y: number): Vec2 { out.x = x; out.y = y; return out; }
    static copy(out: Vec2, a: Vec2): Vec2 { out.x = a.x; out.y = a.y; return out; }
    static len(a: Vec2): number { return Math.hypot(a.x, a.y); }
    static dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
    static squaredDistance(a: Vec2, b: Vec2): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
    /** The angle between two vectors, in radians; 0 if either has no length. */
    static angle(a: Vec2, b: Vec2): number {
        const m = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
        return m === 0 ? 0 : Math.acos(Math.min(Math.max((a.x * b.x + a.y * b.y) / m, -1), 1));
    }
    static normalize(out: Vec2, a: Vec2): Vec2 { out.x = a.x; out.y = a.y; return out.normalize(); }
}

export class Vec3 {
    static readonly ZERO = Object.freeze(new Vec3(0, 0, 0)) as Vec3;
    static readonly ONE = Object.freeze(new Vec3(1, 1, 1)) as Vec3;
    static readonly UP = Object.freeze(new Vec3(0, 1, 0)) as Vec3;
    static readonly RIGHT = Object.freeze(new Vec3(1, 0, 0)) as Vec3;
    static readonly FORWARD = Object.freeze(new Vec3(0, 0, -1)) as Vec3;

    constructor(public x = 0, public y = 0, public z = 0) {}

    set(x: number | Vec3, y?: number, z?: number): this {
        if (typeof x === 'object') { this.x = x.x; this.y = x.y; this.z = x.z; } else { this.x = x; this.y = y ?? 0; this.z = z ?? 0; }
        return this;
    }
    clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
    /** A vector turned by a unit quaternion. */
    static transformQuat(out: Vec3, a: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
        const ix = q.w * a.x + q.y * a.z - q.z * a.y;
        const iy = q.w * a.y + q.z * a.x - q.x * a.z;
        const iz = q.w * a.z + q.x * a.y - q.y * a.x;
        const iw = -q.x * a.x - q.y * a.y - q.z * a.z;
        out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
        out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
        out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
        return out;
    }
    /** A point through a matrix (w = 1), with the perspective divide. */
    static transformMat4(out: Vec3, a: Vec3, m: { m00: number; m01: number; m02: number; m03: number; m04: number; m05: number; m06: number; m07: number; m08: number; m09: number; m10: number; m11: number; m12: number; m13: number; m14: number; m15: number }): Vec3 {
        const x = a.x, y = a.y, z = a.z;
        let w = m.m03 * x + m.m07 * y + m.m11 * z + m.m15;
        w = w ? 1 / w : 1;
        out.x = (m.m00 * x + m.m04 * y + m.m08 * z + m.m12) * w;
        out.y = (m.m01 * x + m.m05 * y + m.m09 * z + m.m13) * w;
        out.z = (m.m02 * x + m.m06 * y + m.m10 * z + m.m14) * w;
        return out;
    }
    add(v: Vec3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    subtract(v: Vec3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
    negative(): this { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    length(): number { return Math.hypot(this.x, this.y, this.z); }
    lengthSqr(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize(): this { const l = this.length(); if (l > 0) { this.x /= l; this.y /= l; this.z /= l; } return this; }
    dot(v: Vec3): number { return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v: Vec3): this {
        const { x, y, z } = this;
        this.x = y * v.z - z * v.y; this.y = z * v.x - x * v.z; this.z = x * v.y - y * v.x;
        return this;
    }
    lerp(to: Vec3, ratio: number): this { this.x += (to.x - this.x) * ratio; this.y += (to.y - this.y) * ratio; this.z += (to.z - this.z) * ratio; return this; }
    multiply(v: Vec3): this { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
    divide(v: Vec3): this { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
    clampf(min: Vec3, max: Vec3): this {
        this.x = Math.min(Math.max(this.x, min.x), max.x); this.y = Math.min(Math.max(this.y, min.y), max.y); this.z = Math.min(Math.max(this.z, min.z), max.z);
        return this;
    }
    /** The angle to @p v, in radians; 0 if either has no length. */
    angle(v: Vec3): number { return Vec3.angle(this, v); }
    strictEquals(v: Vec3): boolean { return this.x === v.x && this.y === v.y && this.z === v.z; }
    equals(v: Vec3, epsilon = 1e-6): boolean {
        return Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon && Math.abs(this.z - v.z) <= epsilon;
    }
    toString(): string { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`; }

    static distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
    static add(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; return out; }
    static subtract(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
    static multiplyScalar(out: Vec3, a: Vec3, s: number): Vec3 { out.x = a.x * s; out.y = a.y * s; out.z = a.z * s; return out; }
    static copy(out: Vec3, a: Vec3): Vec3 { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
    static normalize(out: Vec3, a: Vec3): Vec3 { out.set(a); return out.normalize(); }
    static lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
        out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
        return out;
    }
    static clone(a: Vec3): Vec3 { return new Vec3(a.x, a.y, a.z); }
    static set(out: Vec3, x: number, y: number, z: number): Vec3 { out.x = x; out.y = y; out.z = z; return out; }
    static zero(out: Vec3): Vec3 { out.x = 0; out.y = 0; out.z = 0; return out; }
    static len(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
    static lengthSqr(a: Vec3): number { return a.x * a.x + a.y * a.y + a.z * a.z; }
    static squaredDistance(a: Vec3, b: Vec3): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2; }
    static dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
    static multiply(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = a.x * b.x; out.y = a.y * b.y; out.z = a.z * b.z; return out; }
    static divide(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = a.x / b.x; out.y = a.y / b.y; out.z = a.z / b.z; return out; }
    static negate(out: Vec3, a: Vec3): Vec3 { out.x = -a.x; out.y = -a.y; out.z = -a.z; return out; }
    static inverse(out: Vec3, a: Vec3): Vec3 { out.x = 1 / a.x; out.y = 1 / a.y; out.z = 1 / a.z; return out; }
    static min(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = Math.min(a.x, b.x); out.y = Math.min(a.y, b.y); out.z = Math.min(a.z, b.z); return out; }
    static max(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = Math.max(a.x, b.x); out.y = Math.max(a.y, b.y); out.z = Math.max(a.z, b.z); return out; }
    static clampf(out: Vec3, a: Vec3, min: Vec3, max: Vec3): Vec3 {
        out.x = Math.min(Math.max(a.x, min.x), max.x); out.y = Math.min(Math.max(a.y, min.y), max.y); out.z = Math.min(Math.max(a.z, min.z), max.z);
        return out;
    }
    /** @p a plus @p b scaled by @p scale. */
    static scaleAndAdd(out: Vec3, a: Vec3, b: Vec3, scale: number): Vec3 {
        out.x = a.x + b.x * scale; out.y = a.y + b.y * scale; out.z = a.z + b.z * scale;
        return out;
    }
    static cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
        const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
        out.x = x; out.y = y; out.z = z;
        return out;
    }
    /** The angle between two vectors, in radians; 0 if either has no length. */
    static angle(a: Vec3, b: Vec3): number {
        const m = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
        return m === 0 ? 0 : Math.acos(Math.min(Math.max((a.x * b.x + a.y * b.y + a.z * b.z) / m, -1), 1));
    }
    static equals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
        return Math.abs(a.x - b.x) <= epsilon * Math.max(1, Math.abs(a.x), Math.abs(b.x))
            && Math.abs(a.y - b.y) <= epsilon * Math.max(1, Math.abs(a.y), Math.abs(b.y))
            && Math.abs(a.z - b.z) <= epsilon * Math.max(1, Math.abs(a.z), Math.abs(b.z));
    }
    static strictEquals(a: Vec3, b: Vec3): boolean { return a.x === b.x && a.y === b.y && a.z === b.z; }
    static toArray<T extends number[]>(out: T, v: Vec3, ofs = 0): T { out[ofs] = v.x; out[ofs + 1] = v.y; out[ofs + 2] = v.z; return out; }
    static fromArray(out: Vec3, arr: ArrayLike<number>, ofs = 0): Vec3 { out.x = arr[ofs]!; out.y = arr[ofs + 1]!; out.z = arr[ofs + 2]!; return out; }
}

export class Quat {
    static readonly IDENTITY = Object.freeze(new Quat(0, 0, 0, 1)) as Quat;

    constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}

    set(x: number | Quat, y?: number, z?: number, w?: number): this {
        if (typeof x === 'object') { this.x = x.x; this.y = x.y; this.z = x.z; this.w = x.w; } else {
            this.x = x; this.y = y ?? 0; this.z = z ?? 0; this.w = w ?? 1;
        }
        return this;
    }
    clone(): Quat { return new Quat(this.x, this.y, this.z, this.w); }

    /** The rotation of @p x, @p y, @p z degrees about those axes — Cocos's own formula, so a script's angles mean what they meant there. */
    /** Spherical interpolation from @p a to @p b, written to @p out. */
    static slerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
        let cosom = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        let bx = b.x, by = b.y, bz = b.z, bw = b.w;
        if (cosom < 0) { cosom = -cosom; bx = -bx; by = -by; bz = -bz; bw = -bw; }
        let scale0 = 1 - t, scale1 = t;
        if (1 - cosom > 1e-6) {
            const omega = Math.acos(cosom);
            const sinom = Math.sin(omega);
            scale0 = Math.sin((1 - t) * omega) / sinom;
            scale1 = Math.sin(t * omega) / sinom;
        }
        out.x = scale0 * a.x + scale1 * bx;
        out.y = scale0 * a.y + scale1 * by;
        out.z = scale0 * a.z + scale1 * bz;
        out.w = scale0 * a.w + scale1 * bw;
        return out;
    }

    static fromEuler(out: Quat, x: number, y: number, z: number): Quat {
        const hx = (x * Math.PI) / 360, hy = (y * Math.PI) / 360, hz = (z * Math.PI) / 360;
        const sx = Math.sin(hx), cx = Math.cos(hx), sy = Math.sin(hy), cy = Math.cos(hy), sz = Math.sin(hz), cz = Math.cos(hz);
        out.x = sx * cy * cz + cx * sy * sz;
        out.y = cx * sy * cz + sx * cy * sz;
        out.z = cx * cy * sz - sx * sy * cz;
        out.w = cx * cy * cz - sx * sy * sz;
        return out;
    }

    /** The Euler angles, in degrees, of a rotation: Cocos's `Quat.toEuler`, the inverse of {@link Quat.fromEuler} (x in [-90, 90]). */
    static toEuler(out: Vec3, q: Quat, outerZ = false): Vec3 {
        const { x, y, z, w } = q;
        const deg = (r: number): number => (r * 180) / Math.PI;
        let bank = 0, heading = 0, attitude = 0;
        const test = x * y + z * w;
        if (test > 0.499999) {
            heading = deg(2 * Math.atan2(x, w));
            attitude = 90;
        } else if (test < -0.499999) {
            heading = -deg(2 * Math.atan2(x, w));
            attitude = -90;
        } else {
            const sqx = x * x, sqy = y * y, sqz = z * z;
            bank = deg(Math.atan2(2 * x * w - 2 * y * z, 1 - 2 * sqx - 2 * sqz));
            heading = deg(Math.atan2(2 * y * w - 2 * x * z, 1 - 2 * sqy - 2 * sqz));
            attitude = deg(Math.asin(2 * test));
            if (outerZ) {
                bank = -180 * Math.sign(bank + 1e-6) + bank;
                heading = -180 * Math.sign(heading + 1e-6) + heading;
                attitude = 180 * Math.sign(attitude + 1e-6) - attitude;
            }
        }
        out.x = bank; out.y = heading; out.z = attitude;
        return out;
    }

    static copy(out: Quat, a: Quat): Quat { out.x = a.x; out.y = a.y; out.z = a.z; out.w = a.w; return out; }
    static set(out: Quat, x: number, y: number, z: number, w: number): Quat { out.x = x; out.y = y; out.z = z; out.w = w; return out; }
    static dot(a: Quat, b: Quat): number { return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w; }
    static normalize(out: Quat, a: Quat): Quat {
        const len = a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w;
        if (len > 0) {
            const k = 1 / Math.sqrt(len);
            out.x = a.x * k; out.y = a.y * k; out.z = a.z * k; out.w = a.w * k;
        } else {
            out.x = 0; out.y = 0; out.z = 0; out.w = 0;
        }
        return out;
    }
    /** The inverse of a rotation (its conjugate over its squared length). */
    static invert(out: Quat, a: Quat): Quat {
        const dot = a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w;
        const inv = dot ? 1 / dot : 0;
        out.x = -a.x * inv; out.y = -a.y * inv; out.z = -a.z * inv; out.w = a.w * inv;
        return out;
    }
    static conjugate(out: Quat, a: Quat): Quat { out.x = -a.x; out.y = -a.y; out.z = -a.z; out.w = a.w; return out; }
    static fromAxisAngle(out: Quat, axis: Vec3, rad: number): Quat {
        const half = rad * 0.5, s = Math.sin(half);
        out.x = s * axis.x; out.y = s * axis.y; out.z = s * axis.z; out.w = Math.cos(half);
        return out;
    }
    /** The rotation that turns +Z to @p view with @p up (default +Y) kept upright, as Cocos's `lookAt` builds it. */
    static fromViewUp(out: Quat, view: Vec3, up: Vec3 = Vec3.UP): Quat {
        if (view.x * view.x + view.y * view.y + view.z * view.z < 1e-12) return Quat.set(out, 0, 0, 0, 1);
        const right = Vec3.normalize(new Vec3(), Vec3.cross(new Vec3(), up, view));
        if (right.lengthSqr() < 1e-12) return Quat.set(out, 0, 0, 0, 1);
        const upper = Vec3.cross(new Vec3(), view, right);
        // the columns right / upper / view, as a rotation matrix
        const m00 = right.x, m01 = right.y, m02 = right.z, m03 = upper.x, m04 = upper.y, m05 = upper.z, m06 = view.x, m07 = view.y, m08 = view.z;
        const trace = m00 + m04 + m08;
        if (trace > 0) {
            const k = 0.5 / Math.sqrt(trace + 1);
            out.w = 0.25 / k; out.x = (m05 - m07) * k; out.y = (m06 - m02) * k; out.z = (m01 - m03) * k;
        } else if (m00 > m04 && m00 > m08) {
            const k = 2 * Math.sqrt(1 + m00 - m04 - m08);
            out.w = (m05 - m07) / k; out.x = 0.25 * k; out.y = (m01 + m03) / k; out.z = (m06 + m02) / k;
        } else if (m04 > m08) {
            const k = 2 * Math.sqrt(1 + m04 - m00 - m08);
            out.w = (m06 - m02) / k; out.x = (m01 + m03) / k; out.y = 0.25 * k; out.z = (m05 + m07) / k;
        } else {
            const k = 2 * Math.sqrt(1 + m08 - m00 - m04);
            out.w = (m01 - m03) / k; out.x = (m06 + m02) / k; out.y = (m05 + m07) / k; out.z = 0.25 * k;
        }
        return Quat.normalize(out, out);
    }
    /** The shortest rotation from direction @p a to direction @p b (both unit length). */
    static rotationTo(out: Quat, a: Vec3, b: Vec3): Quat {
        const dot = a.dot(b);
        if (dot < -0.999999) {
            const axis = Vec3.cross(new Vec3(), Vec3.RIGHT, a);
            if (axis.length() < 1e-6) Vec3.cross(axis, Vec3.UP, a);
            axis.normalize();
            return Quat.fromAxisAngle(out, axis, Math.PI);
        }
        if (dot > 0.999999) return Quat.set(out, 0, 0, 0, 1);
        const axis = Vec3.cross(new Vec3(), a, b);
        return Quat.normalize(out, Quat.set(out, axis.x, axis.y, axis.z, 1 + dot));
    }
    static fromArray(out: Quat, arr: ArrayLike<number>, ofs = 0): Quat { out.x = arr[ofs]!; out.y = arr[ofs + 1]!; out.z = arr[ofs + 2]!; out.w = arr[ofs + 3]!; return out; }
    static toArray<T extends number[]>(out: T, q: Quat, ofs = 0): T { out[ofs] = q.x; out[ofs + 1] = q.y; out[ofs + 2] = q.z; out[ofs + 3] = q.w; return out; }
    static equals(a: Quat, b: Quat, epsilon = 1e-6): boolean {
        return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.z - b.z) <= epsilon && Math.abs(a.w - b.w) <= epsilon;
    }

    static multiply(out: Quat, a: Quat, b: Quat): Quat {
        const x = a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y;
        const y = a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z;
        const z = a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x;
        const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
        out.x = x; out.y = y; out.z = z; out.w = w;
        return out;
    }
}

export class Color {
    static readonly WHITE = Object.freeze(new Color(255, 255, 255, 255)) as Color;
    static readonly BLACK = Object.freeze(new Color(0, 0, 0, 255)) as Color;
    static readonly TRANSPARENT = Object.freeze(new Color(0, 0, 0, 0)) as Color;
    static readonly GRAY = Object.freeze(new Color(127, 127, 127, 255)) as Color;
    static readonly RED = Object.freeze(new Color(255, 0, 0, 255)) as Color;
    static readonly GREEN = Object.freeze(new Color(0, 255, 0, 255)) as Color;
    static readonly BLUE = Object.freeze(new Color(0, 0, 255, 255)) as Color;
    static readonly YELLOW = Object.freeze(new Color(255, 235, 4, 255)) as Color;

    constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}

    set(r: number | Color, g?: number, b?: number, a?: number): this {
        if (typeof r === 'object') { this.r = r.r; this.g = r.g; this.b = r.b; this.a = r.a; } else {
            this.r = r; this.g = g ?? 0; this.b = b ?? 0; this.a = a ?? 255;
        }
        return this;
    }
    clone(): Color { return new Color(this.r, this.g, this.b, this.a); }
    equals(c: Color): boolean { return this.r === c.r && this.g === c.g && this.b === c.b && this.a === c.a; }

    /** The channels of @p c as 0..1 floats written to @p out at @p ofs. */
    static toArray<T extends number[]>(out: T, c: Color, ofs = 0): T {
        out[ofs] = c.r / 255; out[ofs + 1] = c.g / 255; out[ofs + 2] = c.b / 255; out[ofs + 3] = c.a / 255;
        return out;
    }
    static lerp(out: Color, from: Color, to: Color, ratio: number): Color {
        out.r = from.r + ratio * (to.r - from.r); out.g = from.g + ratio * (to.g - from.g);
        out.b = from.b + ratio * (to.b - from.b); out.a = from.a + ratio * (to.a - from.a);
        return out;
    }
    static copy(out: Color, a: Color): Color { return out.set(a); }
    static fromHEX(out: Color, hex: string): Color { return out.fromHEX(hex); }

    /** From `#rgb`, `#rrggbb` or `#rrggbbaa`. */
    fromHEX(hex: string): this {
        let h = hex.replace(/^#/, '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        this.r = Number.parseInt(h.slice(0, 2), 16) || 0;
        this.g = Number.parseInt(h.slice(2, 4), 16) || 0;
        this.b = Number.parseInt(h.slice(4, 6), 16) || 0;
        this.a = h.length >= 8 ? Number.parseInt(h.slice(6, 8), 16) || 0 : 255;
        return this;
    }
    toHEX(fmt: '#rrggbb' | '#rrggbbaa' = '#rrggbb'): string {
        const two = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
        return `#${two(this.r)}${two(this.g)}${two(this.b)}${fmt === '#rrggbbaa' ? two(this.a) : ''}`;
    }
}

export class Size {
    constructor(public width = 0, public height = 0) {}
    clone(): Size { return new Size(this.width, this.height); }
    set(w: number | Size, h?: number): this {
        if (typeof w === 'object') { this.width = w.width; this.height = w.height; } else { this.width = w; this.height = h ?? 0; }
        return this;
    }
}

export class Rect {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    clone(): Rect { return new Rect(this.x, this.y, this.width, this.height); }
    contains(p: Vec2): boolean { return p.x >= this.x && p.x <= this.x + this.width && p.y >= this.y && p.y <= this.y + this.height; }
    get xMax(): number { return this.x + this.width; }
    get yMax(): number { return this.y + this.height; }
}

export function v2(x = 0, y = 0): Vec2 { return new Vec2(x, y); }
export function v3(x = 0, y = 0, z = 0): Vec3 { return new Vec3(x, y, z); }
export function color(r = 0, g = 0, b = 0, a = 255): Color { return new Color(r, g, b, a); }
export function size(width = 0, height = 0): Size { return new Size(width, height); }
export function rect(x = 0, y = 0, width = 0, height = 0): Rect { return new Rect(x, y, width, height); }

/** Cocos's `math` namespace: the scalar helpers its scripts import alongside the value types. */
export const math = {
    EPSILON: 1e-6,
    toRadian: (degrees: number): number => (degrees * Math.PI) / 180,
    toDegree: (radians: number): number => (radians * 180) / Math.PI,
    clamp: (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max),
    clamp01: (v: number): number => Math.min(Math.max(v, 0), 1),
    lerp: (from: number, to: number, t: number): number => from + (to - from) * t,
    approx: (a: number, b: number, epsilon = 1e-6): boolean => Math.abs(a - b) <= epsilon,
    random: (): number => Math.random(),
    randomRange: (min: number, max: number): number => min + Math.random() * (max - min),
    randomRangeInt: (min: number, max: number): number => Math.floor(min + Math.random() * (max - min)),
    pingPong: (t: number, length: number): number => { const k = t % (length * 2); return length - Math.abs(k - length); },
};
export const toRadian = math.toRadian;
export const toDegree = math.toDegree;
export const clamp = math.clamp;
export const clamp01 = math.clamp01;
export const lerp = math.lerp;
