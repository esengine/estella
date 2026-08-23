// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, enumOptions } from '../../ecs/component';
import type { Color } from '../../types';

/**
 * Horizontal alignment. With a layout box it aligns inside the box; without one it
 * anchors the run relative to the entity's own position.
 *
 * @public
 */
export const TextAlign = {
    Left: 0,
    Center: 1,
    Right: 2,
} as const;
/** @public */
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];

/**
 * Vertical alignment, on the same rule as {@link TextAlign}: inside the box when
 * there is one, otherwise relative to the origin.
 *
 * @public
 */
export const TextVerticalAlign = {
    Top: 0,
    Middle: 1,
    Bottom: 2,
} as const;
/** @public */
export type TextVerticalAlign = (typeof TextVerticalAlign)[keyof typeof TextVerticalAlign];

/**
 * What a run too big for its box does. Needs a box: `Clip` and `Ellipsis` drop the
 * lines past the box height, and trim a line past the box width. Trimming is
 * whole-glyph — text does not go through a scissor, so a partial glyph is not
 * something this can draw.
 *
 * @public
 */
export const TextOverflow = {
    Visible: 0,
    Clip: 1,
    Ellipsis: 2,
} as const;
/** @public */
export type TextOverflow = (typeof TextOverflow)[keyof typeof TextOverflow];

/** Glyph pipeline for a Text.
 *  @public */
export const TextRenderMode = {
    /** Hinted bitmap while the entity is unscaled, SDF once it scales. */
    Auto: 0,
    /** Canvas2D native AA at the on-screen pixel size. Sharpest when static. */
    Bitmap: 1,
    /** Signed-distance field — a stable ~1px edge at any scale/zoom. */
    Sdf: 2,
} as const;
/** @public */
export type TextRenderMode = (typeof TextRenderMode)[keyof typeof TextRenderMode];

/**
 * {@link Text}'s fields. Alignment and `overflow` read differently with and
 * without a layout box — see {@link TextAlign} and {@link TextOverflow}.
 *
 * @public
 */
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
    /**
     * Draw layer, for a text with NO layout box — a label standing in the world
     * rather than inside a Canvas. It is read the same way Sprite.layer and
     * ShapeRenderer.layer are, so a label can be put in front of (or behind) the
     * world content around it.
     *
     * Ignored under a UINode: inside a Canvas the UI render order decides, and a
     * second knob there would let a text sort against its own panel.
     *
     * It exists because world text was pinned to layer 0 with no way off it, so
     * any ShapeRenderer or Sprite that also sat on layer 0 and drew later simply
     * covered it — a board hiding its own pieces, a name tag behind the character
     * it names — with nothing in the component to reach for.
     */
    layer: number;
    /** Render toggle — the editor's eye and runtime hiding both flip this. */
    enabled: boolean;
}

/**
 * A run of text. Under a `UINode` it lays out in that box; standing alone it draws
 * in the world at the entity's transform, anchored by its alignment. `content` is
 * derived rather than authored once `i18nKey` is set.
 *
 * @public
 */
export const Text = defineComponent<TextData>('Text', {
    content: '',
    i18nKey: '',
    font: 0,
    fontFamily: '',
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
    layer: 0,
    enabled: true,
}, {
    // Text draws itself (the plugin skips a disabled one) rather than through a
    // sibling UIVisual, so hiding an entity has to reach this flag — the same
    // declaration the C++ renderables make at their ES_COMPONENT site.
    renderableField: 'enabled',
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
        overflow: {
            enum: enumOptions(TextOverflow),
            tooltip: 'What text too big for its box does. Needs a layout box: Clip and Ellipsis drop the lines past its height and trim a line past its width.',
        },
        renderMode: { enum: enumOptions(TextRenderMode) },
        layer: { tooltip: 'Draw layer for a text standing in the WORLD (no UINode) — read like Sprite/ShapeRenderer layer, so a label can sit in front of the content around it. Ignored inside a Canvas, where the UI render order decides.' },
    },
});
