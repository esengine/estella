// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui/text/measure-text.ts — public text measurement.
 *
 * Answers "how wide/tall does this string render?" without spawning a Text
 * entity, for layout that must size to content up front — e.g. a ListView row
 * that grows with a wrapped chat bubble (`itemHeight(index)`).
 *
 * Metrics come from the SAME source the glyph atlas draws advances from, so a
 * measured wrap matches the rendered one: a hidden Canvas2D context on the web,
 * the platform's own glyph rasterizer on a device. Word-wrapping reuses
 * {@link wrapByMeasure}, the one wrap algorithm the renderer uses. Only a host
 * with neither (headless/logic-only) falls back to an average-glyph estimate.
 */
import { DEFAULT_LINE_HEIGHT, RuntimeConfig } from '../../defaults';
import { platformHasGlyphRasterizer, platformRasterizeGlyph } from '../../platform';
import { FONT_STYLE_BOLD, FONT_STYLE_ITALIC } from './glyph-rasterizer';
import { wrapByMeasure } from './layout';

export interface MeasureTextOptions {
    /** Default: Arial. */
    fontFamily?: string;
    /** Display px. */
    fontSize: number;
    bold?: boolean;
    /** Stroke weight 100..900 as `Text.fontWeight`; absent is what `bold` says. */
    fontWeight?: number;
    /** Every figure as wide as the widest, as `Text.tabularNumbers`. */
    tabularNumbers?: boolean;
    italic?: boolean;
    /** Extra px between glyphs (mirrors the renderer's letterSpacing). */
    letterSpacing?: number;
    /** Word-wrap width in display px. 0 / undefined ⇒ a single line (no wrap). */
    maxWidth?: number;
    /** Line height in display px. Default: `fontSize * 1.2` (the Text default ratio). */
    lineHeight?: number;
}

export interface TextMetrics {
    /** Width of the widest line, display px. */
    width: number;
    /** Number of lines after wrapping + explicit `\n`. */
    lineCount: number;
    /** `lineCount * lineHeight`, display px — the height to size a box to. */
    height: number;
}

type Measurer = {
    (s: string): number;
    append?: (width: number, suffix: string) => number;
};

let ctx_: CanvasRenderingContext2D | null | undefined;

/** Pen advances from the platform's own glyph source, by
 *  `family|style|size|codepoint`. Retain a bounded working set so historical
 *  font revisions and sizes do not accumulate across long-running sessions. */
const advances_ = new Map<string, { advance: number; used: boolean }>();
const ADVANCE_CACHE_LIMIT = 4096;
const advanceSlots_: string[] = [];
let advanceHand_ = 0;

function platformAdvance(
    codepoint: number, family: string, style: number, fontSize: number,
): number {
    const key = `${family}|${style}|${fontSize}|${codepoint}`;
    const hit = advances_.get(key);
    if (hit !== undefined) {
        hit.used = true;
        return hit.advance;
    }
    // Plain coverage at the display size: the advance is all this wants, and a
    // bitmap glyph is a fraction of the work an SDF one costs to produce.
    const glyph = platformRasterizeGlyph({
        codepoint, fontFamily: family, style, pixelSize: fontSize, sdf: false, padding: 0,
    });
    const advance = glyph ? glyph.advance : fontSize * 0.6;
    if (advanceSlots_.length < ADVANCE_CACHE_LIMIT) {
        advanceSlots_.push(key);
    } else {
        // Second-chance clock: hits only set a bit, avoiding Map reinsertion on
        // every character. The next insertion retires an unused slot; a used
        // slot gets one more traversal before it can be replaced.
        for (;;) {
            const oldKey = advanceSlots_[advanceHand_];
            const old = advances_.get(oldKey)!;
            if (!old.used) {
                advances_.delete(oldKey);
                advanceSlots_[advanceHand_] = key;
                advanceHand_ = (advanceHand_ + 1) % ADVANCE_CACHE_LIMIT;
                break;
            }
            old.used = false;
            advanceHand_ = (advanceHand_ + 1) % ADVANCE_CACHE_LIMIT;
        }
    }
    advances_.set(key, { advance, used: false });
    return advance;
}

/** A width measurer for `opts`: Canvas2D `measureText` where a DOM exists, the
 *  platform's glyph source where it does not (a device — the SAME font stack the
 *  renderer draws with, so a measured wrap still matches the rendered one), and
 *  an average-advance estimate only where there is neither (headless). */
function measurer(opts: MeasureTextOptions): Measurer {
    const family = opts.fontFamily || RuntimeConfig.defaultFontFamily;
    const spacing = opts.letterSpacing ?? 0;
    if (ctx_ === undefined) {
        ctx_ = typeof document !== 'undefined' && document.createElement
            ? document.createElement('canvas').getContext('2d')
            : null;
    }
    if (ctx_) {
        const ctx = ctx_;
        const weight = opts.fontWeight && opts.fontWeight > 0 ? `${Math.round(opts.fontWeight)} ` : opts.bold ? 'bold ' : '';
        ctx.font = `${opts.italic ? 'italic ' : ''}${weight}${opts.fontSize}px ${family}`;
        if (!opts.tabularNumbers) return (s) => ctx.measureText(s).width + [...s].length * spacing;
        // Tabular figures: each one as wide as the widest, as the atlas lays them out.
        let widest = 0;
        for (let d = 0; d <= 9; d++) widest = Math.max(widest, ctx.measureText(String(d)).width);
        return (s) => {
            const figures = s.match(/[0-9]/g)?.length ?? 0;
            return ctx.measureText(s.replace(/[0-9]/g, '')).width + figures * widest + [...s].length * spacing;
        };
    }
    if (platformHasGlyphRasterizer()) {
        const bold = opts.fontWeight && opts.fontWeight > 0 ? opts.fontWeight >= 600 : opts.bold;
        const style = (bold ? FONT_STYLE_BOLD : 0) | (opts.italic ? FONT_STYLE_ITALIC : 0);
        const append = (width: number, suffix: string): number => {
            for (const ch of suffix) width += platformAdvance(ch.codePointAt(0)!, family, style, opts.fontSize) + spacing;
            return width;
        };
        const measure: Measurer = s => append(0, s);
        measure.append = append;
        return measure;
    }
    // Headless fallback: a wide-ish average so wraps don't under-count.
    const avg = opts.fontSize * 0.6 + spacing;
    return (s) => [...s].length * avg;
}

/**
 * Measure `text` at the given font, word-wrapped to `maxWidth`. Pure w.r.t. the
 * inputs (a shared hidden canvas is the only state). Honours explicit `\n`.
 */
export function measureText(text: string, opts: MeasureTextOptions): TextMetrics {
    const measure = measurer(opts);
    const lineHeight = opts.lineHeight ?? opts.fontSize * DEFAULT_LINE_HEIGHT;
    const wrap = opts.maxWidth && opts.maxWidth > 0;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
        if (wrap) lines.push(...wrapByMeasure(para, measure, opts.maxWidth!, measure.append));
        else lines.push(para);
    }
    let width = 0;
    for (const line of lines) width = Math.max(width, measure(line));
    return { width, lineCount: lines.length, height: lines.length * lineHeight };
}
