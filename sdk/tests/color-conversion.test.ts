/**
 * @file    color-conversion.test.ts
 * @brief   convertFromWasm mutates in place; convertForWasm replaces color
 *          slots without touching the caller's inner color objects.
 */
import { describe, expect, it } from 'vitest';
import { convertForWasm, convertFromWasm } from '../src/ecs/BuiltinBridge';

describe('convertFromWasm', () => {
    it('returns the same outer object (zero outer allocation)', () => {
        const src = { color: { x: 1, y: 0.5, z: 0.25, w: 0.1 } };
        const out = convertFromWasm(src as Record<string, unknown>, ['color']);
        expect(out).toBe(src);
    });

    it('writes r/g/b/a into the same color object (zero inner allocation)', () => {
        const color = { x: 0.1, y: 0.2, z: 0.3, w: 0.4 };
        const src = { color };
        const out = convertFromWasm(src as Record<string, unknown>, ['color']);
        // Same reference preserved — the caller's nested object was mutated in place.
        expect(out.color).toBe(color);
        // r/g/b/a are written alongside the original x/y/z/w (ghost keys are
        // intentional — consumers read r/g/b/a only, and leaving the xyzw
        // slots keeps the hidden class stable across calls).
        const c = out.color as { r: number; g: number; b: number; a: number };
        expect(c.r).toBeCloseTo(0.1);
        expect(c.g).toBeCloseTo(0.2);
        expect(c.b).toBeCloseTo(0.3);
        expect(c.a).toBeCloseTo(0.4);
    });

    it('is a no-op when there are no color keys', () => {
        const src = { x: 1, y: 2 };
        expect(convertFromWasm(src as Record<string, unknown>, [])).toBe(src);
    });

    it('skips color slots that are not objects', () => {
        const src = { color: null };
        const out = convertFromWasm(src as Record<string, unknown>, ['color']);
        expect(out.color).toBeNull();
    });
});

describe('convertForWasm', () => {
    it('does NOT mutate the caller-provided color object', () => {
        const color = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 };
        const src = { color };
        convertForWasm(src as Record<string, unknown>, ['color']);
        // Caller's original object is untouched (still has r/g/b/a, no x/y/z/w).
        expect(color).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 });
    });

    it('replaces the color slot with a fresh {x,y,z,w} object', () => {
        const color = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 };
        const src = { color };
        const out = convertForWasm(src as Record<string, unknown>, ['color']);
        expect(out.color).not.toBe(color);
        expect(out.color).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
    });

    it('returns the same outer object (zero outer allocation)', () => {
        const src = { color: { r: 1, g: 0, b: 0, a: 1 } };
        const out = convertForWasm(src as Record<string, unknown>, ['color']);
        expect(out).toBe(src);
    });
});

describe('round-trip', () => {
    it('convertFromWasm then convertForWasm restores the original numeric values', () => {
        const fromWasm = { tint: { x: 0.5, y: 0.6, z: 0.7, w: 0.8 } };
        const sdkView = convertFromWasm(fromWasm as Record<string, unknown>, ['tint']) as {
            tint: { r: number; g: number; b: number; a: number };
        };
        expect(sdkView.tint.r).toBeCloseTo(0.5);

        const back = convertForWasm({ tint: { r: sdkView.tint.r, g: sdkView.tint.g, b: sdkView.tint.b, a: sdkView.tint.a } }, ['tint']) as {
            tint: { x: number; y: number; z: number; w: number };
        };
        expect(back.tint).toEqual({ x: 0.5, y: 0.6, z: 0.7, w: 0.8 });
    });
});
