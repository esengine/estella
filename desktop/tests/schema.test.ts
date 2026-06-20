/**
 * @file  Editor schema pure-function tests — establishes the desktop vitest
 *        harness and pins the inspector value-shape inference / conversions that
 *        the JSON-first rewrite (REARCH_SERIALIZATION.md) will lean on.
 */
import { describe, it, expect } from 'vitest';
import { prettyLabel, hexToRgb, angleZToQuat, inferField } from '@/engine/schema';

describe('prettyLabel', () => {
    it('splits camelCase and capitalizes', () => {
        expect(prettyLabel('orthoSize')).toBe('Ortho Size');
        expect(prettyLabel('position')).toBe('Position');
        expect(prettyLabel('isActive')).toBe('Is Active');
    });
});

describe('hexToRgb', () => {
    it('parses #rrggbb into 0..1 channels', () => {
        expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
        expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
        const red = hexToRgb('#ff0000');
        expect(red.r).toBe(1);
        expect(red.g).toBe(0);
        expect(red.b).toBe(0);
    });
    it('falls back to white on malformed input', () => {
        expect(hexToRgb('nope')).toEqual({ r: 1, g: 1, b: 1 });
    });
});

describe('angleZToQuat', () => {
    it('round-trips 0° to identity', () => {
        const q = angleZToQuat(0);
        expect(q.x).toBe(0);
        expect(q.y).toBe(0);
        expect(q.z).toBeCloseTo(0, 6);
        expect(q.w).toBeCloseTo(1, 6);
    });
    it('encodes 90° into z/w', () => {
        const q = angleZToQuat(90);
        expect(q.z).toBeCloseTo(Math.SQRT1_2, 6);
        expect(q.w).toBeCloseTo(Math.SQRT1_2, 6);
    });
});

describe('inferField', () => {
    it('infers scalar/bool/string types from the live value', () => {
        expect(inferField('size', 5, false)).toMatchObject({ type: 'number', value: 5 });
        expect(inferField('flipX', true, false)).toMatchObject({ type: 'bool', value: true });
        expect(inferField('name', 'hi', false)).toMatchObject({ type: 'string', value: 'hi' });
    });
    it('infers vec2 / vec3 from object shape', () => {
        expect(inferField('p', { x: 1, y: 2 }, false)).toMatchObject({ type: 'vec2', value: [1, 2] });
        expect(inferField('p', { x: 1, y: 2, z: 3 }, false)).toMatchObject({ type: 'vec3', value: [1, 2, 3] });
    });
    it('treats a color key as a hex color', () => {
        const f = inferField('color', { r: 1, g: 0, b: 0 }, true);
        expect(f?.type).toBe('color');
        expect(f?.value).toBe('#ff0000');
    });
    it('returns null for an unknown shape', () => {
        expect(inferField('weird', { foo: 1 }, false)).toBeNull();
    });
});
