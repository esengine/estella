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
import { layoutText, measureWidth, shrinkFontSize } from '../src/ui/text/layout';
import { drawTextWith } from '../src/ui/text/text-renderer';
import { TextOverflow } from '../src/ui/core/text';

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
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TextOverflow.Visible });
        expect(linesOf(l)).toBe(3);
    });

    it('an unspecified overflow behaves as Visible', () => {
        const l = lay('one\ntwo\nthree', { boxHeight: LINE });
        expect(linesOf(l)).toBe(3);
    });

    it('Clip keeps only the lines the box has room for', () => {
        expect(linesOf(lay('one\ntwo\nthree', { boxHeight: LINE * 2, overflow: TextOverflow.Clip }))).toBe(2);
        expect(linesOf(lay('one\ntwo\nthree', { boxHeight: LINE * 3, overflow: TextOverflow.Clip }))).toBe(3);
    });

    it('a box too short for one line still shows one', () => {
        // Nothing is not an answer a reader can act on, and it is what a rounding
        // error in the box height would otherwise produce.
        expect(linesOf(lay('one\ntwo', { boxHeight: 1, overflow: TextOverflow.Clip }))).toBe(1);
    });

    it('no box height means nothing can overflow one', () => {
        expect(linesOf(lay('one\ntwo\nthree', { overflow: TextOverflow.Clip }))).toBe(3);
    });

    it('Ellipsis says there is more below, even when the last line fits', () => {
        // The mark is about the DROPPED lines, not about this line being long —
        // which is the distinction a reader needs and a width check cannot make.
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TextOverflow.Ellipsis, boxWidth: 400 });
        expect(linesOf(l)).toBe(1);
        expect(l.width).toBeCloseTo(width('one…'), 5);
    });

    it('Clip drops the lines and adds no mark', () => {
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TextOverflow.Clip, boxWidth: 400 });
        expect(l.width).toBeCloseTo(width('one'), 5);
    });

    it('a single line too wide for the box is trimmed to fit, ellipsis included', () => {
        const limit = width('abcde');
        const l = lay('abcdefghij', { boxWidth: limit, overflow: TextOverflow.Ellipsis });
        expect(l.width).toBeLessThanOrEqual(limit + 1e-6);
        // Trimmed one glyph at a time, so the result is the widest that FITS —
        // a proportional guess would leave visible slack or overshoot.
        expect(l.width).toBeGreaterThan(limit - width('a') - width('…'));
    });

    it('Clip trims the same line without a mark, and keeps more of it', () => {
        const limit = width('abcde');
        const clipped = lay('abcdefghij', { boxWidth: limit, overflow: TextOverflow.Clip });
        const ellipsed = lay('abcdefghij', { boxWidth: limit, overflow: TextOverflow.Ellipsis });
        expect(clipped.width).toBeLessThanOrEqual(limit + 1e-6);
        expect(clipped.width).toBeGreaterThan(ellipsed.width);
    });

    it('a line that fits is left exactly alone', () => {
        const l = lay('abc', { boxWidth: width('abcdefgh'), overflow: TextOverflow.Ellipsis });
        expect(l.width).toBeCloseTo(width('abc'), 5);
    });

    it('wrapping still happens first, and the box then decides how many survive', () => {
        // maxWidth wraps 'aa aa aa' into three lines; a two-line box keeps two.
        const l = lay('aa aa aa', {
            maxWidth: width('aa') + 1, boxHeight: LINE * 2, overflow: TextOverflow.Clip,
        });
        expect(linesOf(l)).toBe(2);
    });

    it('rich text truncates by line, since a run carries its own size', () => {
        const l = lay('one\n<b>two</b>\nthree', {
            rich: true, boxHeight: LINE * 2, overflow: TextOverflow.Clip,
        });
        expect(linesOf(l)).toBe(2);
    });
});


it.each([TextOverflow.Clip, TextOverflow.Ellipsis])('clips long text with linear glyph lookup work (mode=%s)', overflow => {
    const atlas = makeAtlas();
    const get = atlas.getGlyph.bind(atlas);
    let lookups = 0;
    atlas.getGlyph = (...args) => { lookups++; return get(...args); };
    const text = 'A'.repeat(3000);
    const result = layoutText(text, atlas, 'Arial', { fontSizePx: F, boxWidth: 30, overflow });
    expect(result.width).toBeLessThanOrEqual(30);
    expect(result.glyphs.length).toBeGreaterThan(0);
    expect(lookups).toBeLessThan(text.length * 3);
});

it.each([-8, 0, 2.25])('matches whole-codepoint trimming with spaces and signed spacing (%s)', letterSpacing => {
    const atlas = makeAtlas();
    for (const line of ['A😀 B  C测试   '.repeat(4), '😀😀😀abc', 'A\u2003B\u00a0C']) {
        for (const overflow of [TextOverflow.Clip, TextOverflow.Ellipsis]) {
            const measure = (s: string) => measureWidth(s, atlas, 'Arial', F, 0, letterSpacing);
            for (const limit of [5, 13.5, 23, 50]) {
                const tail = overflow === TextOverflow.Ellipsis ? '…' : '';
                let expected = line;
                if (measure(line) > limit) {
                    const chars = [...line]; expected = tail;
                    while (chars.length) {
                        chars.pop(); const candidate = chars.join('').trimEnd() + tail;
                        if (measure(candidate) <= limit) { expected = candidate; break; }
                    }
                }
                const opts = { fontSizePx: F, letterSpacing };
                const actual = layoutText(line, atlas, 'Arial', { ...opts, boxWidth: limit, overflow });
                const reference = layoutText(expected, atlas, 'Arial', opts);
                expect(actual).toEqual(reference);
            }
        }
    }
});

describe('TextOverflow.Shrink', () => {
    const wideText = 'the quick brown fox';
    const at = (size: number) => measureWidth(wideText, atlas, 'Arial', size, 0);

    it('leaves text that already fits exactly as it was', () => {
        const l = lay(wideText, { boxWidth: at(F) + 40, boxHeight: LINE * 2, overflow: TextOverflow.Shrink });
        expect(l.fontSizePx).toBeUndefined();
        expect(l.width).toBeCloseTo(at(F));
    });

    it('takes the largest whole size that fits the width, and not one more', () => {
        const box = at(F) * 0.6;
        const size = shrinkFontSize(wideText, atlas, 'Arial', { fontSizePx: F, lineHeight: LINE, boxWidth: box });
        expect(size).toBeLessThan(F);
        expect(Number.isInteger(size)).toBe(true);
        expect(at(size)).toBeLessThanOrEqual(box + 1e-6);
        expect(at(size + 1)).toBeGreaterThan(box);
    });

    it('lays the text out at that size, and says which size it was', () => {
        const box = at(F) * 0.6;
        const l = lay(wideText, { boxWidth: box, boxHeight: LINE, overflow: TextOverflow.Shrink });
        expect(l.fontSizePx).toBeLessThan(F);
        expect(l.width).toBeLessThanOrEqual(box + 1e-6);
        // line height shrinks with the type: the block is one line of the smaller size
        expect(l.lineHeight).toBeCloseTo(LINE * (l.fontSizePx! / F));
    });

    it('fits the height of wrapped text by making the lines smaller and more of them fit', () => {
        const box = { boxWidth: at(F) * 0.5, maxWidth: at(F) * 0.5, boxHeight: LINE * 1.5 };
        const l = lay(wideText, { ...box, overflow: TextOverflow.Shrink });
        expect(l.lineHeight).toBeLessThanOrEqual(box.boxHeight + 1e-6);
        expect(l.width).toBeLessThanOrEqual(box.boxWidth + 1e-6);
        // and the plain, unshrunk text really did not fit — otherwise this proves nothing
        expect(lay(wideText, { ...box, overflow: TextOverflow.Visible }).lineHeight).toBeGreaterThan(box.boxHeight);
    });

    it('is a no-op without a box, since nothing can overflow one', () => {
        const l = lay(wideText, { overflow: TextOverflow.Shrink });
        expect(l.fontSizePx).toBeUndefined();
    });

    it('never goes below one pixel: a box too small for anything shows the smallest text, not none', () => {
        const l = lay(wideText, { boxWidth: 1, boxHeight: 1, overflow: TextOverflow.Shrink });
        expect(l.fontSizePx).toBe(1);
        expect(l.glyphs.length).toBeGreaterThan(0);
    });
});

describe('TextOverflow.ResizeHeight', () => {
    it('keeps every line however short the box, and reports the height of all of them', () => {
        const l = lay('one\ntwo\nthree', { boxHeight: LINE, overflow: TextOverflow.ResizeHeight });
        expect(linesOf(l)).toBe(3);
        expect(l.lineHeight).toBeCloseTo(3 * LINE, 6);
    });

    it('does not trim a line that is wider than the box', () => {
        const l = lay('a long line of text', { boxWidth: 20, overflow: TextOverflow.ResizeHeight });
        expect(l.width).toBeCloseTo(width('a long line of text'), 6);
    });

    it('grows with wrapping: a narrower wrap width makes the block taller', () => {
        const wide = lay('one two three four five six', { maxWidth: 400, overflow: TextOverflow.ResizeHeight });
        const narrow = lay('one two three four five six', { maxWidth: 60, overflow: TextOverflow.ResizeHeight });
        expect(narrow.lineHeight).toBeGreaterThan(wide.lineHeight);
    });
});

describe('a laid-out line', () => {
    it('says where it sits: its left edge, its width, and its baseline', () => {
        const l = lay('ab\ncd', { align: 1, boxWidth: 100 });
        expect(l.lines).toHaveLength(2);
        expect(l.lines![0]!.baseline).toBeCloseTo(0, 6);
        expect(l.lines![1]!.baseline).toBeCloseTo(-LINE, 6);
        expect(l.lines![0]!.x).toBeCloseTo((100 - l.lines![0]!.width) / 2, 6);
    });
});

describe('underline', () => {
    const quads = (underline: boolean) => {
        const out: number[] = [];
        drawTextWith(atlas, (vertices) => { out.push(vertices.length); }, {
            text: 'ab\ncd', fontFamily: 'Arial', fontSizePx: F, color: [1, 1, 1, 1], lineHeight: LINE, underline,
        });
        return out.reduce((a, b) => a + b, 0);
    };

    it('adds one bar to each line', () => {
        const without = quads(false);
        const withBars = quads(true);
        // four glyphs and two bars, against four glyphs: the vertex data grows by one third
        expect(withBars).toBeCloseTo(without * 6 / 4, 6);
    });
});
