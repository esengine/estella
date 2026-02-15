import { describe, it, expect } from 'vitest';
import { validateNumber, validateVec2, validateVec3, validateColor } from '../../property/validation';
import type { PropertyMeta } from '../../property/PropertyEditor';

describe('Property validation', () => {
    describe('validateNumber', () => {
        it('validates valid numbers', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number' };
            const result = validateNumber(42, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(42);
        });

        it('validates string numbers', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number' };
            const result = validateNumber('42.5', meta);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(42.5);
        });

        it('rejects NaN values', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number' };
            const result = validateNumber('invalid', meta);
            expect(result.valid).toBe(false);
            expect(result.value).toBe(0);
            expect(result.error).toBe('Value must be a number');
        });

        it('enforces min constraint', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number', min: 0 };
            const result = validateNumber(-5, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toBe(0);
            expect(result.error).toBe('Value must be at least 0');
        });

        it('enforces max constraint', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number', max: 100 };
            const result = validateNumber(150, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toBe(100);
            expect(result.error).toBe('Value must be at most 100');
        });

        it('allows values within range', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number', min: 0, max: 100 };
            const result = validateNumber(50, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(50);
        });

        it('handles edge case min value', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number', min: 0 };
            const result = validateNumber(0, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(0);
        });

        it('handles edge case max value', () => {
            const meta: PropertyMeta = { name: 'test', type: 'number', max: 100 };
            const result = validateNumber(100, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(100);
        });
    });

    describe('validateVec2', () => {
        it('validates valid Vec2', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec2' };
            const result = validateVec2({ x: 10, y: 20 }, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toEqual({ x: 10, y: 20 });
        });

        it('rejects non-object values', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec2' };
            const result = validateVec2('invalid', meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ x: 0, y: 0 });
        });

        it('enforces min constraint on components', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec2', min: 0 };
            const result = validateVec2({ x: -5, y: 10 }, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ x: 0, y: 10 });
        });

        it('enforces max constraint on components', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec2', max: 100 };
            const result = validateVec2({ x: 50, y: 150 }, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ x: 50, y: 100 });
        });
    });

    describe('validateVec3', () => {
        it('validates valid Vec3', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec3' };
            const result = validateVec3({ x: 10, y: 20, z: 30 }, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toEqual({ x: 10, y: 20, z: 30 });
        });

        it('rejects non-object values', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec3' };
            const result = validateVec3(null, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ x: 0, y: 0, z: 0 });
        });

        it('enforces min constraint on all components', () => {
            const meta: PropertyMeta = { name: 'test', type: 'vec3', min: 0 };
            const result = validateVec3({ x: -1, y: -2, z: -3 }, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ x: 0, y: 0, z: 0 });
        });
    });

    describe('validateColor', () => {
        it('validates valid Color', () => {
            const meta: PropertyMeta = { name: 'test', type: 'color' };
            const result = validateColor({ r: 255, g: 128, b: 64, a: 255 }, meta);
            expect(result.valid).toBe(true);
        });

        it('clamps color components to 0-255', () => {
            const meta: PropertyMeta = { name: 'test', type: 'color' };
            const result = validateColor({ r: 300, g: -10, b: 128, a: 400 }, meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ r: 255, g: 0, b: 128, a: 255 });
        });

        it('rejects non-object values', () => {
            const meta: PropertyMeta = { name: 'test', type: 'color' };
            const result = validateColor('red', meta);
            expect(result.valid).toBe(false);
            expect(result.value).toEqual({ r: 255, g: 255, b: 255, a: 255 });
        });

        it('allows valid color range', () => {
            const meta: PropertyMeta = { name: 'test', type: 'color' };
            const result = validateColor({ r: 0, g: 0, b: 0, a: 0 }, meta);
            expect(result.valid).toBe(true);
            expect(result.value).toEqual({ r: 0, g: 0, b: 0, a: 0 });
        });
    });
});
