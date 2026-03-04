import { describe, it, expect } from 'vitest';
import { applyDefaultTint } from '../src/ui/uiHelpers';
import type { Color } from '../src/types';

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const RED: Color = { r: 1, g: 0, b: 0, a: 1 };
const HALF_GRAY: Color = { r: 0.5, g: 0.5, b: 0.5, a: 0.8 };

describe('applyDefaultTint', () => {
    it('returns base color unchanged in normal state', () => {
        const result = applyDefaultTint(WHITE, true, false, false);
        expect(result).toEqual(WHITE);
    });

    it('returns a copy, not the same reference', () => {
        const result = applyDefaultTint(WHITE, true, false, false);
        expect(result).not.toBe(WHITE);
    });

    it('brightens on hover', () => {
        const result = applyDefaultTint(HALF_GRAY, true, false, true);
        expect(result.r).toBeCloseTo(0.5 * 1.15);
        expect(result.g).toBeCloseTo(0.5 * 1.15);
        expect(result.b).toBeCloseTo(0.5 * 1.15);
        expect(result.a).toBe(HALF_GRAY.a);
    });

    it('clamps hover tint to 1.0', () => {
        const result = applyDefaultTint(WHITE, true, false, true);
        expect(result.r).toBe(1);
        expect(result.g).toBe(1);
        expect(result.b).toBe(1);
    });

    it('darkens on press', () => {
        const result = applyDefaultTint(WHITE, true, true, false);
        expect(result.r).toBeCloseTo(0.75);
        expect(result.g).toBeCloseTo(0.75);
        expect(result.b).toBeCloseTo(0.75);
        expect(result.a).toBe(1);
    });

    it('pressed takes priority over hovered', () => {
        const result = applyDefaultTint(WHITE, true, true, true);
        expect(result.r).toBeCloseTo(0.75);
        expect(result.g).toBeCloseTo(0.75);
        expect(result.b).toBeCloseTo(0.75);
    });

    it('dims and reduces alpha when disabled', () => {
        const result = applyDefaultTint(WHITE, false, false, false);
        expect(result.r).toBeCloseTo(0.5);
        expect(result.g).toBeCloseTo(0.5);
        expect(result.b).toBeCloseTo(0.5);
        expect(result.a).toBeCloseTo(0.6);
    });

    it('disabled takes priority over pressed and hovered', () => {
        const result = applyDefaultTint(WHITE, false, true, true);
        expect(result.r).toBeCloseTo(0.5);
        expect(result.a).toBeCloseTo(0.6);
    });

    it('applies multiplicatively to non-white base color', () => {
        const result = applyDefaultTint(RED, true, true, false);
        expect(result.r).toBeCloseTo(0.75);
        expect(result.g).toBe(0);
        expect(result.b).toBe(0);
    });

    it('applies disabled tint multiplicatively to dark color', () => {
        const result = applyDefaultTint(HALF_GRAY, false, false, false);
        expect(result.r).toBeCloseTo(0.25);
        expect(result.g).toBeCloseTo(0.25);
        expect(result.b).toBeCloseTo(0.25);
        expect(result.a).toBeCloseTo(0.48);
    });
});
