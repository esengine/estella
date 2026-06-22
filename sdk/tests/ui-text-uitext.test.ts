/**
 * @file  REARCH_GUI P1.3c — composeTRS, the world-transform matrix the UIText
 *        pre-flush system feeds to submitTextBatch. Pure → unit-tested here; the
 *        full on-screen path (UITextPlugin → render) is render-host-verified.
 */
import { describe, it, expect } from 'vitest';
import { composeTRS } from '../src/ui/text/ui-text';

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
