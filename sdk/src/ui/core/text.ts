// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, enumOptions } from '../../component';
import type { Color } from '../../types';

export const TextAlign = {
    Left: 0,
    Center: 1,
    Right: 2,
} as const;
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];

export const TextVerticalAlign = {
    Top: 0,
    Middle: 1,
    Bottom: 2,
} as const;
export type TextVerticalAlign = (typeof TextVerticalAlign)[keyof typeof TextVerticalAlign];

export const TextOverflow = {
    Visible: 0,
    Clip: 1,
    Ellipsis: 2,
} as const;
export type TextOverflow = (typeof TextOverflow)[keyof typeof TextOverflow];

/**
 * Glyph pipeline for a Text (mirrors Unity's TMP-vs-UI-Text split, unified in
 * one component). Both pipelines share the atlas, layout, and batch path —
 * the difference is what the atlas stores and how the shader derives coverage.
 */
export const TextRenderMode = {
    /**
     * Per-frame choice: device-resolution bitmap when the text lands ~1:1 on
     * screen (crisp like the DOM), SDF whenever it's scaled — by the canvas
     * design-resolution fit, a zooming camera, or the entity transform.
     */
    Auto: 0,
    /** Canvas2D native AA at device resolution. Sharpest at 1:1; blurs when scaled. */
    Bitmap: 1,
    /** Signed-distance field, fwidth-smoothstep AA — a stable ~1px edge at any scale. */
    Sdf: 2,
} as const;
export type TextRenderMode = (typeof TextRenderMode)[keyof typeof TextRenderMode];

export interface TextData {
    content: string;
    fontFamily: string;
    fontSize: number;
    color: Color;
    align: TextAlign;
    verticalAlign: TextVerticalAlign;
    wordWrap: boolean;
    overflow: TextOverflow;
    lineHeight: number;
    bold: boolean;
    italic: boolean;
    strokeColor: Color;
    strokeWidth: number;
    shadowColor: Color;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    richText: boolean;
    /** Glyph pipeline: Auto (default) picks bitmap at 1:1, SDF when scaled. */
    renderMode: TextRenderMode;
}

export const Text = defineComponent<TextData>('Text', {
    content: '',
    fontFamily: 'Arial',
    fontSize: 24,
    color: { r: 1, g: 1, b: 1, a: 1 },
    align: TextAlign.Left,
    verticalAlign: TextVerticalAlign.Top,
    wordWrap: true,
    overflow: TextOverflow.Visible,
    lineHeight: 1.2,
    bold: false,
    italic: false,
    strokeColor: { r: 0, g: 0, b: 0, a: 1 },
    strokeWidth: 0,
    shadowColor: { r: 0, g: 0, b: 0, a: 1 },
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    richText: false,
    renderMode: TextRenderMode.Auto,
}, {
    // Editor dropdowns from the same constants the runtime switches on, so the
    // labels can never drift (the ParticleEmitter TS-enum precedent).
    fields: {
        align: { enum: enumOptions(TextAlign) },
        verticalAlign: { enum: enumOptions(TextVerticalAlign) },
        overflow: { enum: enumOptions(TextOverflow) },
        renderMode: { enum: enumOptions(TextRenderMode) },
    },
});
