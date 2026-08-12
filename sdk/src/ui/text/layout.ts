// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/layout.ts
 * @brief   Pure text layout + glyph-quad vertex building for the SDF text path
 *          (TS-centric). Given the glyph atlas (which supplies
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
import { parseRichText, type TextSegment, type ImageSegment, type RichTextRun } from './rich-text-parser';
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

/** One placed inline `<img>` run: a box in the same local space as glyphs
 *  (y-up; (x,y) is the bottom-left corner). `src` is the image reference the
 *  renderer resolves to a texture; `tint` recolors it (null = untinted). */
export interface LaidImage {
    src: string;
    x: number;
    y: number;
    w: number;
    h: number;
    tint: RGBA | null;
}

export interface TextLayout {
    glyphs: LaidGlyph[];
    /** Inline `<img>` placements (rich text only). Undefined/empty = none. */
    images?: LaidImage[];
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
    const pixelSize = atlas.pixelSizeFor(opts.fontSizePx);
    const scale = opts.fontSizePx / pixelSize;
    const spacing = opts.letterSpacing ?? 0;
    const glyphs: LaidGlyph[] = [];
    let penX = 0;

    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        const g = atlas.getGlyph(cp, fontFamily, style, pixelSize);
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
 * glyphs (typically the subset that shares one atlas page).
 * Atlas v0 (top) maps to the screen-top corner, v1 (bottom) to screen-bottom,
 * so the quad samples the glyph upright. `originX/Y` offsets all glyphs (e.g. to
 * place the text by its UINode-resolved box origin).
 */
export function buildGlyphVertices(
    glyphs: readonly LaidGlyph[],
    color: RGBA,
    originX = 0,
    originY = 0,
    sdfBias = 0,
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
        writeVertex(vertices, vo + 0 * TEXT_VERTEX_FLOATS, x0, y0, gl.u0, gl.v1, r, g, b, a, sdfBias);
        writeVertex(vertices, vo + 1 * TEXT_VERTEX_FLOATS, x1, y0, gl.u1, gl.v1, r, g, b, a, sdfBias);
        writeVertex(vertices, vo + 2 * TEXT_VERTEX_FLOATS, x1, y1, gl.u1, gl.v0, r, g, b, a, sdfBias);
        writeVertex(vertices, vo + 3 * TEXT_VERTEX_FLOATS, x0, y1, gl.u0, gl.v0, r, g, b, a, sdfBias);

        const io = i * 6, vb = i * 4;
        indices[io] = vb; indices[io + 1] = vb + 1; indices[io + 2] = vb + 2;
        indices[io + 3] = vb; indices[io + 4] = vb + 2; indices[io + 5] = vb + 3;
    }

    return { vertices, indices };
}

function writeVertex(
    out: Float32Array, o: number,
    x: number, y: number, u: number, v: number,
    r: number, g: number, b: number, a: number, sdfBias: number,
): void {
    out[o] = x; out[o + 1] = y; out[o + 2] = u; out[o + 3] = v;
    out[o + 4] = r; out[o + 5] = g; out[o + 6] = b; out[o + 7] = a;
    out[o + 8] = sdfBias;
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
    /** Word-wrap width in display px (plain and rich text). 0/undefined = no wrap. */
    maxWidth?: number;
    /**
     * Width (display px) each line is horizontally aligned within — the layout box.
     * Defaults to `maxWidth`, else the widest line. Separating it from `maxWidth` lets
     * horizontal align work inside a fixed box even when word-wrap is off.
     */
    boxWidth?: number;
    /** Height (display px) of the layout box, for {@link overflow}. 0/undefined =
     *  no box, so nothing can overflow one. */
    boxHeight?: number;
    /**
     * What a run too big for the box does: 0 visible (default), 1 clip, 2
     * ellipsis. Needs `boxHeight` to drop lines and a width to trim one.
     */
    overflow?: number;
}

/** {@link MultilineTextOptions.overflow} — mirrors the TextOverflow const. */
export const TEXT_OVERFLOW_VISIBLE = 0;
export const TEXT_OVERFLOW_CLIP = 1;
export const TEXT_OVERFLOW_ELLIPSIS = 2;

/** The character appended to a line the ellipsis mode cut. */
const ELLIPSIS = '\u2026';

/**
 * Cut `line` down to `limit` px, appending an ellipsis when asked. Trimmed one
 * code point at a time from the end rather than by a ratio: a proportional guess
 * lands mid-glyph on any font that is not monospace, and the ellipsis has to fit
 * INSIDE the limit or the trim it paid for was for nothing.
 */
function truncateLine(
    line: string, measure: (s: string) => number, limit: number, ellipsis: boolean,
): string {
    if (limit <= 0 || measure(line) <= limit) return line;
    const tail = ellipsis ? ELLIPSIS : '';
    const chars = [...line];
    // Whole-glyph granularity, and the caller is told so: a partial glyph would
    // need the renderer to scissor, which text does not go through.
    while (chars.length > 0) {
        chars.pop();
        const candidate = chars.join('').trimEnd();
        if (measure(candidate + tail) <= limit) return candidate + tail;
    }
    return tail;
}

/** Sum of glyph advances for a string at the given size (display px). Pure. */
export function measureWidth(
    text: string, atlas: GlyphAtlas, fontFamily: string, fontSizePx: number, style: number, letterSpacing = 0,
): number {
    const pixelSize = atlas.pixelSizeFor(fontSizePx);
    const scale = fontSizePx / pixelSize;
    let w = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        const g = atlas.getGlyph(cp, fontFamily, style, pixelSize);
        if (g) w += g.advance * scale + letterSpacing;
    }
    return w;
}

/**
 * Greedy word-wrap using an arbitrary width `measure` (display px). Breaks at
 * spaces; a token wider than the line (long word, or CJK runs with no spaces) is
 * broken character-by-character. The single source of wrap truth — the
 * atlas-backed {@link wrapLine} and the Canvas2D-backed `measureText` both call
 * it, so measured heights match rendered wraps.
 */
export function wrapByMeasure(text: string, measure: (s: string) => number, maxWidth: number): string[] {
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
 * Greedy word-wrap a single line to `maxWidth` (display px) using the glyph
 * atlas's advances. Thin wrapper over {@link wrapByMeasure}.
 */
export function wrapLine(
    text: string, atlas: GlyphAtlas, fontFamily: string, fontSizePx: number,
    style: number, maxWidth: number, letterSpacing = 0,
): string[] {
    return wrapByMeasure(text, (s) => measureWidth(s, atlas, fontFamily, fontSizePx, style, letterSpacing), maxWidth);
}

/**
 * Lay out multi-line text: splits on `\n`, lays each line out
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
    const wrap = !!(opts.maxWidth && opts.maxWidth > 0);
    const richOpts = { fontSizePx: opts.fontSizePx, letterSpacing: opts.letterSpacing, color: baseColor };

    // Word-wrap before stacking; explicit \n still hard-breaks. Rich lines wrap
    // at the styled-run level so a token measures with its own size/style. Inline
    // images survive the no-wrap path; wrapping is text-only (images drop) for now.
    // How many lines the box has room for. Below Visible only, and never zero: a
    // box too short for one line shows one clipped line rather than nothing, which
    // is what every layout engine does and what a reader can act on.
    const overflow = opts.overflow ?? TEXT_OVERFLOW_VISIBLE;
    const boxHeight = opts.boxHeight ?? 0;
    const maxLines = overflow !== TEXT_OVERFLOW_VISIBLE && boxHeight > 0
        ? Math.max(1, Math.floor(boxHeight / lineHeight))
        : Infinity;
    const ellipsis = overflow === TEXT_OVERFLOW_ELLIPSIS;
    // The width a line may not exceed. maxWidth already wrapped to it, so this is
    // for the unwrapped case — a single line in a fixed box, which is the one
    // ellipsis is usually asked for.
    const widthLimit = overflow === TEXT_OVERFLOW_VISIBLE ? 0
        : (opts.maxWidth && opts.maxWidth > 0) ? opts.maxWidth
        : (opts.boxWidth ?? 0);

    let lineLayouts: TextLayout[];
    if (opts.rich) {
        // Rich text truncates by line only: trimming one means measuring per run,
        // and a run's own size and style make that a different calculation.
        const richLines = rawLines
            .map(l => parseRichText(l))
            .flatMap(runs => (wrap
                ? wrapRichRuns(runs.filter((r): r is TextSegment => r.type === 'text'), atlas, fontFamily, opts.fontSizePx, style, opts.maxWidth!, opts.letterSpacing ?? 0)
                : [runs]));
        const kept = richLines.slice(0, maxLines === Infinity ? undefined : maxLines);
        if (ellipsis && kept.length < richLines.length && kept.length > 0) {
            kept[kept.length - 1] = [...kept[kept.length - 1], { type: 'text', text: ELLIPSIS } as TextSegment];
        }
        lineLayouts = kept.map(runs => layoutRichRuns(runs, atlas, fontFamily, richOpts, style));
    } else {
        const plainLines = wrap
            ? rawLines.flatMap(l => wrapLine(l, atlas, fontFamily, opts.fontSizePx, style, opts.maxWidth!, opts.letterSpacing ?? 0))
            : rawLines;
        const kept = plainLines.slice(0, maxLines === Infinity ? undefined : maxLines);
        const dropped = kept.length < plainLines.length;
        const measure = (t: string) => measureWidth(t, atlas, fontFamily, opts.fontSizePx, style, opts.letterSpacing ?? 0);
        const cut = kept.map((line, i) => {
            const last = i === kept.length - 1;
            // The last kept line carries the ellipsis when lines were dropped, even
            // if it fits: the mark says "there is more", not "this line was long".
            if (dropped && last && ellipsis) return truncateLine(line + ELLIPSIS, measure, widthLimit || Infinity, true);
            return widthLimit > 0 ? truncateLine(line, measure, widthLimit, ellipsis) : line;
        });
        lineLayouts = cut.map(line => layoutLine(line, atlas, fontFamily, opts, style));
    }
    const lines = lineLayouts; // line count only below

    const contentWidth = lineLayouts.reduce((m, l) => Math.max(m, l.width), 0);
    // Align within the layout box when one is given (independent of word-wrap), then
    // the wrap width, else the widest line.
    const alignWidth = (opts.boxWidth && opts.boxWidth > 0) ? opts.boxWidth
        : (opts.maxWidth && opts.maxWidth > 0) ? opts.maxWidth
        : contentWidth;
    const glyphs: LaidGlyph[] = [];
    const images: LaidImage[] = [];

    for (let i = 0; i < lineLayouts.length; i++) {
        const ll = lineLayouts[i];
        const dx = align === TEXT_ALIGN_CENTER ? (alignWidth - ll.width) / 2
            : align === TEXT_ALIGN_RIGHT ? (alignWidth - ll.width)
            : 0;
        const dy = -i * lineHeight; // y-up: first line on top
        for (const g of ll.glyphs) {
            glyphs.push({ ...g, x0: g.x0 + dx, x1: g.x1 + dx, y0: g.y0 + dy, y1: g.y1 + dy });
        }
        if (ll.images) {
            for (const im of ll.images) images.push({ ...im, x: im.x + dx, y: im.y + dy });
        }
    }

    return { glyphs, images, width: contentWidth, lineHeight: lines.length * lineHeight };
}

/**
 * Lay out a single line of rich text: `<b>`, `<i>`, `<color=#rrggbb[aa]>`,
 * `<font size=N>` runs (parsed by parseRichText) become glyphs carrying per-run
 * color + size + bold/italic style, and `<img>` runs become inline image boxes.
 * Each run scales by its own fontSize / atlas.renderSize; all share the baseline
 * (y = 0). Pure → unit-testable.
 */
export function layoutRichLine(
    content: string,
    atlas: GlyphAtlas,
    fontFamily: string,
    opts: RichTextLayoutOptions,
    baseStyle = 0,
): TextLayout {
    return layoutRichRuns(parseRichText(content), atlas, fontFamily, opts, baseStyle);
}

/** Measure a styled run's advance width (mirrors layoutRichRuns' pen math). */
function measureRun(
    text: string, run: TextSegment, atlas: GlyphAtlas, fontFamily: string,
    baseSizePx: number, baseStyle: number, spacing: number,
): number {
    const runSize = run.fontSize ?? baseSizePx;
    const pixelSize = atlas.pixelSizeFor(runSize);
    const scale = runSize / pixelSize;
    const style = baseStyle | (run.bold ? UI_TEXT_BOLD : 0) | (run.italic ? UI_TEXT_ITALIC : 0);
    let w = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        const gph = atlas.getGlyph(cp, fontFamily, style, pixelSize);
        if (gph) w += gph.advance * scale + spacing;
    }
    return w;
}

/**
 * Greedy word-wrap over styled runs: tokens measure with their own run's
 * size/style, breaks land at spaces (a single oversized token breaks
 * character-by-character), and each output line is a run list ready for
 * {@link layoutRichRuns}. The plain-text twin is {@link wrapLine}.
 */
export function wrapRichRuns(
    runs: TextSegment[], atlas: GlyphAtlas, fontFamily: string,
    baseSizePx: number, baseStyle: number, maxWidth: number, spacing = 0,
): TextSegment[][] {
    interface Token { run: TextSegment; text: string; space: boolean }
    const tokens: Token[] = [];
    for (const run of runs) {
        for (const part of run.text.split(/(\s+)/)) {
            if (part === '') continue;
            tokens.push({ run, text: part, space: /^\s+$/.test(part) });
        }
    }

    const lines: TextSegment[][] = [];
    let cur: Token[] = [];
    let curWidth = 0;
    const measure = (t: Token) =>
        measureRun(t.text, t.run, atlas, fontFamily, baseSizePx, baseStyle, spacing);
    const flush = () => {
        while (cur.length > 0 && cur[cur.length - 1]!.space) cur.pop();
        // Merge adjacent tokens of the same run back into segments.
        const segs: TextSegment[] = [];
        for (const t of cur) {
            const last = segs[segs.length - 1];
            if (last && last.bold === t.run.bold && last.italic === t.run.italic
                && last.color === t.run.color && last.fontSize === t.run.fontSize) {
                last.text += t.text;
            } else {
                segs.push({ ...t.run, text: t.text });
            }
        }
        if (segs.length > 0) lines.push(segs);
        cur = [];
        curWidth = 0;
    };
    const push = (t: Token) => { cur.push(t); curWidth += measure(t); };
    const charBreak = (t: Token) => {
        for (const ch of t.text) {
            const w = measureRun(ch, t.run, atlas, fontFamily, baseSizePx, baseStyle, spacing);
            if (cur.length > 0 && curWidth + w > maxWidth) flush();
            push({ run: t.run, text: ch, space: false });
        }
    };

    for (const t of tokens) {
        if (t.space) {
            if (cur.length > 0) push(t); // keep inter-word spaces, drop leading
            continue;
        }
        const w = measure(t);
        if (cur.length === 0) {
            if (w <= maxWidth) push(t);
            else charBreak(t);
        } else if (curWidth + w <= maxWidth) {
            push(t);
        } else {
            flush();
            if (w <= maxWidth) push(t);
            else charBreak(t);
        }
    }
    flush();
    return lines.length ? lines : [[]];
}

/** Place an `<img>` run's box on the pen. y-up local space, baseline at y = 0;
 *  `valign` picks the vertical anchor (ascent ≈ size×0.8, descent ≈ size×0.2),
 *  `offsetX/Y` nudge it, `scale` sizes it. The pen advances by the scaled width. */
function placeImage(img: ImageSegment, penX: number, fontSizePx: number): LaidImage {
    const w = img.width * img.scale;
    const h = img.height * img.scale;
    const ascent = fontSizePx * 0.8;
    const descent = fontSizePx * 0.2;
    let yBottom: number;
    switch (img.valign) {
        case 'top': yBottom = ascent - h; break;
        case 'bottom': yBottom = -descent; break;
        case 'middle': yBottom = (ascent - descent) / 2 - h / 2; break;
        default: yBottom = 0; break; // baseline
    }
    return {
        src: img.src,
        x: penX + img.offsetX,
        y: yBottom + img.offsetY,
        w, h,
        tint: img.tint ? [img.tint.r, img.tint.g, img.tint.b, img.tint.a] : null,
    };
}

/**
 * Lay out a single rich line from its runs: text runs carry per-run color +
 * size + bold/italic; `<img>` runs place an inline image box that advances the
 * pen by its width. All share the baseline (y = 0). Pure → unit-testable.
 */
export function layoutRichRuns(
    runs: RichTextRun[],
    atlas: GlyphAtlas,
    fontFamily: string,
    opts: RichTextLayoutOptions,
    baseStyle = 0,
): TextLayout {
    const spacing = opts.letterSpacing ?? 0;
    const glyphs: LaidGlyph[] = [];
    const images: LaidImage[] = [];
    let penX = 0;
    let lineHeight = opts.fontSizePx;

    for (const run of runs) {
        if (run.type === 'image') {
            const placed = placeImage(run, penX, opts.fontSizePx);
            images.push(placed);
            if (placed.h > lineHeight) lineHeight = placed.h;
            penX += run.width * run.scale;
            continue;
        }
        const runSize = run.fontSize ?? opts.fontSizePx;
        const pixelSize = atlas.pixelSizeFor(runSize);
        const scale = runSize / pixelSize;
        const style = baseStyle | (run.bold ? UI_TEXT_BOLD : 0) | (run.italic ? UI_TEXT_ITALIC : 0);
        const color: RGBA = run.color
            ? [run.color.r, run.color.g, run.color.b, run.color.a]
            : opts.color;
        if (runSize > lineHeight) lineHeight = runSize;

        for (const ch of run.text) {
            const cp = ch.codePointAt(0);
            if (cp === undefined) continue;
            const gph = atlas.getGlyph(cp, fontFamily, style, pixelSize);
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

    return { glyphs, images, width: penX, lineHeight };
}
