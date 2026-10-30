// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The value types a script reaches for, in the forms Cocos has them: what a game's own code calls (`tempVec3.lerp`, `Vec3.scaleAndAdd`,
 *        `Quat.fromViewUp`, `Mat4.fromRTS`, `Color.toArray`) must exist and give the numbers Cocos gives.
 */
import { describe, expect, it } from 'vitest';
import { Color, Mat4, Quat, Vec2, Vec3, Vec4 } from '../../src/cocos';

describe('Vec3', () => {
    it('lerps itself toward another by a ratio', () => {
        const v = new Vec3(0, 10, -4).lerp(new Vec3(10, 20, 4), 0.5);
        expect([v.x, v.y, v.z]).toEqual([5, 15, 0]);
    });

    it('multiplies, divides and clamps in place', () => {
        const v = new Vec3(2, 4, 6).multiply(new Vec3(2, 2, 2)).divide(new Vec3(4, 4, 4)).clampf(new Vec3(0, 0, 0), new Vec3(1, 1, 1));
        expect([v.x, v.y, v.z]).toEqual([1, 1, 1]);
    });

    it('has the static forms a script writes with an out parameter', () => {
        const out = new Vec3();
        expect(Vec3.scaleAndAdd(out, new Vec3(1, 1, 1), new Vec3(0, 2, 0), 3)).toBe(out);
        expect([out.x, out.y, out.z]).toEqual([1, 7, 1]);
        expect(Vec3.cross(new Vec3(), Vec3.RIGHT, Vec3.UP).z).toBe(1);
        expect(Vec3.dot(new Vec3(1, 2, 3), new Vec3(4, 5, 6))).toBe(32);
        expect(Vec3.squaredDistance(new Vec3(), new Vec3(1, 2, 2))).toBe(9);
        expect(Vec3.angle(Vec3.RIGHT, Vec3.UP)).toBeCloseTo(Math.PI / 2, 6);
        expect(Vec3.angle(Vec3.ZERO, Vec3.UP)).toBe(0);
        expect(Vec3.min(new Vec3(), new Vec3(1, 5, 3), new Vec3(2, 4, 3)).y).toBe(4);
        expect(Vec3.max(new Vec3(), new Vec3(1, 5, 3), new Vec3(2, 4, 3)).x).toBe(2);
        expect(Vec3.toArray([], new Vec3(1, 2, 3))).toEqual([1, 2, 3]);
        expect(Vec3.clone(new Vec3(1, 2, 3)).equals(new Vec3(1, 2, 3))).toBe(true);
        expect(Vec3.equals(new Vec3(1, 2, 3), new Vec3(1, 2, 3.0000001))).toBe(true);
    });
});

describe('Vec2', () => {
    it('sets, measures and takes the angle between', () => {
        const v = Vec2.set(new Vec2(), 3, 4);
        expect(Vec2.len(v)).toBe(5);
        expect(Vec2.angle(new Vec2(1, 0), new Vec2(0, 1))).toBeCloseTo(Math.PI / 2, 6);
        expect(new Vec2(0, 0).lerp(new Vec2(10, 20), 0.25).y).toBe(5);
    });
});

describe('Quat', () => {
    it('inverts, conjugates and normalizes as Cocos does', () => {
        const q = Quat.fromEuler(new Quat(), 10, 20, 30);
        const inv = Quat.invert(new Quat(), q);
        const id = Quat.multiply(new Quat(), q, inv);
        expect(id.w).toBeCloseTo(1, 6);
        expect(Math.abs(id.x) + Math.abs(id.y) + Math.abs(id.z)).toBeLessThan(1e-6);
        const c = Quat.conjugate(new Quat(), q);
        expect([c.x, c.w]).toEqual([-q.x, q.w]);
        expect(Quat.dot(q, q)).toBeCloseTo(1, 6);
        expect(Quat.normalize(new Quat(), new Quat(0, 0, 0, 2)).w).toBe(1);
    });

    it('makes a rotation from an axis and an angle', () => {
        const q = Quat.fromAxisAngle(new Quat(), Vec3.UP, Math.PI / 2);
        const v = Vec3.transformQuat(new Vec3(), Vec3.RIGHT, q);
        expect(v.z).toBeCloseTo(-1, 6);
    });

    it('turns +z to the view direction with up kept upright (fromViewUp)', () => {
        const view = new Vec3(1, 0, 0);
        const q = Quat.fromViewUp(new Quat(), view);
        const z = Vec3.transformQuat(new Vec3(), new Vec3(0, 0, 1), q);
        expect(z.x).toBeCloseTo(1, 6);
        const up = Vec3.transformQuat(new Vec3(), Vec3.UP, q);
        expect(up.y).toBeCloseTo(1, 6);
        expect(Quat.fromViewUp(new Quat(), Vec3.ZERO).w).toBe(1);
    });

    it('is the shortest rotation between two directions (rotationTo)', () => {
        const q = Quat.rotationTo(new Quat(), Vec3.RIGHT, Vec3.UP);
        const v = Vec3.transformQuat(new Vec3(), Vec3.RIGHT, q);
        expect(v.y).toBeCloseTo(1, 6);
        const opposite = Quat.rotationTo(new Quat(), Vec3.RIGHT, new Vec3(-1, 0, 0));
        expect(Vec3.transformQuat(new Vec3(), Vec3.RIGHT, opposite).x).toBeCloseTo(-1, 6);
        expect(Quat.rotationTo(new Quat(), Vec3.UP, Vec3.UP).w).toBe(1);
    });

    it('reads from and writes to arrays', () => {
        expect(Quat.toArray([], new Quat(1, 2, 3, 4))).toEqual([1, 2, 3, 4]);
        expect(Quat.fromArray(new Quat(), [0, 0, 0, 0, 5, 6, 7, 8], 4).w).toBe(8);
    });
});

describe('Mat4', () => {
    it('composes rotation, translation and scale (fromRTS) and takes them apart again (toRTS)', () => {
        const q = Quat.fromEuler(new Quat(), 0, 90, 0);
        const m = Mat4.fromRTS(new Mat4(), q, new Vec3(1, 2, 3), new Vec3(2, 2, 2));
        const rq = new Quat(), rv = new Vec3(), rs = new Vec3();
        Mat4.toRTS(m, rq, rv, rs);
        expect([rv.x, rv.y, rv.z]).toEqual([1, 2, 3]);
        expect(rs.x).toBeCloseTo(2, 6);
        expect(Math.abs(Quat.dot(q, rq))).toBeCloseTo(1, 6);
        expect(Mat4.getTranslation(new Vec3(), m).z).toBe(3);
    });

    it('turns about Y after the matrix it is given (rotateY)', () => {
        const m = Mat4.rotateY(new Mat4(), new Mat4(), Math.PI / 2);
        const p = Vec3.transformMat4(new Vec3(), Vec3.RIGHT, m);
        expect(p.z).toBeCloseTo(-1, 6);
    });

    it('is a GL perspective projection', () => {
        const m = Mat4.perspective(new Mat4(), Math.PI / 2, 2, 1, 11);
        expect(m.m00).toBeCloseTo(0.5, 6);
        expect(m.m05).toBeCloseTo(1, 6);
        expect(m.m10).toBeCloseTo(-1.2, 6);
        expect(m.m11).toBe(-1);
        expect(m.m14).toBeCloseTo(-2.2, 6);
    });

    it('copies, compares and moves through arrays', () => {
        const a = Mat4.fromTranslation(new Mat4(), new Vec3(1, 2, 3));
        const b = Mat4.copy(new Mat4(), a);
        expect(Mat4.strictEquals(a, b)).toBe(true);
        const arr = Mat4.toArray([], a);
        expect(arr.length).toBe(16);
        expect(Mat4.fromArray(new Mat4(), arr).m13).toBe(2);
    });
});

describe('Vec4 and Color', () => {
    it('writes a Vec4 into an array', () => {
        expect(Vec4.toArray([], new Vec4(1, 2, 3, 4))).toEqual([1, 2, 3, 4]);
        expect(Vec4.copy(new Vec4(), new Vec4(1, 2, 3, 4)).w).toBe(4);
    });

    it('writes a Color as 0..1 floats, lerps, and reads hex statically', () => {
        expect(Color.toArray([], new Color(255, 0, 51, 255))).toEqual([1, 0, 0.2, 1]);
        const mid = Color.lerp(new Color(), new Color(0, 0, 0, 0), new Color(200, 100, 50, 255), 0.5);
        expect([mid.r, mid.g, mid.b]).toEqual([100, 50, 25]);
        const c = Color.fromHEX(new Color(), '#ff8000');
        expect([c.r, c.g, c.b, c.a]).toEqual([255, 128, 0, 255]);
    });
});
