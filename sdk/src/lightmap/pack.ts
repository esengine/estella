// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pack.ts
 * @brief   Rectangles into a square, bottom-left along a skyline.
 *
 * The charts arrive already scaled, because a lightmap wants ONE world-to-texel
 * ratio across the whole atlas: a chart shrunk to make it fit would be lit at a
 * different resolution from the wall beside it, and the seam shows.
 */

export interface PackedRect {
    x: number;
    y: number;
    /** Whether the rectangle was placed with its width and height exchanged. */
    rotated: boolean;
}

interface Segment {
    x: number;
    y: number;
    width: number;
}

/** Height the skyline reaches over `[x, x+width)`, or -1 if that runs off the end. */
function supportHeight(line: Segment[], from: number, x: number, width: number,
                       extent: number): number {
    if (x + width > extent) return -1;
    let y = line[from].y;
    let left = width;
    for (let i = from; i < line.length && left > 0; i++) {
        y = Math.max(y, line[i].y);
        left -= line[i].width - (i === from ? x - line[i].x : 0);
    }
    return left > 0 ? -1 : y;
}

function place(line: Segment[], x: number, y: number, width: number, height: number): void {
    const top = y + height;
    const merged: Segment[] = [];
    for (const s of line) {
        if (s.x + s.width <= x || s.x >= x + width) { merged.push(s); continue; }
        if (s.x < x) merged.push({ x: s.x, y: s.y, width: x - s.x });
        if (s.x + s.width > x + width) {
            merged.push({ x: x + width, y: s.y, width: s.x + s.width - (x + width) });
        }
    }
    merged.push({ x, y: top, width });
    merged.sort((a, b) => a.x - b.x);
    line.length = 0;
    for (const s of merged) {
        const last = line[line.length - 1];
        if (last && last.y === s.y && last.x + last.width === s.x) last.width += s.width;
        else line.push(s);
    }
}

/**
 * Places every rectangle inside a square of side `extent`, or returns null.
 *
 * Null is the caller's signal to scale the whole set down and try again — which
 * is the only way to keep one ratio for all of them.
 */
export function packSkyline(sizes: ReadonlyArray<readonly [number, number]>,
                            extent: number): PackedRect[] | null {
    const order = sizes.map((_, i) => i)
        .sort((a, b) => Math.max(sizes[b][0], sizes[b][1]) - Math.max(sizes[a][0], sizes[a][1]));
    const line: Segment[] = [{ x: 0, y: 0, width: extent }];
    const out: PackedRect[] = new Array(sizes.length);

    for (const i of order) {
        const [w, h] = sizes[i];
        let best: { x: number; y: number; rotated: boolean } | null = null;
        for (let s = 0; s < line.length; s++) {
            // Both orientations: a tall chart laid on its side often drops into a
            // gap the upright one has to start a new row for.
            for (const [rw, rh, rotated] of [[w, h, false], [h, w, true]] as const) {
                const y = supportHeight(line, s, line[s].x, rw, extent);
                if (y < 0 || y + rh > extent) continue;
                if (!best || y < best.y || (y === best.y && line[s].x < best.x)) {
                    best = { x: line[s].x, y, rotated };
                }
            }
        }
        if (!best) return null;
        const [pw, ph] = best.rotated ? [h, w] : [w, h];
        place(line, best.x, best.y, pw, ph);
        out[i] = best;
    }
    return out;
}
