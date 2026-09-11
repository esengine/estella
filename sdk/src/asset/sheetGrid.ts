// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sheetGrid.ts
 * @brief   How a sprite sheet is cut into cells — the one author for that stride.
 *
 * Three surfaces cut a sheet the same way and each had written the arithmetic
 * down: the flipbook's `.esanim`, the tileset's atlas, and the particle emitter's
 * `spriteColumns`/`spriteRows`. The stride is `margin + i * (cell + spacing)` in
 * all of them, and it is the kind of expression that is wrong by one for a long
 * time before anybody notices, because a sheet with no margin and no spacing —
 * which is most of them — hides every mistake in both terms.
 *
 * So it lives here, named for what it is rather than for whoever asked first.
 * `.esanim` keeps its own spellings as one-line delegates: this is the author,
 * those are the aliases.
 *
 * A cell is addressed row-major from 0, the way every one of those surfaces
 * already addresses it.
 */

/**
 * A sheet's cutting geometry, in the image's own pixels. `pageWidth`/`pageHeight`
 * are the whole image, which is what turns a pixel rect into a UV window.
 */
export interface SheetGrid {
    cellWidth: number;
    cellHeight: number;
    margin: number;
    spacing: number;
    pageWidth: number;
    pageHeight: number;
}

/** Columns the grid fits across the page. At least 1, so cell 0 always resolves. */
export function sheetCols(grid: SheetGrid): number {
    const stride = grid.cellWidth + grid.spacing;
    // `+ spacing` because the last cell needs no trailing gap: a 64px page of two
    // 32px cells with 0 margin and 0 spacing is two columns, and so is a 66px page
    // of the same cells with 2px between them.
    return stride > 0 ? Math.max(1, Math.floor((grid.pageWidth - grid.margin + grid.spacing) / stride)) : 1;
}

/** Rows the grid fits down the page. At least 1, for the same reason. */
export function sheetRows(grid: SheetGrid): number {
    const stride = grid.cellHeight + grid.spacing;
    return stride > 0 ? Math.max(1, Math.floor((grid.pageHeight - grid.margin + grid.spacing) / stride)) : 1;
}

/** How many cells the grid holds — what a cell index is addressed against. */
export function sheetCellCount(grid: SheetGrid): number {
    return sheetCols(grid) * sheetRows(grid);
}

/** Pixel rect of a cell, clamped into the valid range so no index escapes the page. */
export function sheetCellRect(
    grid: SheetGrid,
    cell: number,
): { x: number; y: number; width: number; height: number } {
    const cols = sheetCols(grid);
    const clamped = Math.min(Math.max(0, Math.floor(cell)), sheetCellCount(grid) - 1);
    const col = clamped % cols;
    const row = Math.floor(clamped / cols);
    return {
        x: grid.margin + col * (grid.cellWidth + grid.spacing),
        y: grid.margin + row * (grid.cellHeight + grid.spacing),
        width: grid.cellWidth,
        height: grid.cellHeight,
    };
}

/**
 * UV window of a cell — exactly what `Sprite.uvOffset` / `Sprite.uvScale` take,
 * and what a flipbook frame shows.
 *
 * Y is flipped: a sheet is addressed from its TOP-left because that is where an
 * image's first pixel is, and UV space runs from the bottom. Cell 0 of a sheet is
 * therefore the HIGHEST v, which is the one thing about this that surprises
 * people reading a uvOffset in an inspector.
 */
export function sheetCellUv(
    grid: SheetGrid,
    cell: number,
): { uvOffset: { x: number; y: number }; uvScale: { x: number; y: number } } {
    const rect = sheetCellRect(grid, cell);
    return {
        uvOffset: {
            x: rect.x / grid.pageWidth,
            y: 1.0 - (rect.y + rect.height) / grid.pageHeight,
        },
        uvScale: {
            x: rect.width / grid.pageWidth,
            y: rect.height / grid.pageHeight,
        },
    };
}
