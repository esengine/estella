// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, enumOptions } from '../../ecs/component';
import type { Color } from '../../types';
import { TextAlign, TextRenderMode } from '../core/text';

export interface TextInputData {
    value: string;
    placeholder: string;
    placeholderColor: Color;
    /** A font asset the game SHIPS. When set it wins over {@link fontFamily},
     *  exactly as `Text.font` does — a field on a skinned panel is drawn in the
     *  game's own typeface, not in whatever the host happens to have. */
    font: number;
    fontFamily: string;
    fontSize: number;
    color: Color;
    backgroundColor: Color;
    padding: number;
    maxLength: number;
    multiline: boolean;
    password: boolean;
    readOnly: boolean;
    focused: boolean;
    cursorPos: number;
    dirty: boolean;
    /** Where the value sits in the field: Left, Center or Right. A single line
     *  keeps the alignment only while it fits — past that the field scrolls to
     *  follow the caret, as a left-aligned one always has. */
    textAlign: TextAlign;
    /** Glyph pipeline for the field text — mirrors Text.renderMode, propagated to
     *  the child Text the input plugin renders through (Auto / Bitmap / Sdf). */
    renderMode: TextRenderMode;
}

export const TextInput = defineComponent<TextInputData>('TextInput', {
    value: '',
    placeholder: '',
    placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
    font: 0,
    fontFamily: '',
    fontSize: 16,
    color: { r: 1, g: 1, b: 1, a: 1 },
    backgroundColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
    padding: 6,
    maxLength: 0,
    multiline: false,
    password: false,
    readOnly: false,
    focused: false,
    cursorPos: 0,
    dirty: true,
    textAlign: TextAlign.Left,
    renderMode: TextRenderMode.Auto,
}, {
    assetFields: [{ field: 'font', type: 'font' }],
    fields: {
        font: { label: 'Font', tooltip: 'A font file this project ships (.ttf / .otf). Overrides Font Family when set; leave empty to use a font the host already has.' },
        fontFamily: { tooltip: 'A font the HOST already has (system or page-loaded). Ignored when Font is set.' },
        textAlign: {
            enum: enumOptions(TextAlign),
            tooltip: 'Where the value sits in the field. A single line holds the alignment while it fits, then scrolls to follow the caret.',
        },
        renderMode: {
            enum: enumOptions(TextRenderMode),
            tooltip: 'Glyph pipeline for the field text — Auto (hinted bitmap when unscaled, SDF once scaled), always Bitmap, or always SDF.',
        },
    },
});
