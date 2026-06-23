/**
 * @file    ui/text/layout.ts
 * @brief   Pure text layout + glyph-quad vertex building for the SDF text path
 *          (REARCH_GUI P1.3, TS-centric). Given the glyph atlas (which supplies
 *          per-glyph atlas UVs + metrics), turn a string into positioned quads
 *          and then into the interleaved vertex/index buffers `submitTextBatch`
 *          expects. No Canvas/GL here, so it is fully unit-testable.
 *
 * Conventions: local space, baseline at y = 0, y-up (glyph tops are positive y);
 * positions are pre-transform (the entity world matrix is applied at submit).
 * Glyph metrics from the atlas are in renderSize px; everything scales by
 * displaySize / atlas.renderSize (SDF is resolution-independent).
 */
import type { GlyphAtlas } from './glyph-atlas';
import { TEXT_VERTEX_FLOATS } from './submit';
import { parseRichText } from '../RichTextParser';
import { UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';

export interface TextLayoutOptions {
    /** Display font size in px. */
    fontSizePx: number;
    /** Extra advance between glyphs, in display px. */
    letterSpacing?: number;
}

/** RGBA color, channels in [0,1]. */
export type RGBA = readonly [number, number, number, number];

/** One positioned glyph quad: atlas UVs + local-space corners (y-up). `color` is
 *  set only by rich text (per-run); single-style layout leaves it for the caller. */
export interface LaidGlyph {
    u0: number; v0: number; u1: number; v1: number;
    x0: number; y0: number; // bottom-left
    x1: number; y1: number; // top-right
    pageId: number;
    color?: RGBA;
}

export interface TextLayout {
    glyphs: LaidGlyph[];
    /** Total pen advance (display px). */
    width: number;
    /** Line height (display px). */
    lineHeight: number;
}

/**
 * Lay out a single line of text against the atlas. Glyphs missing from the
 * atlas (unproducible) are skipped; whitespace advances the pen without a quad.
 */
export function layoutLine(
    text: string,
    atlas: GlyphAtlas,
    fontFamily: string,
    opts: TextLayoutOptions,
    style = 0,
): TextLayout {
    const scale = opts.fontSizePx / atlas.renderSize;
    const spacing = opts.letterSpacing ?? 0;
    const glyphs: LaidGlyph[] = [];
    let penX = 0;

    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        const g = atlas.getGlyph(cp, fontFamily, style);
        if (!g) continue;

        if (g.width > 0 && g.height > 0) {
            const x0 = penX + g.bearingX * scale;
            const y1 = g.bearingY * scale;            // top, above baseline
            const x1 = x0 + g.width * scale;
            const y0 = y1 - g.height * scale;          // bottom
            glyphs.push({ u0: g.u0, v0: g.v0, u1: g.u1, v1: g.v1, x0, y0, x1, y1, pageId: g.pageId });
        }
        penX += g.advance * scale + spacing;
    }

    return { glyphs, width: penX, lineHeight: opts.fontSizePx };
}

export interface GlyphVertexData {
    vertices: Float32Array; // TEXT_VERTEX_FLOATS per vertex, 4 verts/glyph
    indices: Uint16Array;   // 6 per glyph
}

/**
 * Build interleaved vertices (x,y,u,v,r,g,b,a) + indices for a set of laid-out
 * glyphs (typically the subset that shares one atlas page — see TextRenderer).
 * Atlas v0 (top) maps to the screen-top corner, v1 (bottom) to screen-bottom,
 * so the quad samples the glyph upright. `originX/Y` offsets all glyphs (e.g. to
 * place the text by its UIRect-resolved anchor).
 */
export function buildGlyphVertices(
    glyphs: readonly LaidGlyph[],
    color: RGBA,
    originX = 0,
    originY = 0,
): GlyphVertexData {
    const n = glyphs.length;
    const vertices = new Float32Array(n * 4 * TEXT_VERTEX_FLOATS);
    const indices = new Uint16Array(n * 6);

    for (let i = 0; i < n; i++) {
        const gl = glyphs[i];
        const [r, g, b, a] = gl.color ?? color; // per-glyph color (rich text) falls back to the batch color
        const x0 = gl.x0 + originX, x1 = gl.x1 + originX;
        const y0 = gl.y0 + originY, y1 = gl.y1 + originY;
        const vo = i * 4 * TEXT_VERTEX_FLOATS;
        // BL, BR, TR, TL — UV V uses v1 at the bottom, v0 at the top.
        writeVertex(vertices, vo + 0 * TEXT_VERTEX_FLOATS, x0, y0, gl.u0, gl.v1, r, g, b, a);
        writeVertex(vertices, vo + 1 * TEXT_VERTEX_FLOATS, x1, y0, gl.u1, gl.v1, r, g, b, a);
        writeVertex(vertices, vo + 2 * TEXT_VERTEX_FLOATS, x1, y1, gl.u1, gl.v0, r, g, b, a);
        writeVertex(vertices, vo + 3 * TEXT_VERTEX_FLOATS, x0, y1, gl.u0, gl.v0, r, g, b, a);

        const io = i * 6, vb = i * 4;
        indices[io] = vb; indices[io + 1] = vb + 1; indices[io + 2] = vb + 2;
        indices[io + 3] = vb; indices[io + 4] = vb + 2; indices[io + 5] = vb + 3;
    }

    return { vertices, indices };
}

function writeVertex(
    out: Float32Array, o: number,
    x: number, y: number, u: number, v: number,
    r: number, g: number, b: number, a: number,
): void {
    out[o] = x; out[o + 1] = y; out[o + 2] = u; out[o + 3] = v;
    out[o + 4] = r; out[o + 5] = g; out[o + 6] = b; out[o + 7] = a;
}

export interface RichTextLayoutOptions extends TextLayoutOptions {
    /** Base color for runs that don't set their own <color=...>. */
    color: RGBA;
}

/** Horizontal alignment: 0 = left, 1 = center, 2 = right. */
export const TEXT_ALIGN_LEFT = 0;
export const TEXT_ALIGN_CENTER = 1;
export const TEXT_ALIGN_RIGHT = 2;

export interface MultilineTextOptions extends TextLayoutOptions {
    /** Baseline-to-baseline distance in px. Default fontSizePx * 1.2. */
    lineHeight?: number;
    /** 0 left | 1 center | 2 right. Default left. */
    align?: number;
    /** Parse rich markup (`<b>` etc.) per line. */
    rich?: boolean;
    /** Base color (used by rich runs without their own color). */
    color?: RGBA;
    /** Word-wrap width in display px (plain text only). 0/undefined = no wrap. */
    maxWidth?: number;
}

/** Sum of glyph advances for a string at the given size (display px). Pure. */
export function measureWidth(
    text: string, atlas: GlyphAtlas, fontFamily: string, fontSizePx: number, style: number, letterSpacing = 0,
): number {
    const scale = fontSizePx / atlas.renderSize;
    let w = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        const g = atlas.getGlyph(cp, fontFamily, style);
        if (g) w += g.advance * scale + letterSpacing;
    }
    return w;
}

/**
 * Greedy word-wrap a single line to `maxWidth` (display px). Breaks at spaces;
 * a single token wider than the line (long word, or CJK runs which have no
 * spaces) is broken character-by-character. Returns the wrapped sub-lines.
 */
export function wrapLine(
    text: string, atlas: GlyphAtlas, fontFamily: string, fontSizePx: number,
    style: number, maxWidth: number, letterSpacing = 0,
): string[] {
    const measure = (s: string) => measureWidth(s, atlas, fontFamily, fontSizePx, style, letterSpacing);
    const out: string[] = [];
    let cur = '';
    const flush = () => { const t = cur.replace(/\s+$/, ''); if (t) out.push(t); cur = ''; };
    const charBreak = (token: string) => {
        for (const ch of token) {
            if (cur && measure(cur + ch) > maxWidth) flush();
            cur += ch;
        }
    };

    for (const token of text.split(/(\s+)/)) {
        if (token === '') continue;
        if (/^\s+$/.test(token)) { if (cur) cur += token; continue; } // keep inter-word spaces, drop leading
        if (!cur) {
            if (measure(token) <= maxWidth) cur = token;
            else charBreak(token);
        } else if (measure(cur + token) <= maxWidth) {
            cur += token;
        } else {
            flush();
            if (measure(token) <= maxWidth) cur = token;
            else charBreak(token);
        }
    }
    flush();
    return out.length ? out : [''];
}

/**
 * Lay out multi-line text (REARCH_GUI P1.4): splits on `\n`, lays each line out
 * (rich or plain), stacks lines downward (y-up: line 0 on top) by `lineHeight`,
 * and horizontally aligns each line within the widest line's block. Pure →
 * unit-testable. (Word-wrap to a max width is a later addition.)
 */
export function layoutText(
    text: string,
    atlas: GlyphAtlas,
    fontFamily: string,
    opts: MultilineTextOptions,
    style = 0,
): TextLayout {
    const lineHeight = opts.lineHeight ?? opts.fontSizePx * 1.2;
    const align = opts.align ?? TEXT_ALIGN_LEFT;
    const baseColor = opts.color ?? ([1, 1, 1, 1] as const);
    const rawLines = text.split('\n');
    // Word-wrap (plain text only) before stacking; explicit \n still hard-breaks.
    const lines = (opts.maxWidth && opts.maxWidth > 0 && !opts.rich)
        ? rawLines.flatMap(l => wrapLine(l, atlas, fontFamily, opts.fontSizePx, style, opts.maxWidth!, opts.letterSpacing ?? 0))
        : rawLines;

    const lineLayouts = lines.map(line => (opts.rich
        ? layoutRichLine(line, atlas, fontFamily, { fontSizePx: opts.fontSizePx, letterSpacing: opts.letterSpacing, color: baseColor }, style)
        : layoutLine(line, atlas, fontFamily, opts, style)));

    const contentWidth = lineLayouts.reduce((m, l) => Math.max(m, l.width), 0);
    // Align within the wrap/rect box when one is given, else within the widest line.
    const alignWidth = (opts.maxWidth && opts.maxWidth > 0) ? opts.maxWidth : contentWidth;
    const glyphs: LaidGlyph[] = [];

    for (let i = 0; i < lineLayouts.length; i++) {
        const ll = lineLayouts[i];
        const dx = align === TEXT_ALIGN_CENTER ? (alignWidth - ll.width) / 2
            : align === TEXT_ALIGN_RIGHT ? (alignWidth - ll.width)
            : 0;
        const dy = -i * lineHeight; // y-up: first line on top
        for (const g of ll.glyphs) {
            glyphs.push({ ...g, x0: g.x0 + dx, x1: g.x1 + dx, y0: g.y0 + dy, y1: g.y1 + dy });
        }
    }

    return { glyphs, width: contentWidth, lineHeight: lines.length * lineHeight };
}

/**
 * Lay out a single line of rich text (REARCH_GUI P1.4): `<b>`, `<i>`,
 * `<color=#rrggbb[aa]>`, `<font size=N>` runs (parsed by parseRichText) become
 * glyphs carrying per-run color + size + bold/italic style. Image runs (`<img>`)
 * are skipped for now. Each run scales by its own fontSize / atlas.renderSize;
 * all runs share the baseline (y = 0). Pure → unit-testable.
 */
export function layoutRichLine(
    content: string,
    atlas: GlyphAtlas,
    fontFamily: string,
    opts: RichTextLayoutOptions,
    baseStyle = 0,
): TextLayout {
    const spacing = opts.letterSpacing ?? 0;
    const glyphs: LaidGlyph[] = [];
    let penX = 0;
    let lineHeight = opts.fontSizePx;

    for (const run of parseRichText(content)) {
        if (run.type !== 'text') continue; // embedded images: deferred
        const runSize = run.fontSize ?? opts.fontSizePx;
        const scale = runSize / atlas.renderSize;
        const style = baseStyle | (run.bold ? UI_TEXT_BOLD : 0) | (run.italic ? UI_TEXT_ITALIC : 0);
        const color: RGBA = run.color
            ? [run.color.r, run.color.g, run.color.b, run.color.a]
            : opts.color;
        if (runSize > lineHeight) lineHeight = runSize;

        for (const ch of run.text) {
            const cp = ch.codePointAt(0);
            if (cp === undefined) continue;
            const gph = atlas.getGlyph(cp, fontFamily, style);
            if (!gph) continue;
            if (gph.width > 0 && gph.height > 0) {
                const x0 = penX + gph.bearingX * scale;
                const y1 = gph.bearingY * scale;
                glyphs.push({
                    u0: gph.u0, v0: gph.v0, u1: gph.u1, v1: gph.v1,
                    x0, y0: y1 - gph.height * scale, x1: x0 + gph.width * scale, y1,
                    pageId: gph.pageId, color,
                });
            }
            penX += gph.advance * scale + spacing;
        }
    }

    return { glyphs, width: penX, lineHeight };
}
