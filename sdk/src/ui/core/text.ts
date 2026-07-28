// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, enumOptions } from '../../ecs/component';
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

/** Glyph pipeline for a Text. */
export const TextRenderMode = {
    /** Hinted bitmap while the entity is unscaled, SDF once it scales. */
    Auto: 0,
    /** Canvas2D native AA at the on-screen pixel size. Sharpest when static. */
    Bitmap: 1,
    /** Signed-distance field — a stable ~1px edge at any scale/zoom. */
    Sdf: 2,
} as const;
export type TextRenderMode = (typeof TextRenderMode)[keyof typeof TextRenderMode];

export interface TextData {
    content: string;
    /**
     * Localization key. Non-empty ⇒ `content` is DERIVED: every frame the
     * text-localization system resolves the key through the app's Localization
     * resource (opt-in plugin) and writes the result into `content`, so a
     * `setLocale` re-flows every bound label. Empty (default) or no
     * Localization resource ⇒ `content` stands as authored.
     */
    i18nKey: string;
    /**
     * A font asset the game SHIPS (`.ttf` / `.otf` / `.woff`). When set it wins
     * over {@link fontFamily}: the loader registers the file with the platform's
     * text stack and this handle resolves back to that family. Leave it empty to
     * name a font the host already has, through `fontFamily`.
     */
    font: number;
    /** Font family resolved by the platform's text stack — a font the HOST
     *  already has. For a font you ship, use {@link font} instead. */
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
    renderMode: TextRenderMode;
    /** Render toggle — the editor's eye and runtime hiding both flip this. */
    enabled: boolean;
}

export const Text = defineComponent<TextData>('Text', {
    content: '',
    i18nKey: '',
    font: 0,
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
    enabled: true,
}, {
    // A shipped font is a real asset reference: declaring it here is what gives
    // it dependency tracking, cook inclusion, `@uuid:` refs and hot-update for
    // free — the same machinery every other asset slot rides.
    assetFields: [{ field: 'font', type: 'font' }],
    fields: {
        font: { label: 'Font', tooltip: 'A font file this project ships (.ttf / .otf). Overrides Font Family when set; leave empty to use a font the host already has.' },
        fontFamily: { tooltip: 'A font the HOST already has (system or page-loaded). Ignored when Font is set.' },
        i18nKey: { label: 'I18n Key', enumSource: 'localeKeys', tooltip: 'Localization key — when set, content is resolved from the Localization catalogs (and re-resolved on locale switch). Leave empty for plain text.' },
        align: { enum: enumOptions(TextAlign), tooltip: 'Horizontal alignment: within the layout box when the entity has a UINode, else it anchors the text to the entity origin (left/center/right edge).' },
        verticalAlign: { enum: enumOptions(TextVerticalAlign), tooltip: 'Vertical alignment: within the layout box when the entity has a UINode, else it anchors the text to the entity origin (top/middle/bottom).' },
        overflow: { enum: enumOptions(TextOverflow) },
        renderMode: { enum: enumOptions(TextRenderMode) },
    },
});
