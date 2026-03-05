import { describe, it, expect } from 'vitest';
import { setNestedProperty, getNestedProperty } from '../src/timeline/propertyUtils';

describe('propertyUtils', () => {
    describe('setNestedProperty', () => {
        it('should set a top-level property', () => {
            const obj = { x: 0 };
            expect(setNestedProperty(obj, 'x', 5)).toBe(true);
            expect(obj.x).toBe(5);
        });

        it('should set a nested property', () => {
            const obj = { color: { r: 0, g: 0, b: 0, a: 1 } };
            expect(setNestedProperty(obj, 'color.a', 0.5)).toBe(true);
            expect(obj.color.a).toBe(0.5);
        });

        it('should set a deeply nested property', () => {
            const obj = { a: { b: { c: 0 } } };
            expect(setNestedProperty(obj, 'a.b.c', 42)).toBe(true);
            expect(obj.a.b.c).toBe(42);
        });

        it('should return false for non-existent path', () => {
            const obj = { x: 0 };
            expect(setNestedProperty(obj, 'y', 5)).toBe(false);
        });

        it('should return false if intermediate path is null', () => {
            const obj = { a: null as any };
            expect(setNestedProperty(obj, 'a.b', 5)).toBe(false);
        });
    });

    describe('getNestedProperty', () => {
        it('should get a top-level property', () => {
            expect(getNestedProperty({ x: 5 }, 'x')).toBe(5);
        });

        it('should get a nested property', () => {
            expect(getNestedProperty({ color: { a: 0.5 } }, 'color.a')).toBe(0.5);
        });

        it('should return undefined for non-existent path', () => {
            expect(getNestedProperty({ x: 0 }, 'y')).toBeUndefined();
        });

        it('should return undefined for non-number values', () => {
            expect(getNestedProperty({ name: 'hello' } as any, 'name')).toBeUndefined();
        });
    });
});
