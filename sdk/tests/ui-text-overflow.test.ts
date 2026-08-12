// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui-text-overflow.test.ts — what Clip and Ellipsis promise.
 *
 * Two of these decide whether a reader can tell "this line was long" from "there
 * is more below": the mark goes on the last kept line whenever lines were
 * dropped, and a box too short for one line still shows one.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import {
    layoutText, measureWidth,
    TEXT_OVERFLOW_VISIBLE, TEXT_OVERFLOW_CLIP, TEXT_OVERFLOW_ELLIPSIS,
} from '../src/ui/text/layout';

function makeAtlas(): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        spread: 6,
        rasterize: (cp: number): RasterGlyph => {
            // A real font does not advance an ellipsis like a letter, and a fake
            // that does makes the two modes indistinguishable by width — which is
            // the only thing a layout hands back.
            if (cp === 32) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 6, bearingX: 0, bearingY: 0 };
            const advance = cp === 0x2026 ? 18 : 11;
            return { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance, bearingX: 1, bearingY: 10 };
        },
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

// scale 0.5 at this size: every letter advances 5.5px, a space 3px.
const F = 24;
const LINE = F * 1.2;
const atlas = makeAtlas();
const width = (s: string) => measureWidth(s, atlas, 'Arial', F, 0);

/** Lines a layout produced, read back off the glyphs' rows. */
function linesOf(layout: { glyphs: { y0: number }[] }): number {
    return new Set(layout.glyphs.map((g) => Math.round(g.y0))).size;
}

const lay = (text: string, opts: Record<string, unknown>) =>
    layoutText(text, atlas, 'Arial', { fontSizePx: F, lineHeight: LINE, ...opts } as never);

describe('TextOverflow', () => {
    it('Visible keeps every line, however short the box', () => {
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TEXT_OVERFLOW_VISIBLE });
        expect(linesOf(l)).toBe(3);
    });

    it('an unspecified overflow behaves as Visible', () => {
        const l = lay('one\ntwo\nthree', { boxHeight: LINE });
        expect(linesOf(l)).toBe(3);
    });

    it('Clip keeps only the lines the box has room for', () => {
        expect(linesOf(lay('one\ntwo\nthree', { boxHeight: LINE * 2, overflow: TEXT_OVERFLOW_CLIP }))).toBe(2);
        expect(linesOf(lay('one\ntwo\nthree', { boxHeight: LINE * 3, overflow: TEXT_OVERFLOW_CLIP }))).toBe(3);
    });

    it('a box too short for one line still shows one', () => {
        // Nothing is not an answer a reader can act on, and it is what a rounding
        // error in the box height would otherwise produce.
        expect(linesOf(lay('one\ntwo', { boxHeight: 1, overflow: TEXT_OVERFLOW_CLIP }))).toBe(1);
    });

    it('no box height means nothing can overflow one', () => {
        expect(linesOf(lay('one\ntwo\nthree', { overflow: TEXT_OVERFLOW_CLIP }))).toBe(3);
    });

    it('Ellipsis says there is more below, even when the last line fits', () => {
        // The mark is about the DROPPED lines, not about this line being long —
        // which is the distinction a reader needs and a width check cannot make.
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TEXT_OVERFLOW_ELLIPSIS, boxWidth: 400 });
        expect(linesOf(l)).toBe(1);
        expect(l.width).toBeCloseTo(width('one…'), 5);
    });

    it('Clip drops the lines and adds no mark', () => {
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TEXT_OVERFLOW_CLIP, boxWidth: 400 });
        expect(l.width).toBeCloseTo(width('one'), 5);
    });

    it('a single line too wide for the box is trimmed to fit, ellipsis included', () => {
        const limit = width('abcde');
        const l = lay('abcdefghij', { boxWidth: limit, overflow: TEXT_OVERFLOW_ELLIPSIS });
        expect(l.width).toBeLessThanOrEqual(limit + 1e-6);
        // Trimmed one glyph at a time, so the result is the widest that FITS —
        // a proportional guess would leave visible slack or overshoot.
        expect(l.width).toBeGreaterThan(limit - width('a') - width('…'));
    });

    it('Clip trims the same line without a mark, and keeps more of it', () => {
        const limit = width('abcde');
        const clipped = lay('abcdefghij', { boxWidth: limit, overflow: TEXT_OVERFLOW_CLIP });
        const ellipsed = lay('abcdefghij', { boxWidth: limit, overflow: TEXT_OVERFLOW_ELLIPSIS });
        expect(clipped.width).toBeLessThanOrEqual(limit + 1e-6);
        expect(clipped.width).toBeGreaterThan(ellipsed.width);
    });

    it('a line that fits is left exactly alone', () => {
        const l = lay('abc', { boxWidth: width('abcdefgh'), overflow: TEXT_OVERFLOW_ELLIPSIS });
        expect(l.width).toBeCloseTo(width('abc'), 5);
    });

    it('wrapping still happens first, and the box then decides how many survive', () => {
        // maxWidth wraps 'aa aa aa' into three lines; a two-line box keeps two.
        const l = lay('aa aa aa', {
            maxWidth: width('aa') + 1, boxHeight: LINE * 2, overflow: TEXT_OVERFLOW_CLIP,
        });
        expect(linesOf(l)).toBe(2);
    });

    it('rich text truncates by line, since a run carries its own size', () => {
        const l = lay('one\n<b>two</b>\nthree', {
            rich: true, boxHeight: LINE * 2, overflow: TEXT_OVERFLOW_CLIP,
        });
        expect(linesOf(l)).toBe(2);
    });
});
