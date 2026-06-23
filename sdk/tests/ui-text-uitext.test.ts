/**
 * @file  REARCH_GUI P1.4 — composeTRS (entity world matrix) + rectTextBox
 *        (UIRect text placement) for the SDF text plugin. Pure → unit-tested
 *        here; the full on-screen path (TextPlugin → render) is render-verified.
 */
import { describe, it, expect } from 'vitest';
import { composeTRS, rectTextBox } from '../src/ui/text/text-transform';

const IDQ = { x: 0, y: 0, z: 0, w: 1 };

describe('REARCH_GUI P1.3c: composeTRS', () => {
    it('builds a column-major TRS matrix (identity rotation)', () => {
        const m = composeTRS(new Float32Array(16), { x: 10, y: 20, z: 30 }, IDQ, { x: 2, y: 3, z: 4 });
        expect(Array.from(m)).toEqual([
            2, 0, 0, 0,
            0, 3, 0, 0,
            0, 0, 4, 0,
            10, 20, 30, 1,
        ]);
    });

    it('encodes a 90° z-rotation in the upper-left 2x2 (column-major)', () => {
        const s = Math.SQRT1_2; // sin(45°) = cos(45°)
        const m = composeTRS(new Float32Array(16), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: s, w: s }, { x: 1, y: 1, z: 1 });
        expect(m[0]).toBeCloseTo(0);   // cosθ
        expect(m[1]).toBeCloseTo(1);   // sinθ
        expect(m[4]).toBeCloseTo(-1);  // -sinθ
        expect(m[5]).toBeCloseTo(0);   // cosθ
        expect(m[15]).toBe(1);
    });
});

describe('REARCH_GUI P1.4c: rectTextBox (UIRect text placement)', () => {
    it('offsets a center-pivot rect to its top-left + wrap box', () => {
        const box = rectTextBox(0.5, 0.5, 200, 100, 24);
        expect(box.originX).toBeCloseTo(-100);          // left of a center-pivoted 200-wide rect
        expect(box.originY).toBeCloseTo(50 - 24 * 0.8); // rect top (y-up) minus first-line ascent
        expect(box.maxWidth).toBe(200);
    });

    it('top-left-pivot rect: left edge at the pivot', () => {
        const box = rectTextBox(0, 1, 200, 100, 24);
        expect(box.originX).toBeCloseTo(0);
        expect(box.originY).toBeCloseTo(-24 * 0.8);
    });
});
