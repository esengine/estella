// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui-text-bitmap-font.test.ts — a `.fnt` as a font for `Text`.
 *
 * A bitmap font's page is a texture the engine already holds, so the whole job is answering the atlas's question
 * from the table: where is this glyph, and how does the pen move. What a reader can be wrong about, and what these
 * pin, is the arithmetic between the file's conventions (a glyph's `yoffset` runs DOWN from the top of the line,
 * a rect's origin is the page's top-left) and the layout's (a glyph's top is measured UP from the baseline).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GlyphAtlas, type AtlasPageStore, type GlyphRasterizer } from '../src/ui/text/glyph-atlas';
import {
    bitmapFontFamily, bitmapFontOf, bitmapGlyph, parseBmFont, registerBitmapFont, resetBitmapFonts, unregisterBitmapFont,
} from '../src/ui/text/bitmap-font';
import { resolveTextFamily } from '../src/ui/text/font-registry';
import { layoutText, measureWidth } from '../src/ui/text/layout';
import { TextOverflow } from '../src/ui/core/text';

const FNT = [
    'info face="Demo" size=-40 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=1,1',
    'common lineHeight=48 base=38 scaleW=512 scaleH=256 pages=1 packed=0',
    'page id=0 file="demo_0.png"',
    'chars count=4',
    'char id=32 x=0 y=0 width=0 height=0 xoffset=0 yoffset=38 xadvance=12 page=0 chnl=15',
    'char id=65 x=10 y=20 width=30 height=36 xoffset=2 yoffset=4 xadvance=34 page=0 chnl=15',
    'char id=66 x=50 y=20 width=26 height=36 xoffset=1 yoffset=6 xadvance=30 page=0 chnl=15',
    'char id=67 x=90 y=20 width=20 height=20 xoffset=0 yoffset=0 xadvance=22 page=1 chnl=15',
    'kernings count=0',
].join('\r\n');

const PAGE_TEXTURE = 7001;

function atlas(): GlyphAtlas {
    // A rasterizer that must never be asked: a bitmap font is not rasterized.
    const rasterizer: GlyphRasterizer = {
        renderSize: 48, spread: 0,
        rasterize: () => { throw new Error('a bitmap font must not reach the rasterizer'); },
    };
    const store: AtlasPageStore = { createPage: () => 1, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

afterEach(() => resetBitmapFonts());

describe('parseBmFont', () => {
    it('reads the metrics and the glyph table, taking the size as magnitude (a smooth font writes it negative)', () => {
        const f = parseBmFont(FNT);
        expect(f).toMatchObject({ size: 40, lineHeight: 48, base: 38, pageWidth: 512, pageHeight: 256, page: 'demo_0.png' });
        expect(f.glyphs.get(65)).toEqual({ x: 10, y: 20, width: 30, height: 36, xoffset: 2, yoffset: 4, xadvance: 34 });
    });

    it('keeps the first page only: a glyph on another page is not in the table', () => {
        expect(parseBmFont(FNT).glyphs.has(67)).toBe(false);
    });

    it('refuses what is not a bitmap font, rather than registering a font with nothing in it', () => {
        expect(() => parseBmFont('hello')).toThrow(/not a bitmap font/);
        expect(() => parseBmFont('common lineHeight=10 base=8 scaleW=64 scaleH=64')).toThrow(/not a bitmap font/);
    });
});

describe('the glyph a bitmap font answers with', () => {
    it('places a glyph by its rect over the page, with v counted from the page top as the atlas counts it', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        const g = bitmapGlyph(bitmapFontFamily(5)!, 65)!;
        expect(g.pageId).toBe(PAGE_TEXTURE);
        expect([g.u0, g.v0, g.u1, g.v1]).toEqual([10 / 512, 20 / 256, 40 / 512, 56 / 256]);
        expect([g.width, g.height, g.advance]).toEqual([30, 36, 34]);
    });

    it('turns yoffset (down from the line top) into a bearing (up from the baseline)', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        // base 38, yoffset 4: the glyph's top is 34 above the baseline; the second sits 2 lower
        expect(bitmapGlyph('bmfont:5', 65)!.bearingY).toBe(34);
        expect(bitmapGlyph('bmfont:5', 66)!.bearingY).toBe(32);
        expect(bitmapGlyph('bmfont:5', 65)!.bearingX).toBe(2);
    });

    it('answers a space with an advance and no quad, and a character the font lacks with nothing', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        expect(bitmapGlyph('bmfont:5', 32)).toMatchObject({ width: 0, height: 0, advance: 12 });
        expect(bitmapGlyph('bmfont:5', 0x4e2d)).toBeNull();
    });

    it('is not a bitmap font for a family that was never registered, or was released', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        expect(bitmapFontOf('Arial')).toBeNull();
        unregisterBitmapFont(5);
        expect(bitmapFontOf('bmfont:5')).toBeNull();
        expect(bitmapFontFamily(5)).toBeNull();
    });
});

describe('Text laying out with a bitmap font', () => {
    it('resolves a registered handle to its family, ahead of the authored family name', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        expect(resolveTextFamily(5, 'Arial')).toBe('bmfont:5');
        expect(resolveTextFamily(0, 'Arial')).toBe('Arial');
    });

    it('never rasterizes: the atlas answers from the table', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        const a = atlas();
        expect(a.getGlyph(65, 'bmfont:5')).not.toBeNull();
        expect(a.pixelSizeFor(77, 'bmfont:5')).toBe(40); // the size the font was drawn at, whatever is asked
    });

    it('scales the font\'s metrics by fontSize over the size it was drawn at', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        const a = atlas();
        // "AB": 34 + 30 advance at the native size 40
        expect(measureWidth('AB', a, 'bmfont:5', 40, 0)).toBeCloseTo(64);
        expect(measureWidth('AB', a, 'bmfont:5', 20, 0)).toBeCloseTo(32);
        expect(measureWidth('AB', a, 'bmfont:5', 80, 0)).toBeCloseTo(128);
    });

    it('lays a glyph quad out from its bearing, at the scale asked for', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        const l = layoutText('A', atlas(), 'bmfont:5', { fontSizePx: 20 });
        const q = l.glyphs[0]!;
        // scale 0.5: left at xoffset*0.5, top 34*0.5 above the baseline, 15 wide, 18 tall
        expect(q.x0).toBeCloseTo(1);
        expect(q.x1).toBeCloseTo(16);
        expect(q.y1).toBeCloseTo(17);
        expect(q.y0).toBeCloseTo(-1);
        expect(q.pageId).toBe(PAGE_TEXTURE);
    });

    it('wraps and shrinks like any font, because it goes through the same layout', () => {
        registerBitmapFont(5, parseBmFont(FNT), PAGE_TEXTURE);
        const a = atlas();
        const l = layoutText('ABABAB', a, 'bmfont:5', {
            fontSizePx: 40, lineHeight: 48, boxWidth: 100, boxHeight: 100, overflow: TextOverflow.Shrink,
        });
        expect(l.fontSizePx).toBeLessThan(40);
        expect(l.width).toBeLessThanOrEqual(100 + 1e-6);
    });
});
