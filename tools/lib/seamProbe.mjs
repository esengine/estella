// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  seamProbe.mjs — is there a line on the tile grid, measured rather than judged.
 *
 * A point probe (`ESTELLA_VERIFY_EXPECT`) says "this pixel is red". A seam is not
 * a pixel — it is a column that behaves differently from its neighbours, on a
 * grid, across a band of rows. So it needs its own measurement, and this is it.
 *
 * REFERENCE-FREE, which is what keeps it from going stale: it compares the
 * boundary columns against the frame's OWN interior columns rather than against
 * a stored image. Art changes, the ratio does not.
 */

/** Mean luminance of a column over `[y0, y1)`, from RGBA8 rows. */
function columnLuma(px, w, x, y0, y1) {
    let sum = 0;
    for (let y = y0; y < y1; y++) {
        const i = (y * w + x) * 4;
        sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
    }
    return sum / (y1 - y0);
}

/**
 * Per-column step: how much a column differs from the one before it, averaged
 * down the band. A seam is a spike in this; texture detail is a floor under it.
 */
export function columnSteps(px, w, h, band) {
    const y0 = Math.max(0, Math.floor(band?.y0 ?? 0));
    const y1 = Math.min(h, Math.ceil(band?.y1 ?? h));
    if (y1 - y0 < 2) throw new Error('seamProbe: the band needs at least two rows');
    const steps = new Float64Array(w);
    let prev = columnLuma(px, w, 0, y0, y1);
    for (let x = 1; x < w; x++) {
        const cur = columnLuma(px, w, x, y0, y1);
        steps[x] = Math.abs(cur - prev);
        prev = cur;
    }
    return steps;
}

/** Columns within `slack` of a grid line at `period`/`phase`, and the rest. */
function splitOnGrid(w, period, phase, slack) {
    const boundary = [];
    const interior = [];
    for (let x = 1; x < w; x++) {
        const off = Math.abs(((x - phase) % period + period) % period);
        const near = Math.min(off, period - off);
        (near <= slack ? boundary : interior).push(x);
    }
    return { boundary, interior };
}

function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How much more the tile boundaries step than the frame's own interior. A ratio,
 * because a detailed texture steps everywhere and a flat one nowhere.
 *
 * @param {Uint8Array|Uint8ClampedArray} px RGBA8, row 0 = top.
 * @param {{y0?: number, y1?: number}} band Rows to measure over — pick a band that
 *   is all content, since sky and UI have edges of their own.
 * @param {number} period Tile pitch in screen px; `phase` is the first boundary.
 * @param {number} [slack] How far from a grid line still counts as the boundary.
 *   One px each side by default: a seam is a column, not a region.
 */
export function seamRatio(px, w, h, band, period, phase, slack = 1) {
    if (!(period > 1)) throw new Error(`seamProbe: period ${period} is not a grid`);
    const steps = columnSteps(px, w, h, band);
    const { boundary, interior } = splitOnGrid(w, period, phase, slack);
    if (boundary.length === 0 || interior.length === 0) {
        throw new Error('seamProbe: the period leaves no interior to compare against');
    }
    // Max on the boundary, median inside: one visible line is the failure, and a
    // mean would let a single strong seam average away. So clean lands near 1.4
    // rather than 1 (synthetic wall: 1.4 clean, 2.2 quarter seam, 4.0 full).
    const worst = Math.max(...boundary.map((x) => steps[x]));
    const floor = median(interior.map((x) => steps[x]));
    // A frame with no detail at all has no floor to divide by; report the step
    // itself rather than an infinity that reads as a catastrophic seam.
    return floor > 1e-6 ? worst / floor : worst;
}

/**
 * Verdict for a gate: the ratio, and whether it clears `limit`.
 * Kept separate from {@link seamRatio} so a failure can report the number.
 */
export function checkSeam(px, w, h, { band, period, phase = 0, slack = 1, limit = 2 }) {
    const ratio = seamRatio(px, w, h, band, period, phase, slack);
    return { ratio, limit, ok: ratio <= limit };
}
