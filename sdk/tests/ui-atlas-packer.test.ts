/**
 * @file  REARCH_GUI P1.1 — ShelfPacker (glyph atlas rectangle packer). Pure
 *        logic; verifies row advance, wrapping, no overlaps, page-full + oversize
 *        rejection, and reset.
 */
import { describe, it, expect } from 'vitest';
import { ShelfPacker, type PackPos } from '../src/ui/text/atlas-packer';

function overlaps(a: PackPos & { w: number; h: number }, b: PackPos & { w: number; h: number }): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('REARCH_GUI P1.1: ShelfPacker', () => {
    it('advances along a row then wraps to the next shelf', () => {
        const p = new ShelfPacker(100, 100);
        expect(p.pack(40, 20)).toEqual({ x: 0, y: 0 });
        expect(p.pack(40, 20)).toEqual({ x: 40, y: 0 });
        // 40+40+40 > 100 → wraps to a new shelf at y = tallest-of-row (20)
        expect(p.pack(40, 20)).toEqual({ x: 0, y: 20 });
    });

    it('grows shelf height to the tallest glyph in the row', () => {
        const p = new ShelfPacker(100, 100);
        p.pack(10, 30); // tall glyph sets row height 30
        p.pack(10, 10);
        // next row starts below the 30-tall shelf
        p.pack(95, 5); // forces wrap on the following pack
        const wrapped = p.pack(95, 5);
        expect(wrapped).toEqual({ x: 0, y: 35 }); // 30 (row0) + 5 (row1) = 35
    });

    it('packs many glyphs with no overlaps', () => {
        const p = new ShelfPacker(256, 256);
        const placed: Array<PackPos & { w: number; h: number }> = [];
        for (let i = 0; i < 200; i++) {
            const w = 8 + (i % 5) * 4;
            const h = 12;
            const pos = p.pack(w, h);
            if (!pos) break;
            placed.push({ ...pos, w, h });
        }
        expect(placed.length).toBeGreaterThan(50);
        for (let i = 0; i < placed.length; i++) {
            for (let j = i + 1; j < placed.length; j++) {
                expect(overlaps(placed[i], placed[j])).toBe(false);
            }
            expect(placed[i].x + placed[i].w).toBeLessThanOrEqual(256);
            expect(placed[i].y + placed[i].h).toBeLessThanOrEqual(256);
        }
    });

    it('returns null when the page is full and for oversize rects', () => {
        const p = new ShelfPacker(32, 32);
        expect(p.pack(40, 10)).toBeNull(); // wider than page
        expect(p.pack(10, 40)).toBeNull(); // taller than page
        p.pack(32, 32);                    // fills the page
        expect(p.pack(1, 1)).toBeNull();   // no room left
    });

    it('reset reclaims the whole page', () => {
        const p = new ShelfPacker(32, 32);
        p.pack(32, 32);
        expect(p.pack(1, 1)).toBeNull();
        p.reset();
        expect(p.pack(1, 1)).toEqual({ x: 0, y: 0 });
    });
});
