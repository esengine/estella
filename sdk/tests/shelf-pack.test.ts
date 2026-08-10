// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ShelfPacker — the one rectangle packer, shared by the glyph atlas and
 *        the asset cook. Verifies row advance, first-fit across open rows, no
 *        overlaps, page-full + oversize rejection, and reset.
 */
import { describe, it, expect } from 'vitest';
import { ShelfPacker, type PackPos } from '../src/util/shelfPack';

function overlaps(a: PackPos & { w: number; h: number }, b: PackPos & { w: number; h: number }): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('ShelfPacker', () => {
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

    // The behaviour the two implementations disagreed on: a row that a later,
    // shorter rect still fits into is reused rather than abandoned.
    it('fills an earlier row before opening a new one', () => {
        const p = new ShelfPacker(100, 100);
        expect(p.pack(60, 30)).toEqual({ x: 0, y: 0 });   // opens row 0, 30 tall
        expect(p.pack(90, 10)).toEqual({ x: 0, y: 30 });  // too wide for row 0 → row 1
        // Fits row 0's leftover (40 wide) AND row 0's height: it goes back up.
        expect(p.pack(40, 10)).toEqual({ x: 60, y: 0 });
    });

    it('reset reclaims the whole page', () => {
        const p = new ShelfPacker(32, 32);
        p.pack(32, 32);
        expect(p.pack(1, 1)).toBeNull();
        p.reset();
        expect(p.pack(1, 1)).toEqual({ x: 0, y: 0 });
    });
});
