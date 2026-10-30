// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/mat4.ts
 * @brief   `Vec4` and `Mat4`, with Cocos's layout.
 *
 * `Mat4.m00..m03` is the first COLUMN, so the translation is `m12, m13, m14` and a point is transformed as `M * p`. The static
 * forms write to `out` and return it, as the other value types do.
 */
import { Quat, Vec3 } from './math';

export class Vec4 {
    static readonly ZERO = Object.freeze(new Vec4(0, 0, 0, 0)) as Vec4;
    static readonly ONE = Object.freeze(new Vec4(1, 1, 1, 1)) as Vec4;

    constructor(public x = 0, public y = 0, public z = 0, public w = 0) {}

    set(x: number | Vec4, y?: number, z?: number, w?: number): this {
        if (typeof x === 'object') { this.x = x.x; this.y = x.y; this.z = x.z; this.w = x.w; } else { this.x = x; this.y = y ?? 0; this.z = z ?? 0; this.w = w ?? 0; }
        return this;
    }
    clone(): Vec4 { return new Vec4(this.x, this.y, this.z, this.w); }
    add(v: Vec4): this { this.x += v.x; this.y += v.y; this.z += v.z; this.w += v.w; return this; }
    subtract(v: Vec4): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; this.w -= v.w; return this; }
    multiplyScalar(s: number): this { this.x *= s; this.y *= s; this.z *= s; this.w *= s; return this; }
    length(): number { return Math.hypot(this.x, this.y, this.z, this.w); }
    lengthSqr(): number { return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w; }
    normalize(): this { const l = this.length(); if (l > 0) { this.x /= l; this.y /= l; this.z /= l; this.w /= l; } return this; }
    dot(v: Vec4): number { return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w; }
    equals(v: Vec4, epsilon = 1e-6): boolean {
        return Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon && Math.abs(this.z - v.z) <= epsilon && Math.abs(this.w - v.w) <= epsilon;
    }
    toString(): string { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)}, ${this.w.toFixed(2)})`; }

    static copy(out: Vec4, a: Vec4): Vec4 { out.x = a.x; out.y = a.y; out.z = a.z; out.w = a.w; return out; }
    static toArray<T extends number[]>(out: T, v: Vec4, ofs = 0): T { out[ofs] = v.x; out[ofs + 1] = v.y; out[ofs + 2] = v.z; out[ofs + 3] = v.w; return out; }
    static fromArray(out: Vec4, arr: ArrayLike<number>, ofs = 0): Vec4 { out.x = arr[ofs]!; out.y = arr[ofs + 1]!; out.z = arr[ofs + 2]!; out.w = arr[ofs + 3]!; return out; }
    static add(out: Vec4, a: Vec4, b: Vec4): Vec4 { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; out.w = a.w + b.w; return out; }
    static subtract(out: Vec4, a: Vec4, b: Vec4): Vec4 { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; out.w = a.w - b.w; return out; }
    static lerp(out: Vec4, a: Vec4, b: Vec4, t: number): Vec4 {
        out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t; out.w = a.w + (b.w - a.w) * t;
        return out;
    }
    static transformMat4(out: Vec4, a: Vec4, m: Mat4): Vec4 {
        const { x, y, z, w } = a;
        out.x = m.m00 * x + m.m04 * y + m.m08 * z + m.m12 * w;
        out.y = m.m01 * x + m.m05 * y + m.m09 * z + m.m13 * w;
        out.z = m.m02 * x + m.m06 * y + m.m10 * z + m.m14 * w;
        out.w = m.m03 * x + m.m07 * y + m.m11 * z + m.m15 * w;
        return out;
    }
}

type Sixteen = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export class Mat4 {
    static readonly IDENTITY = Object.freeze(new Mat4()) as Mat4;

    constructor(
        public m00 = 1, public m01 = 0, public m02 = 0, public m03 = 0,
        public m04 = 0, public m05 = 1, public m06 = 0, public m07 = 0,
        public m08 = 0, public m09 = 0, public m10 = 1, public m11 = 0,
        public m12 = 0, public m13 = 0, public m14 = 0, public m15 = 1,
    ) {}

    private a_(): Sixteen {
        return [this.m00, this.m01, this.m02, this.m03, this.m04, this.m05, this.m06, this.m07, this.m08, this.m09, this.m10, this.m11, this.m12, this.m13, this.m14, this.m15];
    }
    private load_(a: ArrayLike<number>): this {
        this.m00 = a[0]!; this.m01 = a[1]!; this.m02 = a[2]!; this.m03 = a[3]!;
        this.m04 = a[4]!; this.m05 = a[5]!; this.m06 = a[6]!; this.m07 = a[7]!;
        this.m08 = a[8]!; this.m09 = a[9]!; this.m10 = a[10]!; this.m11 = a[11]!;
        this.m12 = a[12]!; this.m13 = a[13]!; this.m14 = a[14]!; this.m15 = a[15]!;
        return this;
    }

    set(other: Mat4): this { return this.load_(other.a_()); }
    clone(): Mat4 { return new Mat4().load_(this.a_()); }
    identity(): this { return this.load_([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
    equals(o: Mat4, epsilon = 1e-6): boolean { const a = this.a_(), b = o.a_(); return a.every((v, i) => Math.abs(v - b[i]!) <= epsilon); }
    toArray(out: number[] = []): number[] { const a = this.a_(); for (let i = 0; i < 16; i++) out[i] = a[i]!; return out; }

    determinant(): number {
        const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = this.a_();
        const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
        return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    }

    invert(): this { Mat4.invert(this, this); return this; }
    transpose(): this { Mat4.transpose(this, this); return this; }
    multiply(other: Mat4): this { Mat4.multiply(this, this, other); return this; }

    getTranslation(out: Vec3 = new Vec3()): Vec3 { out.x = this.m12; out.y = this.m13; out.z = this.m14; return out; }
    getScale(out: Vec3 = new Vec3()): Vec3 {
        out.x = Math.hypot(this.m00, this.m01, this.m02);
        out.y = Math.hypot(this.m04, this.m05, this.m06);
        out.z = Math.hypot(this.m08, this.m09, this.m10);
        return out;
    }
    getRotation(out: Quat = new Quat()): Quat {
        const s = this.getScale();
        const r00 = this.m00 / s.x, r01 = this.m01 / s.x, r02 = this.m02 / s.x;
        const r10 = this.m04 / s.y, r11 = this.m05 / s.y, r12 = this.m06 / s.y;
        const r20 = this.m08 / s.z, r21 = this.m09 / s.z, r22 = this.m10 / s.z;
        const trace = r00 + r11 + r22;
        if (trace > 0) {
            const k = Math.sqrt(trace + 1) * 2;
            out.w = 0.25 * k; out.x = (r12 - r21) / k; out.y = (r20 - r02) / k; out.z = (r01 - r10) / k;
        } else if (r00 > r11 && r00 > r22) {
            const k = Math.sqrt(1 + r00 - r11 - r22) * 2;
            out.w = (r12 - r21) / k; out.x = 0.25 * k; out.y = (r10 + r01) / k; out.z = (r20 + r02) / k;
        } else if (r11 > r22) {
            const k = Math.sqrt(1 + r11 - r00 - r22) * 2;
            out.w = (r20 - r02) / k; out.x = (r10 + r01) / k; out.y = 0.25 * k; out.z = (r21 + r12) / k;
        } else {
            const k = Math.sqrt(1 + r22 - r00 - r11) * 2;
            out.w = (r01 - r10) / k; out.x = (r20 + r02) / k; out.y = (r21 + r12) / k; out.z = 0.25 * k;
        }
        return out;
    }

    static copy(out: Mat4, a: Mat4): Mat4 { return out.load_(a.a_()); }
    static strictEquals(a: Mat4, b: Mat4): boolean { const A = a.a_(), B = b.a_(); return A.every((v, i) => v === B[i]); }
    static toArray<T extends number[]>(out: T, m: Mat4, ofs = 0): T { const a = m.a_(); for (let i = 0; i < 16; i++) out[ofs + i] = a[i]!; return out; }
    static fromArray(out: Mat4, arr: ArrayLike<number>, ofs = 0): Mat4 {
        const a = new Array<number>(16);
        for (let i = 0; i < 16; i++) a[i] = arr[ofs + i]!;
        return out.load_(a);
    }
    static getTranslation(out: Vec3, m: Mat4): Vec3 { return m.getTranslation(out); }
    static getScaling(out: Vec3, m: Mat4): Vec3 { return m.getScale(out); }
    static getRotation(out: Quat, m: Mat4): Quat { return m.getRotation(out); }
    /** Rotation, translation and scale composed (the order Cocos's argument list has them in). */
    static fromRTS(out: Mat4, q: Quat, t: Vec3, s: Vec3): Mat4 { return Mat4.fromTRS(out, t, q, s); }
    /** Take a matrix apart into its rotation, translation and scale. */
    static toRTS(m: Mat4, q: Quat, v: Vec3, s: Vec3): void {
        m.getScale(s);
        m.getTranslation(v);
        m.getRotation(q);
    }
    /** @p a turned by @p rad about Y (applied after @p a's own transform, as gl-matrix does). */
    static rotateY(out: Mat4, a: Mat4, rad: number): Mat4 {
        const s = Math.sin(rad), c = Math.cos(rad);
        return Mat4.multiply(out, a, new Mat4(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1));
    }
    static rotateX(out: Mat4, a: Mat4, rad: number): Mat4 {
        const s = Math.sin(rad), c = Math.cos(rad);
        return Mat4.multiply(out, a, new Mat4(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1));
    }
    static rotateZ(out: Mat4, a: Mat4, rad: number): Mat4 {
        const s = Math.sin(rad), c = Math.cos(rad);
        return Mat4.multiply(out, a, new Mat4(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    }
    /** A perspective projection; @p minClipZ is -1 for GL clip space and 0 for the others. */
    static perspective(out: Mat4, fov: number, aspect: number, near: number, far: number, isFOVY = true, minClipZ = -1, projectionSignY = 1): Mat4 {
        const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
        const x = isFOVY ? f / aspect : f;
        const y = (isFOVY ? f : f * aspect) * projectionSignY;
        return out.load_([x, 0, 0, 0, 0, y, 0, 0, 0, 0, (far - minClipZ * near) * nf, -1, 0, 0, far * near * nf * (1 - minClipZ), 0]);
    }

    static multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
        const A = a.a_(), B = b.a_(), R = new Array<number>(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) sum += A[k * 4 + row]! * B[col * 4 + k]!;
                R[col * 4 + row] = sum;
            }
        }
        return out.load_(R);
    }

    static transpose(out: Mat4, a: Mat4): Mat4 {
        const A = a.a_();
        return out.load_([A[0], A[4], A[8], A[12], A[1], A[5], A[9], A[13], A[2], A[6], A[10], A[14], A[3], A[7], A[11], A[15]] as Sixteen);
    }

    /** The inverse; a singular matrix leaves @p out as it was. */
    static invert(out: Mat4, a: Mat4): Mat4 {
        const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a.a_();
        const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (det === 0) return out;
        det = 1 / det;
        return out.load_([
            (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
            (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
            (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
            (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
        ]);
    }

    /** Translation, rotation and scale composed as `T * R * S`. */
    static fromTRS(out: Mat4, t: Vec3, q: Quat, s: Vec3): Mat4 {
        const { x, y, z, w } = q;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
        return out.load_([
            (1 - (yy + zz)) * s.x, (xy + wz) * s.x, (xz - wy) * s.x, 0,
            (xy - wz) * s.y, (1 - (xx + zz)) * s.y, (yz + wx) * s.y, 0,
            (xz + wy) * s.z, (yz - wx) * s.z, (1 - (xx + yy)) * s.z, 0,
            t.x, t.y, t.z, 1,
        ]);
    }
    static fromTranslation(out: Mat4, t: Vec3): Mat4 { return out.load_([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t.x, t.y, t.z, 1]); }
    static fromScaling(out: Mat4, s: Vec3): Mat4 { return out.load_([s.x, 0, 0, 0, 0, s.y, 0, 0, 0, 0, s.z, 0, 0, 0, 0, 1]); }
    static fromQuat(out: Mat4, q: Quat): Mat4 { return Mat4.fromTRS(out, Vec3.ZERO, q, Vec3.ONE); }
}
