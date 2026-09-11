// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Cutting a sprite sheet into cells.
 *
 *        The stride is `margin + i * (cell + spacing)`, and it is wrong by one for
 *        a long time before anyone notices: the sheets people test with have no
 *        margin and no spacing, which hides a mistake in BOTH terms. So the cases
 *        here all carry at least one of them.
 */
import { describe, it, expect } from 'vitest';
import {
    sheetCols, sheetRows, sheetCellCount, sheetCellRect, sheetCellUv, type SheetGrid,
} from '../src/asset/sheetGrid';

/** Four 32px cells across a 128px page, no margin, no spacing — the easy sheet. */
const plain: SheetGrid = {
    cellWidth: 32, cellHeight: 32, margin: 0, spacing: 0, pageWidth: 128, pageHeight: 64,
};

/**
 * The same 4x2 grid, TIGHT: 136 x 68, ending flush with the last cell.
 *
 * The trap: give the page trailing margin and the `+ spacing` term in the column
 * count stops mattering, so dropping it leaves every assertion here green.
 */
const padded: SheetGrid = {
    cellWidth: 32, cellHeight: 32, margin: 2, spacing: 2, pageWidth: 136, pageHeight: 68,
};

describe('sheet grid', () => {
    it('counts the cells a plain sheet holds', () => {
        expect(sheetCols(plain)).toBe(4);
        expect(sheetRows(plain)).toBe(2);
        expect(sheetCellCount(plain)).toBe(8);
    });

    it('counts them the same when margin and spacing are paid for', () => {
        expect(sheetCols(padded)).toBe(4);
        expect(sheetRows(padded)).toBe(2);
    });

    it('counts the last column even when nothing follows it', () => {
        // The tight page ends flush with the fourth cell. Counting as though every
        // cell owed a trailing gap loses it — 3 columns for a sheet that has 4.
        expect(sheetCols(padded)).toBe(4);
        expect(sheetRows(padded)).toBe(2);
    });

    it('does not invent a column out of a trailing gap', () => {
        // Room for a fifth cell's spacing, but not for the cell.
        expect(sheetCols({ ...padded, pageWidth: 136 + 2 })).toBe(4);
        // …and finds the fifth as soon as the page can hold it.
        expect(sheetCols({ ...padded, pageWidth: 136 + 2 + 32 })).toBe(5);
    });

    it('addresses cells row-major from the top-left', () => {
        expect(sheetCellRect(plain, 0)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
        expect(sheetCellRect(plain, 3)).toEqual({ x: 96, y: 0, width: 32, height: 32 });
        expect(sheetCellRect(plain, 4)).toEqual({ x: 0, y: 32, width: 32, height: 32 });
    });

    it('pays margin once and spacing per gap', () => {
        expect(sheetCellRect(padded, 0)).toMatchObject({ x: 2, y: 2 });
        expect(sheetCellRect(padded, 1)).toMatchObject({ x: 36, y: 2 });   // 2 + 32 + 2
        expect(sheetCellRect(padded, 4)).toMatchObject({ x: 2, y: 36 });
    });

    it('clamps an index that would walk off the page', () => {
        expect(sheetCellRect(plain, 99)).toEqual(sheetCellRect(plain, 7));
        expect(sheetCellRect(plain, -5)).toEqual(sheetCellRect(plain, 0));
        expect(sheetCellRect(plain, 2.7)).toEqual(sheetCellRect(plain, 2));
    });

    it('survives a degenerate grid instead of dividing by zero', () => {
        const dead: SheetGrid = { ...plain, cellWidth: 0, cellHeight: 0, spacing: 0 };
        expect(sheetCols(dead)).toBe(1);
        expect(sheetRows(dead)).toBe(1);
        expect(() => sheetCellRect(dead, 3)).not.toThrow();
    });

    // Cell 0 is the sheet's TOP-left and UV runs from the bottom, so cell 0 is the
    // HIGHEST v. This is the one thing about a uvOffset in an inspector that looks
    // wrong until you remember which way an image is stored.
    it('flips Y: the first cell is the top of the page, which is the top of UV space', () => {
        const top = sheetCellUv(plain, 0);
        expect(top.uvOffset).toEqual({ x: 0, y: 0.5 });   // 1 − (0 + 32)/64
        expect(top.uvScale).toEqual({ x: 0.25, y: 0.5 });

        const below = sheetCellUv(plain, 4);              // directly under cell 0
        expect(below.uvOffset).toEqual({ x: 0, y: 0 });
    });

    it('a full-page cell is the whole UV square', () => {
        const whole: SheetGrid = {
            cellWidth: 64, cellHeight: 64, margin: 0, spacing: 0, pageWidth: 64, pageHeight: 64,
        };
        expect(sheetCellUv(whole, 0)).toEqual({ uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 } });
    });

    it('tiles the page without gaps or overlap when nothing is padded', () => {
        // Every cell's UV window abuts its neighbour's: the sum of the widths is 1.
        const windows = Array.from({ length: sheetCols(plain) }, (_, i) => sheetCellUv(plain, i));
        expect(windows.reduce((a, w) => a + w.uvScale.x, 0)).toBeCloseTo(1, 6);
        for (let i = 1; i < windows.length; i++) {
            expect(windows[i]!.uvOffset.x).toBeCloseTo(
                windows[i - 1]!.uvOffset.x + windows[i - 1]!.uvScale.x, 6);
        }
    });
});
