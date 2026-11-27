// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Text's weight and tabular figures: what the style bits keep of them, that a weight is a glyph of its own in the atlas,
 *        and that tabular figures lay out every number at the same width whatever its digits.
 */
import { describe, it, expect } from 'vitest';
import { GlyphAtlas, tabularFigure, type GlyphRasterizer } from '../src/ui/text/glyph-atlas';
import { layoutLine } from '../src/ui/text/layout';
import { textStyleBits } from '../src/ui/text/text-params';
import { textStyleWeight, UI_TEXT_BOLD, UI_TEXT_ITALIC, UI_TEXT_TABULAR } from '../src/ui/text/text-transform';

const base = { bold: false, italic: false };

describe('a Text weight in the style bits', () => {
    it('keeps the weight asked, and what bold says when none is', () => {
        expect(textStyleWeight(textStyleBits({ ...base, fontWeight: 300 }))).toBe(300);
        expect(textStyleWeight(textStyleBits({ ...base, fontWeight: 200 }))).toBe(200);
        expect(textStyleWeight(textStyleBits({ ...base }))).toBe(400);
        expect(textStyleWeight(textStyleBits({ ...base, bold: true }))).toBe(700);
        expect(textStyleWeight(textStyleBits({ ...base, fontWeight: 0, bold: true }))).toBe(700);
    });

    it('is bold where a platform knows only bold and not: from 600 up, and a light weight is not bold whatever bold says', () => {
        expect(textStyleBits({ ...base, fontWeight: 600 }) & UI_TEXT_BOLD).toBe(UI_TEXT_BOLD);
        expect(textStyleBits({ ...base, fontWeight: 300, bold: true }) & UI_TEXT_BOLD).toBe(0);
        expect(textStyleBits({ ...base, italic: true, tabularNumbers: true }) & (UI_TEXT_ITALIC | UI_TEXT_TABULAR)).toBe(UI_TEXT_ITALIC | UI_TEXT_TABULAR);
    });

    it('is drawn at least bold in a bold run of rich text over a light base', () => {
        expect(textStyleWeight(textStyleBits({ ...base, fontWeight: 300 }) | UI_TEXT_BOLD)).toBe(700);
        expect(textStyleWeight(textStyleBits({ ...base, fontWeight: 900 }) | UI_TEXT_BOLD)).toBe(900);
    });
});

/** A font whose figures differ in width, as most proportional fonts do: a 1 is narrow, an 8 wide. */
function proportional(calls: { cp: number; style: number }[]): GlyphRasterizer {
    return {
        renderSize: 32,
        spread: 0,
        rasterize: (cp, _family, style) => {
            calls.push({ cp, style });
            const advance = cp === 0x31 ? 8 : cp === 0x38 ? 20 : 14;
            return { pixels: new Uint8Array(4 * 4 * 4), width: 4, height: 4, advance, bearingX: 1, bearingY: 4 };
        },
    };
}

describe('tabular figures', () => {
    it('lay out every number at the width of its widest figure, each digit centred in its cell', () => {
        const atlas = new GlyphAtlas(proportional([]), null, { sdf: false });
        const tabular = (s: string) => layoutLine(s, atlas, 'Jost', { fontSizePx: 32 }, UI_TEXT_TABULAR).width;
        const plain = (s: string) => layoutLine(s, atlas, 'Jost', { fontSizePx: 32 }, 0).width;
        expect(plain('111')).not.toBe(plain('888'));
        expect(tabular('111')).toBe(tabular('888'));
        expect(tabular('111')).toBe(60);
        expect(tabularFigure({ pixels: new Uint8Array(0), width: 4, height: 4, advance: 8, bearingX: 1, bearingY: 4 }, 20).bearingX).toBe(7);
    });

    it('leave letters as they are, and never reach the rasterizer as a bit it does not know', () => {
        const calls: { cp: number; style: number }[] = [];
        const atlas = new GlyphAtlas(proportional(calls), null, { sdf: false });
        expect(layoutLine('A', atlas, 'Jost', { fontSizePx: 32 }, UI_TEXT_TABULAR).width).toBe(14);
        layoutLine('1', atlas, 'Jost', { fontSizePx: 32 }, UI_TEXT_TABULAR);
        expect(calls.every((c) => (c.style & UI_TEXT_TABULAR) === 0)).toBe(true);
    });
});

describe('a weight in the glyph atlas', () => {
    it('is a glyph of its own: a light and a regular A are rasterized apart', () => {
        const calls: { cp: number; style: number }[] = [];
        const atlas = new GlyphAtlas(proportional(calls), null, { sdf: false });
        atlas.getGlyph(65, 'Jost', textStyleBits({ ...base, fontWeight: 300 }), 32);
        atlas.getGlyph(65, 'Jost', textStyleBits({ ...base }), 32);
        atlas.getGlyph(65, 'Jost', textStyleBits({ ...base, fontWeight: 300 }), 32);
        expect(calls.map((c) => textStyleWeight(c.style))).toEqual([300, 400]);
    });
});
