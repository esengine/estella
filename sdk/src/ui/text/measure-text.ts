// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui/text/measure-text.ts — public text measurement.
 *
 * Answers "how wide/tall does this string render?" without spawning a Text
 * entity, for layout that must size to content up front — e.g. a ListView row
 * that grows with a wrapped chat bubble (`itemHeight(index)`).
 *
 * Metrics come from a hidden Canvas2D context, the SAME source the glyph atlas
 * draws advances from, so a measured wrap matches the rendered one. Word-wrapping
 * reuses {@link wrapByMeasure}, the one wrap algorithm the renderer uses. With no
 * DOM (headless/logic-only host) it falls back to an average-glyph estimate.
 */
import { DEFAULT_FONT_FAMILY, DEFAULT_LINE_HEIGHT } from '../../defaults';
import { wrapByMeasure } from './layout';

export interface MeasureTextOptions {
    /** Default: Arial. */
    fontFamily?: string;
    /** Display px. */
    fontSize: number;
    bold?: boolean;
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

type Measurer = (s: string) => number;

let ctx_: CanvasRenderingContext2D | null | undefined;

/** A width measurer for `opts`: Canvas2D `measureText` where a DOM exists, else
 *  an average-advance estimate (headless). */
function measurer(opts: MeasureTextOptions): Measurer {
    const family = opts.fontFamily ?? DEFAULT_FONT_FAMILY;
    const spacing = opts.letterSpacing ?? 0;
    if (ctx_ === undefined) {
        ctx_ = typeof document !== 'undefined' && document.createElement
            ? document.createElement('canvas').getContext('2d')
            : null;
    }
    if (ctx_) {
        const ctx = ctx_;
        ctx.font = `${opts.italic ? 'italic ' : ''}${opts.bold ? 'bold ' : ''}${opts.fontSize}px ${family}`;
        return (s) => ctx.measureText(s).width + [...s].length * spacing;
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
        if (wrap) lines.push(...wrapByMeasure(para, measure, opts.maxWidth!));
        else lines.push(para);
    }
    let width = 0;
    for (const line of lines) width = Math.max(width, measure(line));
    return { width, lineCount: lines.length, height: lines.length * lineHeight };
}
