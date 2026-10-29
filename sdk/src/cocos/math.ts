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
    equals(v: Vec2, epsilon = 1e-6): boolean { return Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon; }
    toString(): string { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }

    static distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
    static add(out: Vec2, a: Vec2, b: Vec2): Vec2 { out.x = a.x + b.x; out.y = a.y + b.y; return out; }
    static subtract(out: Vec2, a: Vec2, b: Vec2): Vec2 { out.x = a.x - b.x; out.y = a.y - b.y; return out; }
    static multiplyScalar(out: Vec2, a: Vec2, s: number): Vec2 { out.x = a.x * s; out.y = a.y * s; return out; }
    static lerp(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 { out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; return out; }
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
