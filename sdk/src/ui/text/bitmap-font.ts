// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/bitmap-font.ts
 * @brief   Bitmap fonts (`.fnt`) as a glyph source for `Text`.
 *
 * A `.fnt` is a page image the artist drew plus a table saying where each glyph sits on it. The page is already
 * a texture the engine holds, so a bitmap font needs nothing the dynamic glyph atlas does: no rasterizing, no
 * packing, no second copy of the pixels. It answers the atlas's one question — "where is this glyph, and how does
 * it advance" — straight from the table, with the page's own texture handle as the page id. Everything downstream
 * of the atlas (wrapping, alignment, the layout box, Shrink, shadow, the outline stamps) then works on a bitmap
 * font exactly as it does on a system one.
 *
 * Metrics stay in the font's own pixels, and the layout scales them by `fontSize / font.size` — the scale a
 * bitmap-font label has always had in Cocos and Unity.
 *
 * This file holds no component and touches no engine: the parser is pure and the registry is a map.
 */
import type { GlyphEntry } from './glyph-atlas';

/** One `char` line of a `.fnt`, in the font's pixels (page origin top-left). */
export interface BmGlyph {
    x: number;
    y: number;
    width: number;
    height: number;
    xoffset: number;
    yoffset: number;
    xadvance: number;
}

/** A parsed `.fnt`: the table and the few numbers the layout needs, with no reference to a texture. */
export interface BmFont {
    /** The size the glyphs were drawn at; a label's `fontSize` is a multiple of this. */
    size: number;
    /** Distance between two lines, in font pixels. */
    lineHeight: number;
    /** Distance from the top of a line to its baseline. */
    base: number;
    pageWidth: number;
    pageHeight: number;
    /** The first page's image file, as the `.fnt` spells it. */
    page: string;
    /**
     * The page carries the glyph's outline in it, as BMFont's channel flags say: red is the glyph proper
     * (`redChnl=0`) and alpha is glyph and outline together (`alphaChnl=2`). Such a font is drawn in two passes —
     * the silhouette in the outline colour, the glyph on top — so the outline can be any colour, or absent.
     * A page that says nothing of its channels is a plain RGBA image to tint.
     */
    outlineInAlpha: boolean;
    glyphs: Map<number, BmGlyph>;
}

function attrs(line: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of line.matchAll(/(\w+)=("([^"]*)"|\S+)/g)) out[m[1]!] = m[3] ?? m[2]!;
    return out;
}

const int = (v: string | undefined, d = 0): number => {
    const n = v === undefined ? NaN : Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
};

/**
 * Read the text form of a BMFont file. Only the first page is kept — a font spread over several pages would
 * need one draw per page, and nothing here ships one. Kerning is not applied.
 * @throws when there is no `common` line or no page: there is nothing to draw from.
 */
export function parseBmFont(text: string): BmFont {
    let size = 0, lineHeight = 0, base = 0, pageWidth = 0, pageHeight = 0, page = '';
    let sawCommon = false;
    let outlineInAlpha = false;
    const glyphs = new Map<number, BmGlyph>();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('info ')) size = Math.abs(int(attrs(line).size));
        else if (line.startsWith('common ')) {
            const a = attrs(line);
            lineHeight = int(a.lineHeight);
            base = int(a.base);
            pageWidth = int(a.scaleW);
            pageHeight = int(a.scaleH);
            // BMFont's channel codes: 0 glyph, 1 outline, 2 glyph and outline.
            outlineInAlpha = int(a.alphaChnl, -1) === 2 && int(a.redChnl, -1) === 0;
            sawCommon = true;
        } else if (line.startsWith('page ')) {
            const a = attrs(line);
            if (!page && int(a.id) === 0) page = a.file ?? '';
        } else if (line.startsWith('char ')) {
            const a = attrs(line);
            if (int(a.page) !== 0) continue;
            glyphs.set(int(a.id), {
                x: int(a.x), y: int(a.y), width: int(a.width), height: int(a.height),
                xoffset: int(a.xoffset), yoffset: int(a.yoffset), xadvance: int(a.xadvance),
            });
        }
    }
    if (!sawCommon || !page || pageWidth <= 0 || pageHeight <= 0) throw new Error('not a bitmap font: no common line or page');
    return { size: size || lineHeight, lineHeight, base, pageWidth, pageHeight, page, outlineInAlpha, glyphs };
}

/** A registered font: the table, and the GL texture id its glyphs are on (what a text batch binds). */
interface Registered {
    font: BmFont;
    texture: number;
    family: string;
    entries: Map<number, GlyphEntry | null>;
}

const byHandle = new Map<number, Registered>();
const byFamily = new Map<string, Registered>();

/**
 * Make a loaded bitmap font usable by `Text`. @p handle is the resource handle the asset loader hands back — what
 * `Text.font` holds — and @p texture the page's GL texture id. Re-registering a handle replaces it.
 */
export function registerBitmapFont(handle: number, font: BmFont, texture: number): void {
    unregisterBitmapFont(handle);
    const family = `bmfont:${handle}`;
    const reg: Registered = { font, texture, family, entries: new Map() };
    byHandle.set(handle, reg);
    byFamily.set(family, reg);
}

export function unregisterBitmapFont(handle: number): void {
    const reg = byHandle.get(handle);
    if (!reg) return;
    byHandle.delete(handle);
    byFamily.delete(reg.family);
}

/** The family name `Text` lays out with for this font handle, or null when it is not a registered bitmap font. */
export function bitmapFontFamily(handle: number): string | null {
    return byHandle.get(handle)?.family ?? null;
}

/**
 * Where a family's first baseline sits below the top of its line, as a fraction of the font size: a bitmap font says
 * (`base` over the size it was drawn at — a glyph's top is `yoffset` below the line top and its baseline `base`), any
 * other font gets @p fallback.
 */
export function fontAscent(family: string, fallback: number): number {
    const font = byFamily.get(family)?.font;
    return font && font.size > 0 && font.base > 0 ? font.base / font.size : fallback;
}

/** The font a family names, or null when the family is an ordinary (outline) one. */
export function bitmapFontOf(family: string): BmFont | null {
    return byFamily.get(family)?.font ?? null;
}

/**
 * Where a glyph is and how it advances, in the font's pixels — the shape the glyph atlas hands to the layout. A
 * character the font does not draw is null, as it is for a system font with no glyph for it.
 */
export function bitmapGlyph(family: string, codepoint: number): GlyphEntry | null {
    const reg = byFamily.get(family);
    if (!reg) return null;
    const cached = reg.entries.get(codepoint);
    if (cached !== undefined) return cached;
    const g = reg.font.glyphs.get(codepoint);
    let entry: GlyphEntry | null = null;
    if (g) {
        const { pageWidth: w, pageHeight: h, base } = reg.font;
        entry = {
            pageId: reg.texture,
            u0: g.x / w, v0: g.y / h, u1: (g.x + g.width) / w, v1: (g.y + g.height) / h,
            width: g.width, height: g.height,
            advance: g.xadvance,
            bearingX: g.xoffset,
            // yoffset runs down from the top of the line; the layout wants the glyph's top above the baseline.
            bearingY: base - g.yoffset,
        };
    }
    reg.entries.set(codepoint, entry);
    return entry;
}

/** Test seam: forget every registration. */
export function resetBitmapFonts(): void {
    byHandle.clear();
    byFamily.clear();
}
