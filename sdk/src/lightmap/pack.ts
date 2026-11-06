// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pack.ts
 * @brief   Charts into a square: by their outlines, or as rectangles along a skyline when there are too many to rasterise.
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

/** One chart for {@link packOutlines}: its triangles, in its own units with its lowest corner at the origin. */
export interface ChartOutline {
    /** Six numbers a triangle: x, y three times. */
    triangles: Float64Array | number[];
    width: number;
    height: number;
}

/** Where a chart's origin goes, in the unit square. */
export type PlacedOutline = PackedRect;

/** Marks every cell of a mask a triangle touches, by the span each of its edges covers in each row. */
function markTriangle(mask: Uint8Array, w: number, h: number, t: ArrayLike<number>, at: number, scale: number, offset: number): void {
    const xs = [t[at]! * scale + offset, t[at + 2]! * scale + offset, t[at + 4]! * scale + offset];
    const ys = [t[at + 1]! * scale + offset, t[at + 3]! * scale + offset, t[at + 5]! * scale + offset];
    const top = Math.max(0, Math.floor(Math.min(ys[0]!, ys[1]!, ys[2]!)));
    const bottom = Math.min(h - 1, Math.floor(Math.max(ys[0]!, ys[1]!, ys[2]!)));
    for (let row = top; row <= bottom; row++) {
        let lo = Infinity, hi = -Infinity;
        for (let e = 0; e < 3; e++) {
            const [ax, ay, bx, by] = [xs[e]!, ys[e]!, xs[(e + 1) % 3]!, ys[(e + 1) % 3]!];
            // The piece of this edge inside the row.
            const [y0, y1] = [Math.max(Math.min(ay, by), row), Math.min(Math.max(ay, by), row + 1)];
            if (y0 > y1) continue;
            const dy = by - ay;
            const x0 = dy === 0 ? ax : ax + ((y0 - ay) / dy) * (bx - ax);
            const x1 = dy === 0 ? bx : ax + ((y1 - ay) / dy) * (bx - ax);
            lo = Math.min(lo, x0, x1);
            hi = Math.max(hi, x0, x1);
        }
        if (lo > hi) continue;
        const [from, to] = [Math.max(0, Math.floor(lo)), Math.min(w - 1, Math.floor(hi))];
        mask.fill(1, row * w + from, row * w + to + 1);
    }
}

/** The filled cells of one chart at one scale, grown by @p pad cells, as offsets from its corner. */
function chartMask(chart: ChartOutline, scale: number, pad: number, rotated: boolean): { w: number; h: number; cells: Int32Array } {
    const [sw, sh] = rotated ? [chart.height, chart.width] : [chart.width, chart.height];
    const w = Math.ceil(sw * scale) + 1 + pad * 2, h = Math.ceil(sh * scale) + 1 + pad * 2;
    let mask = new Uint8Array(w * h);
    const t = chart.triangles;
    if (rotated) {
        const flipped = new Float64Array(6);
        for (let i = 0; i < t.length; i += 6) {
            for (let k = 0; k < 3; k++) { flipped[k * 2] = t[i + k * 2 + 1]!; flipped[k * 2 + 1] = t[i + k * 2]!; }
            markTriangle(mask, w, h, flipped, 0, scale, pad);
        }
    } else {
        for (let i = 0; i < t.length; i += 6) markTriangle(mask, w, h, t, i, scale, pad);
    }
    // Grown along rows, then along columns: a square around every cell.
    if (pad > 0) {
        const across = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!mask[y * w + x]) continue;
                across.fill(1, y * w + Math.max(0, x - pad), y * w + Math.min(w, x + pad + 1));
            }
        }
        const down = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!across[y * w + x]) continue;
                for (let q = Math.max(0, y - pad); q <= Math.min(h - 1, y + pad); q++) down[q * w + x] = 1;
            }
        }
        mask = down;
    }
    let count = 0;
    for (let i = 0; i < w * h; i++) if (mask[i]) count++;
    const cells = new Int32Array(count * 2);
    let n = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x]) { cells[n++] = x; cells[n++] = y; }
        }
    }
    return { w, h, cells };
}

/**
 * Places charts by the cells they really cover, so a small one can sit in the bite of a large one, as a rectangle
 * around that large one could never let it. Null if they do not all fit at this scale.
 *
 * @param scale Chart units to one unit of the square. As in {@link packSkyline} it is one number for all of them.
 * @param grid  Cells along a side.
 * @param pad   Cells to keep clear around every chart.
 */
export function packOutlines(charts: readonly ChartOutline[], scale: number, grid: number, pad: number): PlacedOutline[] | null {
    const cellScale = scale * grid;
    const used = new Uint8Array(grid * grid);
    /** First cell of each row that may be free: rows only ever fill. */
    const rowStart = new Int32Array(grid);
    const areas = charts.map((c) => c.width * c.height);
    const order = charts.map((_, i) => i).sort((a, b) => areas[b]! - areas[a]!);
    const out: PlacedOutline[] = new Array(charts.length);

    const fits = (m: { cells: Int32Array }, x: number, y: number): boolean => {
        const { cells } = m;
        // A coarse pass first: a wrong place is nearly always found out by the first few cells it samples.
        const stride = cells.length > 512 ? 32 : 2;
        for (let i = 0; i < cells.length; i += stride) if (used[(y + cells[i + 1]!) * grid + x + cells[i]!]) return false;
        if (stride > 2) for (let i = 0; i < cells.length; i += 2) if (used[(y + cells[i + 1]!) * grid + x + cells[i]!]) return false;
        return true;
    };
    const firstPlace = (m: { w: number; h: number; cells: Int32Array }): { x: number; y: number } | null => {
        if (m.w > grid || m.h > grid || m.cells.length === 0) return m.cells.length === 0 ? { x: 0, y: 0 } : null;
        const [anchorX, anchorY] = [m.cells[0]!, m.cells[1]!];
        for (let y = 0; y + m.h <= grid; y++) {
            const row = y + anchorY;
            // No place in this row can start left of where its anchor could land.
            for (let x = Math.max(0, rowStart[row]! - anchorX); x + m.w <= grid; x++) {
                if (used[row * grid + x + anchorX]) continue;
                if (fits(m, x, y)) return { x, y };
            }
        }
        return null;
    };

    for (const i of order) {
        const chart = charts[i]!;
        const upright = chartMask(chart, cellScale, pad, false);
        const lying = chartMask(chart, cellScale, pad, true);
        const a = firstPlace(upright), b = firstPlace(lying);
        if (!a && !b) return null;
        const useLying = !a || (b !== null && (b.y + lying.h < a.y + upright.h || (b.y + lying.h === a.y + upright.h && b.x < a.x)));
        const [m, at] = useLying ? [lying, b!] : [upright, a!];
        for (let c = 0; c < m.cells.length; c += 2) used[(at.y + m.cells[c + 1]!) * grid + at.x + m.cells[c]!] = 1;
        for (let y = at.y; y < at.y + m.h; y++) {
            let start = rowStart[y]!;
            while (start < grid && used[y * grid + start]) start++;
            rowStart[y] = start;
        }
        // The mask starts `pad` cells out from the chart's own corner.
        out[i] = { x: (at.x + pad) / grid, y: (at.y + pad) / grid, rotated: useLying };
    }
    return out;
}
