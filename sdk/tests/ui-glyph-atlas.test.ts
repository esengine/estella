/**
 * @file  REARCH_GUI P1.1c — GlyphAtlas orchestration. The Canvas2D rasterizer
 *        isn't headless-renderable, so the atlas takes injectable GlyphRasterizer
 *        + AtlasPageStore; here we drive it with mocks to verify cache, packing,
 *        multi-page overflow, whitespace, and unknown-glyph handling.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    GlyphAtlas,
    type GlyphRasterizer,
    type AtlasPageStore,
    type RasterGlyph,
} from '../src/ui/text/glyph-atlas';

const UNKNOWN = 0xffff;
const SPACE = 32;
const HUGE = 0xaaaa;

function makeRasterizer() {
    const rasterize = vi.fn((cp: number): RasterGlyph | null => {
        if (cp === UNKNOWN) return null;
        if (cp === SPACE) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 12, bearingX: 0, bearingY: 0 };
        if (cp === HUGE) return { pixels: new Uint8Array(100 * 100 * 4), width: 100, height: 100, advance: 100, bearingX: 0, bearingY: 0 };
        const w = 10, h = 12;
        return { pixels: new Uint8Array(w * h * 4).fill(200), width: w, height: h, advance: 11, bearingX: 1, bearingY: 10 };
    });
    return { renderSize: 48, rasterize } as GlyphRasterizer & { rasterize: typeof rasterize };
}

function makeStore() {
    let next = 100;
    const uploads: Array<{ pageId: number; x: number; y: number; w: number; h: number; len: number }> = [];
    const createPage = vi.fn((_size: number) => next++);
    const uploadSubRegion = vi.fn((pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array) => {
        uploads.push({ pageId, x, y, w, h, len: pixels.length });
    });
    return { createPage, uploadSubRegion, uploads } as AtlasPageStore & {
        createPage: typeof createPage; uploadSubRegion: typeof uploadSubRegion;
        uploads: typeof uploads;
    };
}

describe('REARCH_GUI P1.1c: GlyphAtlas', () => {
    it('rasterizes, packs and uploads on first use; returns UVs + metrics', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64, padding: 1 });

        const g = atlas.getGlyph(65, 'Arial');
        expect(g).not.toBeNull();
        expect(g!.pageId).toBe(100);
        expect(g!.width).toBe(10);
        expect(g!.height).toBe(12);
        expect(g!.advance).toBe(11);
        expect(g!.bearingY).toBe(10);
        expect(g!.u0).toBe(0);
        expect(g!.u1).toBeCloseTo(10 / 64);
        expect(g!.v1).toBeCloseTo(12 / 64);
        expect(s.createPage).toHaveBeenCalledTimes(1);
        expect(s.uploads).toEqual([{ pageId: 100, x: 0, y: 0, w: 10, h: 12, len: 480 }]);
    });

    it('caches: a second request neither rasterizes nor uploads again', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });

        const a = atlas.getGlyph(65, 'Arial');
        const b = atlas.getGlyph(65, 'Arial');
        expect(b).toBe(a);
        expect(r.rasterize).toHaveBeenCalledTimes(1);
        expect(s.uploadSubRegion).toHaveBeenCalledTimes(1);
    });

    it('keys by font + style so distinct fonts/styles get distinct cells', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        atlas.getGlyph(65, 'Arial', 0);
        atlas.getGlyph(65, 'Arial', 1);   // bold
        atlas.getGlyph(65, 'Times', 0);
        expect(r.rasterize).toHaveBeenCalledTimes(3);
    });

    it('whitespace gets an advance-only entry with no upload', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        atlas.getGlyph(65, 'Arial');            // allocate a page first
        s.uploadSubRegion.mockClear();
        const sp = atlas.getGlyph(SPACE, 'Arial');
        expect(sp).not.toBeNull();
        expect(sp!.width).toBe(0);
        expect(sp!.advance).toBe(12);
        expect(s.uploadSubRegion).not.toHaveBeenCalled();
    });

    it('caches unknown glyphs as null (rasterized once)', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        expect(atlas.getGlyph(UNKNOWN, 'Arial')).toBeNull();
        expect(atlas.getGlyph(UNKNOWN, 'Arial')).toBeNull();
        expect(r.rasterize).toHaveBeenCalledTimes(1);
    });

    it('opens a new page when the current one fills', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64, padding: 1 });
        // 64/11 = 5 per row, 64/13 = 4 rows ⇒ ~20 glyphs/page; 25 forces a 2nd page.
        for (let i = 0; i < 25; i++) atlas.getGlyph(0x100 + i, 'Arial');
        expect(atlas.pageCount).toBe(2);
        expect(s.createPage).toHaveBeenCalledTimes(2);
    });

    it('returns null for a glyph larger than a whole page', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        expect(atlas.getGlyph(HUGE, 'Arial')).toBeNull();
    });
});
