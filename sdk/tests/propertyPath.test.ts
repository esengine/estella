import { describe, it, expect } from 'vitest';
import { getNestedProperty, setNestedProperty, parsePropertyPath } from '../src/ui/propertyPath';

describe('propertyPath', () => {
    describe('getNestedProperty', () => {
        it('reads top-level field', () => {
            expect(getNestedProperty({ x: 42 }, 'x')).toBe(42);
        });

        it('reads nested field', () => {
            expect(getNestedProperty({ position: { x: 1, y: 2 } }, 'position.x')).toBe(1);
        });

        it('returns undefined for missing path', () => {
            expect(getNestedProperty({ a: 1 }, 'b')).toBeUndefined();
        });

        it('returns undefined for null intermediate', () => {
            expect(getNestedProperty({ a: null }, 'a.b')).toBeUndefined();
        });
    });

    describe('setNestedProperty', () => {
        it('sets top-level field', () => {
            const obj = { x: 0 };
            expect(setNestedProperty(obj, 'x', 5)).toBe(true);
            expect(obj.x).toBe(5);
        });

        it('sets nested field', () => {
            const obj = { color: { r: 0, g: 0, b: 0 } };
            expect(setNestedProperty(obj, 'color.r', 1)).toBe(true);
            expect(obj.color.r).toBe(1);
        });

        it('returns false for missing key', () => {
            expect(setNestedProperty({ a: 1 }, 'b', 2)).toBe(false);
        });

        it('returns false for null intermediate', () => {
            expect(setNestedProperty({ a: null } as any, 'a.b', 1)).toBe(false);
        });

        it('supports non-number values', () => {
            const obj = { visible: true };
            expect(setNestedProperty(obj, 'visible', false)).toBe(true);
            expect(obj.visible).toBe(false);
        });
    });

    describe('parsePropertyPath', () => {
        it('splits component and field', () => {
            expect(parsePropertyPath('Sprite.color.r')).toEqual({
                componentName: 'Sprite',
                fieldPath: 'color.r',
            });
        });

        it('returns null for no dot', () => {
            expect(parsePropertyPath('Sprite')).toBeNull();
        });
    });
});
