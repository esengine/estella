// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/atlas-packer.ts
 * @brief   Rectangle packer for the runtime dynamic glyph atlas.
 *
 * Glyphs are packed into a fixed-size atlas page incrementally as they are first
 * seen. The packer is an interface so the heuristic is swappable; the default
 * ShelfPacker (row-based) is near-optimal here because glyphs of one font-size
 * share a height (especially CJK, whose em boxes are uniform), and it inserts in
 * O(rows) with no fragmentation bookkeeping.
 */

export interface PackPos {
    x: number;
    y: number;
}

export interface Packer {
    /** Page dimensions in texels. */
    readonly width: number;
    readonly height: number;
    /** Reserve a `w`×`h` cell; returns its top-left, or null if the page is full. */
    pack(w: number, h: number): PackPos | null;
    /** Drop all reservations (e.g. when rebuilding a page). */
    reset(): void;
}

/**
 * Row ("shelf") packer: fills the current row left→right, opening a new row once
 * a glyph doesn't fit horizontally. Row height grows to the tallest glyph placed
 * in it. Returns null when a glyph fits in neither the current nor a new row.
 */
export class ShelfPacker implements Packer {
    readonly width: number;
    readonly height: number;
    private shelfX = 0;
    private shelfY = 0;
    private shelfH = 0;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    pack(w: number, h: number): PackPos | null {
        if (w <= 0 || h <= 0 || w > this.width || h > this.height) return null;

        // Wrap to a new shelf if the glyph overflows the current row width.
        if (this.shelfX + w > this.width) {
            this.shelfY += this.shelfH;
            this.shelfX = 0;
            this.shelfH = 0;
        }

        // Out of vertical space on this page.
        if (this.shelfY + h > this.height) return null;

        const pos: PackPos = { x: this.shelfX, y: this.shelfY };
        this.shelfX += w;
        if (h > this.shelfH) this.shelfH = h;
        return pos;
    }

    reset(): void {
        this.shelfX = 0;
        this.shelfY = 0;
        this.shelfH = 0;
    }
}
