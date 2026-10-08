import { describe, it, expect } from 'vitest';
import { checkNineSliceCorners } from '../lib/nineSliceProbe.mjs';

describe('nine-slice pixel acceptance', () => {
    const width = 64, height = 16;
    function frame() {
        const rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const k = ((height - 1 - y) * width + x) * 4;
            rgba.set([x % 8 + y * 8, y * 7, (x % 8) * 15, 255], k);
        }
        return rgba;
    }
    const rects = [[0,0,16,16],[24,0,40,16]];
    it('compares every corner pixel after a width change', () => {
        expect(checkNineSliceCorners(frame(), width, height, rects)).toMatchObject({ok:true,comparedPixels:256});
    });
    it('rejects one damaged channel inside each corner', () => {
        for (const [x,y] of [[26,2],[58,2],[26,10],[58,10]]) {
            const rgba = frame(); rgba[((height - 1 - y) * width + x) * 4 + 1]++;
            expect(checkNineSliceCorners(rgba, width, height, rects).ok).toBe(false);
        }
    });
    it('rejects empty and uniform frames even if equal', () => {
        expect(checkNineSliceCorners(new Uint8Array(width * height * 4), width, height, rects).ok).toBe(false);
        expect(checkNineSliceCorners(new Uint8Array(width * height * 4).fill(255), width, height, rects).ok).toBe(false);
    });
    it('rejects an invalid readback or rectangle', () => {
        expect(checkNineSliceCorners(frame(),width,height,[[0,0,16,16],[60,0,40,16]]).ok).toBe(false);
        expect(checkNineSliceCorners(frame(),width,height,rects,0).ok).toBe(false);
        expect(checkNineSliceCorners(frame().slice(4),width,height,rects).ok).toBe(false);
    });
});
