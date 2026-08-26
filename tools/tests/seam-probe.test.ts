// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The seam probe has to tell a seam from a texture, so both are fed to it.
 *        A measurement that only ever saw clean frames would report a small
 *        number and prove nothing — the same failure the colour-count gate had
 *        when it passed text-less, upside-down frames.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a tools .mjs helper, deliberately untyped
import { seamRatio, checkSeam, columnSteps } from '../lib/seamProbe.mjs';

const W = 240, H = 80, PERIOD = 24;

/** A detailed wall: noise that repeats every tile, so a clean render has no grid line. */
function wall(seam: number): Uint8Array {
    const px = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const local = x % PERIOD;
            // Detail that is CONTINUOUS across a tile boundary, because that is what
            // seamless art is. A pattern keyed on the position within a tile would
            // step at every boundary on its own and the probe would be right to say so.
            let v = 128 + 60 * Math.sin(x * 0.35) + 30 * Math.sin(y * 0.9 + x * 0.2);
            // The seam: the first column of each tile pushed off its neighbour, the
            // way a clamped outer half-texel reads.
            if (local === 0) v += seam;
            const i = (y * W + x) * 4;
            px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
            px[i + 3] = 255;
        }
    }
    return px;
}

const BAND = { y0: 8, y1: H - 8 };

describe('seamRatio', () => {
    it('a clean wall is near 1 — a boundary column looks like any other', () => {
        expect(seamRatio(wall(0), W, H, BAND, PERIOD, 0)).toBeLessThan(2);
    });

    it('...and a seamed one is not, which is what makes the number mean something', () => {
        // The same wall, the same measurement, one column pushed off. Without this
        // pair the assertion above would pass on a probe that returned a constant.
        expect(seamRatio(wall(40), W, H, BAND, PERIOD, 0)).toBeGreaterThan(3);
    });

    it('grows with the seam rather than latching', () => {
        const weak = seamRatio(wall(12), W, H, BAND, PERIOD, 0);
        const strong = seamRatio(wall(48), W, H, BAND, PERIOD, 0);
        expect(strong).toBeGreaterThan(weak);
        expect(weak).toBeGreaterThan(seamRatio(wall(0), W, H, BAND, PERIOD, 0));
    });

    it('a seam off the declared grid does not count — the gate looks where it was told', () => {
        // Phase shifted by half a tile: the real seam now sits in the interior, so
        // it becomes the floor rather than the spike. A probe that scored it anyway
        // would be finding seams that are not on the tile grid.
        const onGrid = seamRatio(wall(40), W, H, BAND, PERIOD, 0);
        const offGrid = seamRatio(wall(40), W, H, BAND, PERIOD, PERIOD / 2);
        expect(offGrid).toBeLessThan(onGrid);
    });

    it('is not fooled by a flat frame', () => {
        // No detail, no floor. Reporting a ratio against ~0 would read as a
        // catastrophic seam on a frame that has nothing in it at all.
        const flat = new Uint8Array(W * H * 4).fill(255);
        expect(Number.isFinite(seamRatio(flat, W, H, BAND, PERIOD, 0))).toBe(true);
    });

    it('refuses a period that is not a grid, and a band with no rows', () => {
        expect(() => seamRatio(wall(0), W, H, BAND, 0, 0)).toThrow(/not a grid/);
        expect(() => seamRatio(wall(0), W, H, { y0: 5, y1: 5 }, PERIOD, 0)).toThrow(/two rows/);
    });
});

describe('checkSeam', () => {
    it('reports the number with the verdict, so a red gate says how bad', () => {
        const bad = checkSeam(wall(40), W, H, { band: BAND, period: PERIOD, limit: 2 });
        expect(bad.ok).toBe(false);
        expect(bad.ratio).toBeGreaterThan(bad.limit);

        const good = checkSeam(wall(0), W, H, { band: BAND, period: PERIOD, limit: 2 });
        expect(good.ok).toBe(true);
    });
});

describe('columnSteps', () => {
    it('measures down the band it was given, not the whole frame', () => {
        // A band that misses the content would report a floor of zero and make
        // every boundary look catastrophic — the gate has to be aimed.
        const px = wall(40);
        const narrow = columnSteps(px, W, H, { y0: 20, y1: 24 });
        const wide = columnSteps(px, W, H, BAND);
        expect(narrow.length).toBe(wide.length);
        expect(narrow[PERIOD]).toBeGreaterThan(0);
    });
});
