// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { scalar } from '../src/math/scalar';
import { v2 } from '../src/math/vec2';
import { v3 } from '../src/math/vec3';
import { col } from '../src/math/color';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('scalar', () => {
    it('clamp / clamp01', () => {
        expect(scalar.clamp(5, 0, 3)).toBe(3);
        expect(scalar.clamp(-1, 0, 3)).toBe(0);
        expect(scalar.clamp(2, 0, 3)).toBe(2);
        expect(scalar.clamp01(2)).toBe(1);
        expect(scalar.clamp01(-2)).toBe(0);
    });
    it('lerp / inverseLerp / remap', () => {
        expect(scalar.lerp(0, 10, 0.5)).toBe(5);
        expect(scalar.inverseLerp(0, 10, 5)).toBe(0.5);
        expect(scalar.inverseLerp(2, 2, 5)).toBe(0); // degenerate
        expect(scalar.remap(5, 0, 10, 0, 100)).toBe(50);
        expect(scalar.remap(5, 2, 2, 0, 100)).toBe(0); // degenerate in-range
    });
    it('deg/rad round-trip', () => {
        close(scalar.rad2deg(scalar.deg2rad(90)), 90);
        close(scalar.deg2rad(180), Math.PI);
    });
    it('approximately', () => {
        expect(scalar.approximately(1, 1 + 1e-9)).toBe(true);
        expect(scalar.approximately(1, 1.1)).toBe(false);
    });
    it('smoothstep clamps and eases', () => {
        expect(scalar.smoothstep(0, 1, -1)).toBe(0);
        expect(scalar.smoothstep(0, 1, 2)).toBe(1);
        expect(scalar.smoothstep(0, 1, 0.5)).toBe(0.5);
    });
    it('mod is euclidean (sign of divisor)', () => {
        expect(scalar.mod(-1, 4)).toBe(3);
        expect(scalar.mod(5, 4)).toBe(1);
    });
    it('sign', () => {
        expect(scalar.sign(-3)).toBe(-1);
        expect(scalar.sign(0)).toBe(0);
        expect(scalar.sign(3)).toBe(1);
    });
});

describe('v2', () => {
    it('add / sub / scale / mul / neg', () => {
        expect(v2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
        expect(v2.sub({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
        expect(v2.scale({ x: 2, y: 3 }, 2)).toEqual({ x: 4, y: 6 });
        expect(v2.mul({ x: 2, y: 3 }, { x: 4, y: 5 })).toEqual({ x: 8, y: 15 });
        expect(v2.neg({ x: 1, y: -2 })).toEqual({ x: -1, y: 2 });
    });
    it('dot / cross', () => {
        expect(v2.dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
        expect(v2.dot({ x: 2, y: 3 }, { x: 4, y: 5 })).toBe(23);
        expect(v2.cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    });
    it('len / len2 / dist / dist2', () => {
        expect(v2.len({ x: 3, y: 4 })).toBe(5);
        expect(v2.len2({ x: 3, y: 4 })).toBe(25);
        expect(v2.dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
        expect(v2.dist2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
    });
    it('normalize (and zero vector → zero)', () => {
        expect(v2.normalize({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
        expect(v2.normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    });
    it('lerp', () => {
        expect(v2.lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
    });
    it('angle / fromAngle round-trip', () => {
        const a = v2.fromAngle(Math.PI / 2, 2);
        close(a.x, 0); close(a.y, 2);
        close(v2.angle({ x: 0, y: 1 }), Math.PI / 2);
    });
    it('rotate 90deg', () => {
        const r = v2.rotate({ x: 1, y: 0 }, Math.PI / 2);
        close(r.x, 0); close(r.y, 1);
    });
    it('perp / equals', () => {
        expect(v2.perp({ x: 2, y: 3 })).toEqual({ x: -3, y: 2 });
        // left perpendicular of +X is +Y (equals tolerates the -0 component)
        expect(v2.equals(v2.perp({ x: 1, y: 0 }), { x: 0, y: 1 })).toBe(true);
        expect(v2.equals({ x: 1, y: 1 }, { x: 1 + 1e-9, y: 1 })).toBe(true);
        expect(v2.equals({ x: 1, y: 1 }, { x: 1.1, y: 1 })).toBe(false);
    });
});

describe('v3', () => {
    it('add / sub / scale / dot', () => {
        expect(v3.add({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 })).toEqual({ x: 2, y: 3, z: 4 });
        expect(v3.sub({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 })).toEqual({ x: 0, y: 1, z: 2 });
        expect(v3.scale({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 });
        expect(v3.dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    });
    it('cross (right-handed)', () => {
        expect(v3.cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
    });
    it('len / normalize', () => {
        expect(v3.len({ x: 2, y: 3, z: 6 })).toBe(7);
        expect(v3.normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    });
    it('lerp / equals', () => {
        expect(v3.lerp({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5)).toEqual({ x: 1, y: 2, z: 3 });
        expect(v3.equals({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 + 1e-9 })).toBe(true);
    });
});

describe('col', () => {
    it('create / rgb / from255', () => {
        expect(col.rgb(1, 0, 0)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(col.from255(255, 128, 0, 255).r).toBe(1);
        close(col.from255(255, 128, 0).g, 128 / 255);
    });
    it('fromHex (#rrggbb, #rgb, #rrggbbaa, no #)', () => {
        expect(col.fromHex('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(col.fromHex('#f00')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(col.fromHex('00ff00')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
        close(col.fromHex('#ff000080').a, 128 / 255);
    });
    it('fromHex throws on malformed input', () => {
        expect(() => col.fromHex('#xyz')).toThrow(/invalid hex/);
        expect(() => col.fromHex('#ff000')).toThrow(/invalid hex/); // 5 digits: not 3/4/6/8
    });
    it('toHex round-trips', () => {
        expect(col.toHex({ r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000');
        expect(col.toHex({ r: 0, g: 1, b: 0, a: 0.5 }, true)).toBe('#00ff0080');
        expect(col.toHex(col.fromHex('#3399cc'))).toBe('#3399cc');
    });
    it('lerp / withAlpha / multiply / scaleRgb / equals', () => {
        expect(col.lerp({ r: 0, g: 0, b: 0, a: 0 }, { r: 1, g: 1, b: 1, a: 1 }, 0.5))
            .toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
        expect(col.withAlpha({ r: 1, g: 1, b: 1, a: 1 }, 0.25).a).toBe(0.25);
        expect(col.multiply({ r: 1, g: 0.5, b: 1, a: 1 }, { r: 0.5, g: 1, b: 0, a: 1 }))
            .toEqual({ r: 0.5, g: 0.5, b: 0, a: 1 });
        expect(col.scaleRgb({ r: 0.4, g: 0.2, b: 0.1, a: 0.8 }, 2)).toEqual({ r: 0.8, g: 0.4, b: 0.2, a: 0.8 });
        expect(col.equals({ r: 1, g: 1, b: 1, a: 1 }, { r: 1, g: 1, b: 1, a: 1 + 1e-9 })).toBe(true);
    });
});
