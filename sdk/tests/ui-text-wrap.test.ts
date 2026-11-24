// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.4c — word-wrap (parity step toward retiring Canvas2D Text,
 *        which has wordWrap). Greedy space-wrap + char-break for long words / CJK
 *        (no spaces). Pure → headless-tested.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { wrapLine, wrapByMeasure, wrapRichRuns, measureWidth, layoutText } from '../src/ui/text/layout';
import { TextOverflow } from '../src/ui/core/text';
import type { TextSegment } from '../src/ui/text/rich-text-parser';

function makeAtlas(): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        spread: 6,
        rasterize: (cp: number): RasterGlyph =>
            cp === 32
                ? { pixels: new Uint8Array(0), width: 0, height: 0, advance: 6, bearingX: 0, bearingY: 0 }
                : { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 },
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

// At fontSize 24 / renderSize 48 → scale 0.5: letter advance 5.5, space advance 3.
const F = 24;

describe('REARCH_GUI P1.4c: word-wrap', () => {
    it('measureWidth sums scaled advances', () => {
        expect(measureWidth('AA', makeAtlas(), 'Arial', F, 0)).toBeCloseTo(11);   // 2 × 5.5
        expect(measureWidth('AA AA', makeAtlas(), 'Arial', F, 0)).toBeCloseTo(25); // 11 + 3 + 11
    });

    it('wraps at spaces when a word would overflow', () => {
        expect(wrapLine('AA AA AA', makeAtlas(), 'Arial', F, 0, 12)).toEqual(['AA', 'AA', 'AA']);
    });

    it('keeps words on one line when they fit', () => {
        expect(wrapLine('AA AA', makeAtlas(), 'Arial', F, 0, 30)).toEqual(['AA AA']);
    });

    it('char-breaks a single token wider than the line (long word / CJK)', () => {
        expect(wrapLine('AAAA', makeAtlas(), 'Arial', F, 0, 12)).toEqual(['AA', 'AA']);
        expect(wrapLine('文文文文', makeAtlas(), 'Arial', F, 0, 12)).toEqual(['文文', '文文']);
    });

    it('layoutText applies maxWidth, producing stacked wrapped lines', () => {
        const layout = layoutText('AA AA AA', makeAtlas(), 'Arial', { fontSizePx: F, maxWidth: 12 });
        expect(layout.glyphs.length).toBe(6);     // 3 lines × "AA"
        expect(layout.width).toBeCloseTo(11);     // widest wrapped line
        // glyphs of line 3 sit below line 1
        expect(layout.glyphs[5].y0).toBeLessThan(layout.glyphs[0].y0);
    });

    const seg = (text: string, over: Partial<TextSegment> = {}): TextSegment => ({
        type: 'text', text, bold: false, italic: false, color: null, fontSize: null, ...over,
    });

    it('wrapRichRuns breaks styled runs at spaces, preserving each token\'s run style', () => {
        // "AA <b>AA AA</b>" at width 12 → three lines, the bold style survives the break.
        const lines = wrapRichRuns(
            [seg('AA '), seg('AA AA', { bold: true })],
            makeAtlas(), 'Arial', F, 0, 12);
        expect(lines.map((l) => l.map((r) => `${r.bold ? 'b' : 'n'}:${r.text}`))).toEqual([
            ['n:AA'], ['b:AA'], ['b:AA'],
        ]);
    });

    it('wrapRichRuns keeps a fitting styled line intact and merges same-style tokens', () => {
        const lines = wrapRichRuns([seg('AA AA')], makeAtlas(), 'Arial', F, 0, 30);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toHaveLength(1);         // tokens merged back into one segment
        expect(lines[0]![0]!.text).toBe('AA AA');
    });

    it('wrapRichRuns measures a token with its own fontSize', () => {
        // A double-size run: each glyph advances 11 (scale 1) instead of 5.5,
        // so "AA" (22) overflows width 12 and char-breaks.
        const lines = wrapRichRuns([seg('AA', { fontSize: 48 })], makeAtlas(), 'Arial', F, 0, 12);
        expect(lines.map((l) => l.map((r) => r.text))).toEqual([['A'], ['A']]);
    });

    it('wraps a scaled image with its neighbouring glyphs and aligns each resulting line', () => {
        const image = '<img src="icon.png" width=4 height=6 scale=2 />';
        const out = layoutText('AA ' + image + '<b>A</b>', makeAtlas(), 'Arial',
            { fontSizePx: F, lineHeight: 30, maxWidth: 16, boxWidth: 20, align: 1, rich: true });
        expect(out.lines).toEqual([{ x: 4.5, width: 11, baseline: -0 }, { x: 3.25, width: 13.5, baseline: -30 }]);
        expect(out.images).toMatchObject([{ src: 'icon.png', x: 3.25, y: -30, w: 8, h: 12 }]);
    });

    it('keeps an oversized image whole and omits it when its line is clipped', () => {
        const text = 'A<img src="wide.png" width=40 height=12 />B';
        const opts = { fontSizePx: F, maxWidth: 12, lineHeight: 30, rich: true };
        const all = layoutText(text, makeAtlas(), 'Arial', opts);
        expect(all.lines?.map(l => l.width)).toEqual([5.5, 40, 5.5]);
        expect(all.images).toMatchObject([{ src: 'wide.png', y: -30, w: 40 }]);
        expect(layoutText(text, makeAtlas(), 'Arial', { ...opts, boxHeight: 30, overflow: TextOverflow.Clip }).images).toEqual([]);
    });

    it('layoutText wraps rich markup end-to-end', () => {
        const layout = layoutText('AA <b>AA</b> AA', makeAtlas(), 'Arial',
            { fontSizePx: F, maxWidth: 12, rich: true });
        expect(layout.glyphs.length).toBe(6);     // 3 lines × "AA"
        expect(layout.glyphs[5].y0).toBeLessThan(layout.glyphs[0].y0);
    });
});


it.each(['A'.repeat(4000), 'word '.repeat(800)])('wraps long lines with linear glyph queries', text => {
    const atlas = makeAtlas();const get = atlas.getGlyph.bind(atlas);let calls = 0;
    atlas.getGlyph = (...args) => { calls++; return get(...args); };
    const lines = wrapLine(text, atlas, 'Arial', F, 0, 11000);
    expect(lines.join('').length).toBeGreaterThan(0);
    expect(calls).toBeLessThan(text.length * 5);
});

it.each([-5, 0, 1 / 3])('preserves arbitrary-measure wrap decisions at exact boundaries (spacing=%s)', spacing => {
    const atlas = makeAtlas();
    for (const text of [' A😀 测试  B\tC ', '文'.repeat(45), 'word '.repeat(40), 'A\u2003B\u00a0😀 C']) {
        const measure = (s: string) => measureWidth(s, atlas, 'Arial', F, 0, spacing);
        for (const width of [1, 5.5, 25, measure('A😀 测试'), 111.1]) {
            expect(wrapLine(text, atlas, 'Arial', F, 0, width, spacing))
                .toEqual(wrapByMeasure(text, measure, width));
        }
    }
});
