/**
 * @file    uniform-arity.test.ts
 * @brief   classifyUniformArity — shared classifier used by both the
 *          material-registration serializer and the per-draw uniform
 *          binder. Previously each site had its own parallel branches.
 */
import { describe, expect, it } from 'vitest';
import { classifyUniformArity } from '../src/material';

describe('classifyUniformArity', () => {
    it('classifies a plain number as arity 1', () => {
        const out = classifyUniformArity(3.14);
        expect(out.arity).toBe(1);
        expect(out.values).toEqual([3.14, 0, 0, 0]);
    });

    it('classifies Vec2 as arity 2', () => {
        const out = classifyUniformArity({ x: 1, y: 2 });
        expect(out.arity).toBe(2);
        expect(out.values).toEqual([1, 2, 0, 0]);
    });

    it('classifies Vec3 as arity 3', () => {
        const out = classifyUniformArity({ x: 1, y: 2, z: 3 });
        expect(out.arity).toBe(3);
        expect(out.values).toEqual([1, 2, 3, 0]);
    });

    it('classifies Vec4 as arity 4', () => {
        const out = classifyUniformArity({ x: 1, y: 2, z: 3, w: 4 });
        expect(out.arity).toBe(4);
        expect(out.values).toEqual([1, 2, 3, 4]);
    });

    it('treats w presence as precedence (w > z > y detection order)', () => {
        // Safety: an object with { x, y, z, w } matches the w-branch first so
        // we never mis-classify a Vec4 as Vec3.
        const out = classifyUniformArity({ x: 1, y: 2, z: 3, w: 4 });
        expect(out.arity).toBe(4);
    });

    it('packs number[] up to length 4, zero-pads remaining slots', () => {
        expect(classifyUniformArity([5])).toEqual({ arity: 1, values: [5, 0, 0, 0] });
        expect(classifyUniformArity([5, 6])).toEqual({ arity: 2, values: [5, 6, 0, 0] });
        expect(classifyUniformArity([5, 6, 7])).toEqual({ arity: 3, values: [5, 6, 7, 0] });
        expect(classifyUniformArity([5, 6, 7, 8])).toEqual({ arity: 4, values: [5, 6, 7, 8] });
    });

    it('truncates number[] longer than 4 at arity 4', () => {
        const out = classifyUniformArity([5, 6, 7, 8, 9, 10]);
        expect(out.arity).toBe(4);
        expect(out.values).toEqual([5, 6, 7, 8]);
    });

    it('handles an empty number[] as arity 1 (degenerate but safe)', () => {
        const out = classifyUniformArity([]);
        expect(out.arity).toBe(1);
        expect(out.values).toEqual([0, 0, 0, 0]);
    });
});
