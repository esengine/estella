// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Preloading glyphs: the walk spends a frame's budget and no more, and a
 *        preloaded glyph survives the page release that runs every frame, which
 *        drops any page no text is showing.
 */
import { describe, it, expect, vi } from 'vitest';
import { GlyphPreloadJob, preloadCodepoints } from '../src/ui/text/glyph-preload';
import { GlyphAtlas, type AtlasPageStore, type GlyphRasterizer, type RasterGlyph } from '../src/ui/text/glyph-atlas';

describe('preloadCodepoints', () => {
    it('keeps each character once and leaves out line breaks', () => {
        expect(preloadCodepoints('下下载\n载 A\t')).toEqual([0x4e0b, 0x8f7d, 0x20, 0x41]);
    });
    it('reads a character past the BMP as one', () => {
        expect(preloadCodepoints('𠀋')).toEqual([0x2000b]);
    });
});

describe('GlyphPreloadJob', () => {
    const job = (cps: number[], budget = 4) => new GlyphPreloadJob(cps, budget, () => {});

    it('stops for the frame when the budget is spent, and goes on the next', () => {
        let clock = 0;
        const made: number[] = [];
        const j = job([1, 2, 3, 4, 5], 4);
        const make = (cp: number) => { made.push(cp); clock += 2; };
        j.step(make, () => clock);
        expect(made).toEqual([1, 2]);
        expect(j.progress).toBeCloseTo(0.4);
        j.step(make, () => clock);
        expect(made).toEqual([1, 2, 3, 4]);
        expect(j.finished).toBe(false);
    });

    it('makes one a frame even when one costs more than the budget', () => {
        let clock = 0;
        const made: number[] = [];
        const j = job([1, 2], 4);
        const make = (cp: number) => { made.push(cp); clock += 100; };
        j.step(make, () => clock);
        expect(made).toEqual([1]);
        j.step(make, () => clock);
        expect(made).toEqual([1, 2]);
        expect(j.finished).toBe(true);
    });

    it('resolves done when the last character is made', async () => {
        const j = job([1]);
        j.step(() => {}, () => 0);
        await expect(j.done).resolves.toBeUndefined();
        expect(j.progress).toBe(1);
    });

    it('is done at once with nothing to make', async () => {
        const j = job([]);
        expect(j.finished).toBe(true);
        expect(j.progress).toBe(1);
        await j.done;
    });

    it('released early: stops, resolves, lets go once it is asked to', async () => {
        const onRelease = vi.fn();
        const j = new GlyphPreloadJob([1, 2, 3], 4, onRelease);
        const make = vi.fn();
        j.release();
        await j.done;
        j.step(make, () => 0);
        expect(make).not.toHaveBeenCalled();
        expect(onRelease).toHaveBeenCalledTimes(1);
    });

    it('finishing does not let go: the glyphs stay until release', () => {
        const onRelease = vi.fn();
        const j = new GlyphPreloadJob([1], 4, onRelease);
        j.step(() => {}, () => 0);
        expect(j.finished).toBe(true);
        expect(onRelease).not.toHaveBeenCalled();
    });
});

describe('the page release a preload has to survive', () => {
    function atlas() {
        const rasterize = vi.fn((): RasterGlyph => ({
            pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10,
        }));
        const rasterizer = { renderSize: 48, spread: 6, rasterize } as unknown as GlyphRasterizer;
        let next = 100;
        const store = { createPage: () => next++, uploadSubRegion: () => {} } as unknown as AtlasPageStore;
        return { atlas: new GlyphAtlas(rasterizer, store, { pageSize: 256 }), rasterize };
    }

    it('a page nothing pins is released, and its glyph is made again', () => {
        const { atlas: a, rasterize } = atlas();
        a.getGlyph(0x4e0b, 'f');
        a.retainPages(new Set());
        a.getGlyph(0x4e0b, 'f');
        expect(rasterize).toHaveBeenCalledTimes(2);
    });

    it('a pinned page keeps its glyph, and showing it costs no raster', () => {
        const { atlas: a, rasterize } = atlas();
        const glyph = a.getGlyph(0x4e0b, 'f')!;
        a.retainPages(new Set([glyph.pageId]));
        a.getGlyph(0x4e0b, 'f');
        expect(rasterize).toHaveBeenCalledTimes(1);
    });
});
