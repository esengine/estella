// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/text-params.ts
 * @brief   What a `Text` component asks of the text renderer, derived in one place.
 *
 * Every path that lays a Text out (the retained labels, the per-frame fallback, the inline images that must
 * track the glyphs) reads the component through here. A field a Text gains is threaded once; written out per
 * path, each new field reached some of them and not others.
 */
import type { TextData } from '../core/text';
import type { RGBA } from './layout';
import type { DrawTextParams } from './text-renderer';
import { fontAscent } from './bitmap-font';
import { DEFAULT_ASCENT, rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';

/** The box a Text is laid out in, and where the entity origin sits in it (see `textFrame`). */
export interface TextBoxFrame {
    w: number;
    h: number;
    /** Pivot as a fraction from the box's left / bottom edge. */
    px: number;
    py: number;
}

/** Bold and italic as the style bits the glyph atlas keys on. */
export function textStyleBits(t: Pick<TextData, 'bold' | 'italic'>): number {
    return (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
}

/** `Text.lineHeight` is a ratio of the font size; layout wants px. Undefined leaves layout its default. */
export function textLineHeightPx(t: Pick<TextData, 'lineHeight' | 'fontSize'>): number | undefined {
    return t.lineHeight > 0 ? t.lineHeight * t.fontSize : undefined;
}

/** `Text.letterSpacing` in px, or undefined for none: data saved before the field, and a value that is no number, are none. */
export function textLetterSpacingPx(t: Pick<TextData, 'letterSpacing'>): number | undefined {
    const spacing = t.letterSpacing;
    return typeof spacing === 'number' && Number.isFinite(spacing) && spacing !== 0 ? spacing : undefined;
}

/** The part of a layout request that is where the box is and how wide a line may run. */
export interface TextBoxPlacement {
    originX?: number;
    originY?: number;
    maxWidth?: number;
    boxWidth?: number;
    boxHeight?: number;
}

/** Where the text block starts and what it aligns and wraps inside. A frame of no size is no box: the entity origin is the anchor. */
export function textBoxPlacement(t: Pick<TextData, 'fontSize' | 'wordWrap'>, family: string, frame: TextBoxFrame): TextBoxPlacement {
    if (!(frame.w > 0 || frame.h > 0)) return {};
    const box = rectTextBox(frame.px, frame.py, frame.w, frame.h, t.fontSize, fontAscent(family, DEFAULT_ASCENT));
    return {
        originX: box.originX,
        originY: box.originY,
        boxWidth: box.maxWidth, // align within the box regardless of word-wrap
        boxHeight: box.boxHeight,
        maxWidth: t.wordWrap ? box.maxWidth : undefined, // wrap only when enabled
    };
}

/**
 * Everything the renderer needs to lay out and colour one Text, except the opacity it inherits from its subtree.
 *
 * @param family the resolved family (`resolveTextFamily`), since a shipped font and a named one arrive differently.
 * @param frame  the box from `textFrame`.
 */
export function textDrawParams(t: TextData, family: string, frame: TextBoxFrame): DrawTextParams {
    // A blur with no offset is still a shadow (a halo centred on the glyphs), so it counts as one.
    const shadow = t.shadowColor.a > 0 && (t.shadowOffsetX !== 0 || t.shadowOffsetY !== 0 || t.shadowBlur > 0)
        ? {
            color: [t.shadowColor.r, t.shadowColor.g, t.shadowColor.b, t.shadowColor.a] as RGBA,
            dx: t.shadowOffsetX,
            dy: t.shadowOffsetY,
            blur: t.shadowBlur,
        }
        : undefined;
    const outline = t.strokeWidth > 0 && t.strokeColor.a > 0
        ? { color: [t.strokeColor.r, t.strokeColor.g, t.strokeColor.b, t.strokeColor.a] as RGBA, width: t.strokeWidth }
        : undefined;
    return {
        text: t.content,
        fontFamily: family,
        fontSizePx: t.fontSize,
        color: [t.color.r, t.color.g, t.color.b, t.color.a],
        style: textStyleBits(t),
        richText: t.richText,
        align: t.align,
        verticalAlign: t.verticalAlign,
        lineHeight: textLineHeightPx(t),
        letterSpacing: textLetterSpacingPx(t),
        overflow: t.overflow,
        underline: !!t.underline,
        ...textBoxPlacement(t, family, frame),
        shadow,
        outline,
    };
}
