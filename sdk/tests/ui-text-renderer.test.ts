// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.3b — drawTextWith orchestration: lays text out against a
 *        (mock-backed) GlyphAtlas and emits one quad batch per atlas page. Pure
 *        given the atlas, so the per-page grouping + geometry are headless-tested.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { drawTextWith, signatureOf, tapAlpha } from '../src/ui/text/text-renderer';
import type { DrawTextParams } from '../src/ui/text/text-renderer';

function makeAtlas(pageSize: number): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        rasterize: (cp: number): RasterGlyph | null => {
            if (cp === 32) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 12, bearingX: 0, bearingY: 0 };
            return { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 };
        },
    };
    let next = 1000;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize, padding: 1 });
}

describe('REARCH_GUI P1.3b: drawTextWith', () => {
    it('emits one batch covering all glyphs when they fit on a single page', () => {
        const atlas = makeAtlas(1024);
        const sink = vi.fn();
        drawTextWith(atlas, sink, { text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1] });
        expect(sink).toHaveBeenCalledTimes(1);
        const [vertices, indices, pageId] = sink.mock.calls[0];
        expect(vertices.length).toBe(2 * 4 * 8);
        expect(indices.length).toBe(2 * 6);
        expect(pageId).toBe(1000);
    });

    it('groups into one batch per atlas page when glyphs span pages', () => {
        // pageSize 32 ⇒ ~4 glyphs/page; 6 distinct glyphs ⇒ 2 pages.
        const atlas = makeAtlas(32);
        const sink = vi.fn();
        drawTextWith(atlas, sink, { text: 'ABCDEF', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1] });
        expect(atlas.pageCount).toBe(2);
        expect(sink).toHaveBeenCalledTimes(2);
        const pages = sink.mock.calls.map(c => c[2]);
        expect(new Set(pages).size).toBe(2);                       // distinct pages
        const totalVerts = sink.mock.calls.reduce((s, c) => s + c[0].length, 0);
        expect(totalVerts).toBe(6 * 4 * 8);                        // all 6 glyphs emitted
    });

    it('emits shadow + outline passes behind the fill (REARCH_GUI F8)', () => {
        const atlas = makeAtlas(1024);
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1],
            shadow: { color: [0, 0, 0, 1], dx: 2, dy: 2 },
            outline: { color: [0, 0, 0, 1], width: 1 },
        });
        // 1 shadow + 8 outline directions + 1 fill = 10 single-page batches.
        expect(sink).toHaveBeenCalledTimes(10);
        // Shadow (first pass) is offset on x by dx; fill (last pass) is not.
        const shadowX = sink.mock.calls[0][0][0];
        const fillX = sink.mock.calls[9][0][0];
        expect(shadowX - fillX).toBeCloseTo(2, 5);
    });

    it('spreads a blurred shadow into a ring, still behind the fill', () => {
        const atlas = makeAtlas(1024);
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1],
            shadow: { color: [0, 0, 0, 0.5], dx: 0, dy: 4, blur: 3 },
        });
        // 9 shadow taps + 1 fill.
        expect(sink).toHaveBeenCalledTimes(10);
        // Every tap sits within the blur radius of the offset, and none of them
        // is the full-strength colour — that is what stops a blurred shadow from
        // reading as several stamps of the text.
        const fillX = sink.mock.calls[9][0][0];
        for (let i = 0; i < 9; i++) {
            const verts = sink.mock.calls[i][0];
            expect(Math.abs(verts[0] - fillX)).toBeLessThanOrEqual(3.0001);
            expect(verts[7]).toBeLessThan(0.5); // per-tap alpha
        }
    });

    it('composites the ring back to the requested shadow alpha', () => {
        // Nine layers of a/9 would land at 1-(1-a/9)^9, well under a.
        expect(1 - Math.pow(1 - tapAlpha(0.5, 9), 9)).toBeCloseTo(0.5, 6);
        expect(1 - Math.pow(1 - tapAlpha(0.37, 9), 9)).toBeCloseTo(0.37, 6);
        expect(tapAlpha(0.5, 1)).toBe(0.5);
    });

    it('a blur with no offset is a halo, not a skipped shadow', () => {
        const atlas = makeAtlas(1024);
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1],
            shadow: { color: [0, 0, 0, 1], dx: 0, dy: 0, blur: 2 },
        });
        expect(sink).toHaveBeenCalledTimes(10);
    });

    it('skips shadow/outline passes when transparent or zero-width', () => {
        const atlas = makeAtlas(1024);
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1],
            shadow: { color: [0, 0, 0, 0], dx: 2, dy: 2 }, // transparent → skip
            outline: { color: [0, 0, 0, 1], width: 0 },    // zero width → skip
        });
        expect(sink).toHaveBeenCalledTimes(1); // fill only
    });

    it('emits nothing for empty / whitespace-only text', () => {
        const atlas = makeAtlas(1024);
        const sink = vi.fn();
        drawTextWith(atlas, sink, { text: '', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1] });
        drawTextWith(atlas, sink, { text: '   ', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1] });
        expect(sink).not.toHaveBeenCalled();
    });

    // The first vertex x/y of the fill (last) pass — the block's anchor moves it.
    const drawFirst = (extra: Record<string, unknown>): { x: number; y: number } => {
        const sink = vi.fn();
        drawTextWith(makeAtlas(1024), sink, { text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1], ...extra });
        const verts = sink.mock.calls.at(-1)![0] as Float32Array;
        return { x: verts[0], y: verts[1] };
    };

    it('a boxless label anchors the block to the origin by horizontal align (no UINode box)', () => {
        // No boxWidth ⇒ world-space label: align shifts the whole block, not silently a no-op.
        const left = drawFirst({ align: 0 }).x;
        const center = drawFirst({ align: 1 }).x;
        const right = drawFirst({ align: 2 }).x;
        expect(center).toBeLessThan(left); // centered → block moved left of the origin
        expect(right).toBeLessThan(center); // right edge on the origin → moved further left
    });

    it('a boxless label anchors the block to the origin by vertical align', () => {
        const top = drawFirst({ verticalAlign: 0 }).y;
        const middle = drawFirst({ verticalAlign: 1 }).y;
        const bottom = drawFirst({ verticalAlign: 2 }).y;
        expect(middle).toBeGreaterThan(top); // y-up: middle raises the block toward the origin
        expect(bottom).toBeGreaterThan(middle);
    });

    it('centres on the em box, not on the baseline, so leading does not push text up', () => {
        // A lineHeight above 1em adds space around the line; half belongs above the
        // first baseline. Charge it all below and every centred label rides
        // (lineHeight - 1em)/2 too high — 0.1em at the 1.2 default, which is what a
        // 60px label showed as a visible 6px.
        const box = { boxHeight: 200, verticalAlign: 1, fontSizePx: 24 };
        const tight = drawFirst({ ...box, lineHeight: 24 }).y;   // 1.0em: no leading to split
        const loose = drawFirst({ ...box, lineHeight: 24 * 1.2 }).y;
        expect(loose).toBeCloseTo(tight, 5); // y-up: extra leading must not raise the block
    });

    it('horizontal align works inside a fixed box even with word-wrap off (boxWidth, no maxWidth)', () => {
        // boxWidth aligns within the box independently of maxWidth (wrap). The block was
        // previously left-anchored whenever wrap was off — align silently did nothing.
        const leftInBox = drawFirst({ align: 0, boxWidth: 400 }).x;
        const rightInBox = drawFirst({ align: 2, boxWidth: 400 }).x;
        expect(rightInBox).toBeGreaterThan(leftInBox + 100); // pushed toward the box's right edge
    });
});

describe('text cache signature completeness', () => {
    const base: DrawTextParams = {
        text: 'AB', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1],
    };

    it('is stable for identical params (so a static label stays a cache hit)', () => {
        expect(signatureOf({ ...base })).toBe(signatureOf({ ...base }));
    });

    // Every field that changes the laid-out, colored geometry MUST change the
    // signature — otherwise a mutated label would reuse stale cached quads.
    it.each<[string, Partial<DrawTextParams>]>([
        ['text', { text: 'AC' }],
        ['fontFamily', { fontFamily: 'Times' }],
        ['fontSizePx', { fontSizePx: 25 }],
        ['style', { style: 1 }],
        ['richText', { richText: true }],
        ['align', { align: 2 }],
        ['verticalAlign', { verticalAlign: 1 }],
        ['lineHeight', { lineHeight: 30 }],
        ['letterSpacing', { letterSpacing: 2 }],
        ['maxWidth', { maxWidth: 200 }],
        ['boxWidth', { boxWidth: 400 }],
        ['boxHeight', { boxHeight: 100 }],
        ['originX', { originX: 5 }],
        ['originY', { originY: 5 }],
        ['color', { color: [1, 0, 0, 1] }],
        ['shadow', { shadow: { color: [0, 0, 0, 1], dx: 2, dy: 2 } }],
        // The blur changes the geometry (a ring instead of one copy), so a label
        // whose blur alone changed must not keep the cached quads.
        ['shadow blur', { shadow: { color: [0, 0, 0, 1], dx: 2, dy: 2, blur: 3 } }],
        ['outline', { outline: { color: [0, 0, 0, 1], width: 1 } }],
    ])('changes when %s changes', (_field, override) => {
        expect(signatureOf({ ...base, ...override })).not.toBe(signatureOf(base));
    });
});
