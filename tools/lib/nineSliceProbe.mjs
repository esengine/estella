// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Compare complete corner blocks of bottom-up GPU readbacks, in screen pixels.
 * Reject empty/uniform references so a blank frame cannot pass by equality. */
export function checkNineSliceCorners(rgba, width, height, rects, border = 8) {
    if (!Number.isInteger(border) || border <= 0 || !Number.isInteger(width) || !Number.isInteger(height)
        || width <= 0 || height <= 0 || rgba.length !== width * height * 4 || rects.length < 2) {
        return { ok: false, error: 'Invalid readback or comparison' };
    }
    const blocks = [];
    for (const [left, top, w, h] of rects) {
        if (![left, top, w, h].every(Number.isInteger) || left < 0 || top < 0 || w < border * 2 || h < border * 2
            || left + w > width || top + h > height) return { ok: false, error: 'Invalid rectangle' };
        const pixels = [];
        for (const [x, y] of [[left, top], [left + w - border, top], [left, top + h - border], [left + w - border, top + h - border]]) {
            for (let j = 0; j < border; j++) for (let i = 0; i < border; i++) {
                const k = ((height - 1 - y - j) * width + x + i) * 4;
                pixels.push(...rgba.slice(k, k + 4));
            }
        }
        blocks.push(pixels);
    }
    const varied = new Set(blocks[0]).size > 12;
    const mismatches = blocks.slice(1).map(block => block.reduce((n, v, i) => n + (v !== blocks[0][i] ? 1 : 0), 0));
    return { ok: varied && mismatches.every(n => n === 0), varied, mismatches, comparedPixels: (blocks.length - 1) * 4 * border * border };
}
