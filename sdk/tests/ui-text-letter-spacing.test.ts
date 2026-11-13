// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui-text-letter-spacing.test.ts: Text.letterSpacing reaches the layout.
 *
 * The layout always took a spacing; the component had no field for it and no path handed one over, so a label
 * could not be spaced. These hold the field to the glyphs: what the component says is what the layout is asked,
 * on the one derivation every path shares.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { layoutText } from '../src/ui/text/layout';
import { textBoxPlacement, textDrawParams, textLetterSpacingPx, textLineHeightPx, textStyleBits } from '../src/ui/text/text-params';
import { Text, TextOverflow, type TextData } from '../src/ui/core/text';

function makeAtlas(): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        spread: 6,
        rasterize: (cp: number): RasterGlyph => {
            if (cp === 32) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 6, bearingX: 0, bearingY: 0 };
            return { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 };
        },
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

// scale 0.5 at this size: every letter advances 5.5px, a space 3px.
const F = 24;
const ADVANCE = 5.5;
const NO_BOX = { w: 0, h: 0, px: 0.5, py: 0.5 };

const text = (over: Partial<TextData> = {}): TextData => ({ ...structuredClone(Text._default), content: 'abcd', fontSize: F, ...over });

/** The glyphs a Text lays out to, through the params every draw path uses. */
function laid(t: TextData, frame = NO_BOX) {
    const p = textDrawParams(t, 'Arial', frame);
    return layoutText(p.text, makeAtlas(), p.fontFamily, {
        fontSizePx: p.fontSizePx, letterSpacing: p.letterSpacing, lineHeight: p.lineHeight, align: p.align, rich: p.richText,
        maxWidth: p.maxWidth, boxWidth: p.boxWidth, boxHeight: p.boxHeight, overflow: p.overflow,
    }, p.style ?? 0);
}

const lefts = (l: { glyphs: { x0: number }[] }) => l.glyphs.map((g) => g.x0);
const rows = (l: { glyphs: { y0: number }[] }) => new Set(l.glyphs.map((g) => Math.round(g.y0))).size;

describe('Text.letterSpacing', () => {
    it('is a field of the component, and none by default', () => {
        expect(Text._default.letterSpacing).toBe(0);
        expect(textDrawParams(text(), 'Arial', NO_BOX).letterSpacing).toBeUndefined();
    });

    it('moves each glyph one spacing further than the one before', () => {
        const plain = lefts(laid(text()));
        const spaced = lefts(laid(text({ letterSpacing: 3 })));
        expect(spaced.map((x, i) => x - plain[i]!)).toEqual([0, 3, 6, 9]);
        expect(laid(text({ letterSpacing: 3 })).width).toBeCloseTo(4 * (ADVANCE + 3));
    });

    it('draws glyphs closer when negative', () => {
        const plain = lefts(laid(text()));
        const tight = lefts(laid(text({ letterSpacing: -1 })));
        expect(tight.map((x, i) => x - plain[i]!)).toEqual([0, -1, -2, -3]);
    });

    it('spaces rich text as it does plain', () => {
        const plain = lefts(laid(text({ richText: true, content: 'ab<b>cd</b>' })));
        const spaced = lefts(laid(text({ richText: true, content: 'ab<b>cd</b>', letterSpacing: 2 })));
        expect(spaced.map((x, i) => x - plain[i]!)).toEqual([0, 2, 4, 6]);
    });

    it('wraps by the spaced width', () => {
        // 'aa aa' is 25px unspaced and fits a 26px box on one line; at 4px a glyph it is 45px and does not.
        const frame = { w: 26, h: 100, px: 0.5, py: 0.5 };
        expect(rows(laid(text({ content: 'aa aa' }), frame))).toBe(1);
        expect(rows(laid(text({ content: 'aa aa', letterSpacing: 4 }), frame))).toBe(2);
    });

    it('is scaled with the type when Shrink sets it smaller', () => {
        const frame = { w: 30, h: 0, px: 0.5, py: 0.5 };
        const l = laid(text({ content: 'aaaa', letterSpacing: 6, wordWrap: false, overflow: TextOverflow.Shrink }), frame);
        const size = l.fontSizePx!;
        expect(size).toBeLessThan(F);
        expect(l.glyphs[1]!.x0 - l.glyphs[0]!.x0).toBeCloseTo((ADVANCE + 6) * size / F);
        expect(l.width).toBeLessThanOrEqual(30 + 1e-6);
    });

    it('reads a missing or broken value as none', () => {
        expect(textLetterSpacingPx({})).toBeUndefined();
        expect(textLetterSpacingPx({ letterSpacing: Number.NaN })).toBeUndefined();
        expect(textLetterSpacingPx({ letterSpacing: 'wide' as never })).toBeUndefined();
        expect(textLetterSpacingPx({ letterSpacing: -2 })).toBe(-2);
    });
});

describe('what a Text asks of the renderer', () => {
    it('carries every style the component has', () => {
        const p = textDrawParams(text({
            bold: true, italic: true, underline: true, lineHeight: 1.5, letterSpacing: 2, richText: true, align: 1, verticalAlign: 2,
            overflow: TextOverflow.Ellipsis, strokeWidth: 2, shadowOffsetX: 1,
        }), 'Georgia', NO_BOX);
        expect(p).toMatchObject({
            text: 'abcd', fontFamily: 'Georgia', fontSizePx: F, style: 3, underline: true, lineHeight: 36, letterSpacing: 2,
            richText: true, align: 1, verticalAlign: 2, overflow: TextOverflow.Ellipsis,
        });
        expect(p.outline?.width).toBe(2);
        expect(p.shadow?.dx).toBe(1);
        expect(p.opacity).toBeUndefined();
    });

    it('has no shadow or outline to draw when they would not show', () => {
        const p = textDrawParams(text(), 'Arial', NO_BOX);
        expect(p.shadow).toBeUndefined();
        expect(p.outline).toBeUndefined();
        expect(textDrawParams(text({ shadowBlur: 3 }), 'Arial', NO_BOX).shadow?.blur).toBe(3);
    });

    it('anchors a boxless label at the origin and a boxed one in its box', () => {
        expect(textBoxPlacement(text(), 'Arial', NO_BOX)).toEqual({});
        const frame = { w: 100, h: 40, px: 0.5, py: 0.5 };
        const boxed = textBoxPlacement(text(), 'Arial', frame);
        expect(boxed).toMatchObject({ boxWidth: 100, boxHeight: 40, maxWidth: 100, originX: -50 });
        expect(textBoxPlacement(text({ wordWrap: false }), 'Arial', frame).maxWidth).toBeUndefined();
    });

    it('turns the line height ratio into px, and bold and italic into style bits', () => {
        expect(textLineHeightPx({ lineHeight: 1.5, fontSize: 20 })).toBe(30);
        expect(textLineHeightPx({ lineHeight: 0, fontSize: 20 })).toBeUndefined();
        expect(textStyleBits({ bold: true, italic: false })).toBe(1);
        expect(textStyleBits({ bold: false, italic: true })).toBe(2);
    });
});
