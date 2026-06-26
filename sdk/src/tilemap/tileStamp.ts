// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileStamp.ts
 * @brief   The painter's brush: a rectangular pattern of raw cells (a "stamp"), the
 *          unit that the palette selects, the brush paints, and autotile/eyedropper
 *          produce. Replaces the old single-tile-id brush so multi-tile selection,
 *          flip and rotate all flow through one model.
 *
 * Each cell is a raw `u16` (see {@link encodeTile}); 0 = empty (paints nothing — the
 * stamp is sparse, so an irregular eyedropper/selection leaves gaps untouched). Flip and
 * rotate transform both the cell grid and every non-empty cell's own orientation flags.
 */

import {
    encodeTile, tileIdOf, tileFlagsOf,
    flipFlagsH, flipFlagsV, rotateFlagsCW,
    type TileFlags,
} from './tileBits';

/** A w×h block of raw cells, row-major. `cells.length === w * h`. */
export interface TileStamp {
    w: number;
    h: number;
    cells: number[];
}

/** A 1×1 stamp of one raw cell. */
export function singleStamp(raw: number): TileStamp {
    return { w: 1, h: 1, cells: [raw] };
}

/** Whether the stamp paints nothing (all cells empty) — treated as a no-op brush. */
export function isEmptyStamp(s: TileStamp): boolean {
    return s.w <= 0 || s.h <= 0 || s.cells.every((c) => tileIdOf(c) === 0);
}

function mapCell(raw: number, op: (f: TileFlags) => TileFlags): number {
    const id = tileIdOf(raw);
    return id === 0 ? 0 : encodeTile(id, op(tileFlagsOf(raw)));
}

export function flipStampH(s: TileStamp): TileStamp {
    const cells = new Array<number>(s.cells.length);
    for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
            cells[y * s.w + (s.w - 1 - x)] = mapCell(s.cells[y * s.w + x], flipFlagsH);
        }
    }
    return { w: s.w, h: s.h, cells };
}

export function flipStampV(s: TileStamp): TileStamp {
    const cells = new Array<number>(s.cells.length);
    for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
            cells[(s.h - 1 - y) * s.w + x] = mapCell(s.cells[y * s.w + x], flipFlagsV);
        }
    }
    return { w: s.w, h: s.h, cells };
}

/** Rotate the stamp 90° clockwise (w×h → h×w). */
export function rotateStampCW(s: TileStamp): TileStamp {
    const nw = s.h;
    const nh = s.w;
    const cells = new Array<number>(s.cells.length);
    for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
            const nx = s.h - 1 - y;
            const ny = x;
            cells[ny * nw + nx] = mapCell(s.cells[y * s.w + x], rotateFlagsCW);
        }
    }
    return { w: nw, h: nh, cells };
}
