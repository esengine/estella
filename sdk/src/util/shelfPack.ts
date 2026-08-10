// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    util/shelfPack.ts
 * @brief   Rectangle packing into a fixed page — the one implementation.
 *
 * There were two, and they disagreed on the heuristic. The runtime glyph atlas
 * filled ONE shelf and opened a new one when a glyph overflowed it, abandoning
 * whatever was left of the old row; the asset cook kept every shelf and placed
 * into the first that fit. Same idea, different quality, and the better one was
 * the one no font ever used.
 *
 * Pure geometry (no pixels, no assets), so it belongs to the foundation and both
 * callers can have it: the cook composes pages from the placements, the glyph
 * atlas uploads into them.
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

/** A row opened at `y`, `height` tall, filled left→right to `x`. */
interface Shelf {
    y: number;
    height: number;
    x: number;
}

/**
 * Row ("shelf") packer with first-fit across every open row: a cell goes into
 * the first shelf tall enough with room left, and only opens a new row when none
 * has either. Rows keep the height of whatever opened them, so height-descending
 * input packs tightest — which is why the cook sorts before feeding it.
 */
export class ShelfPacker implements Packer {
    readonly width: number;
    readonly height: number;
    private shelves: Shelf[] = [];
    private yCursor = 0;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    pack(w: number, h: number): PackPos | null {
        if (w <= 0 || h <= 0 || w > this.width || h > this.height) return null;

        for (const shelf of this.shelves) {
            if (h <= shelf.height && shelf.x + w <= this.width) {
                const pos: PackPos = { x: shelf.x, y: shelf.y };
                shelf.x += w;
                return pos;
            }
        }
        if (this.yCursor + h > this.height) return null;
        const pos: PackPos = { x: 0, y: this.yCursor };
        this.shelves.push({ y: this.yCursor, height: h, x: w });
        this.yCursor += h;
        return pos;
    }

    reset(): void {
        this.shelves = [];
        this.yCursor = 0;
    }
}
