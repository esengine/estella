// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { measureText, type MeasureTextOptions, type TextMetrics } from './measure-text';
import { wrapByMeasure } from './layout';

/** A computed UINode text box, in local display pixels. @experimental */
export interface TextInspectionOptions extends MeasureTextOptions {
    width: number;
    height: number;
    wordWrap?: boolean;
    richText?: boolean;
    customFont?: boolean;
}

/** Overflow before the renderer applies Clip / Ellipsis. @experimental */
export interface TextInspection {
    metrics: TextMetrics | null;
    horizontalOverflow: boolean;
    verticalOverflow: boolean;
    /** These cases require visual verification rather than an automatic pass. */
    unsupported: 'rich-text' | 'custom-font' | 'complex-script' | 'invalid-box' | null;
}

/**
 * Inspect ordinary glyph-atlas text using individual glyph advances, as the
 * renderer does. Results depend on the host font; custom bitmap fonts and
 * shaped scripts deliberately return no automatic verdict. @experimental
 */
export function inspectTextLayout(text: string, opts: TextInspectionOptions): TextInspection {
    const unsupported = !Number.isFinite(opts.width) || !Number.isFinite(opts.height)
        || opts.width <= 0 || opts.height <= 0 || !Number.isFinite(opts.fontSize) || opts.fontSize <= 0
        || (opts.lineHeight !== undefined && (!Number.isFinite(opts.lineHeight) || opts.lineHeight <= 0))
        ? 'invalid-box' : opts.richText ? 'rich-text' : opts.customFont ? 'custom-font'
        : /[\u0300-\u036f\u0590-\u08ff\u0900-\u0fff\u200c-\u200f\u202a-\u202e\u2066-\u2069]/u.test(text) ? 'complex-script' : null;
    if (unsupported) return { metrics: null, horizontalOverflow: false, verticalOverflow: false, unsupported };
    const advances = new Map<string, number>();
    const widthOf = (line: string): number => [...line].reduce((sum, ch) => {
        let advance = advances.get(ch);
        if (advance === undefined) {
            advance = measureText(ch, { ...opts, maxWidth: undefined }).width;
            advances.set(ch, advance);
        }
        return sum + advance;
    }, 0);
    const lines = text.split('\n').flatMap((line) => opts.wordWrap ? wrapByMeasure(line, widthOf, opts.width) : [line]);
    const metrics = {
        width: lines.reduce((width, line) => Math.max(width, widthOf(line)), 0),
        height: lines.length * (opts.lineHeight ?? opts.fontSize * 1.2),
        lineCount: lines.length,
    };
    return { metrics, horizontalOverflow: metrics.width > opts.width + 0.01,
        verticalOverflow: metrics.height > opts.height + 0.01, unsupported: null };
}
