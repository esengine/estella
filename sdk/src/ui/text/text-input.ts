// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, enumOptions } from '../../ecs/component';
import type { Color } from '../../types';
import { TextAlign, TextRenderMode } from '../core/text';

/**
 * Which characters a field accepts as they are typed or pasted. The rest never reach `value`: they are
 * removed from the field itself, so what is on screen and what a script reads are the same.
 */
export const TextInputFilter = {
    /** Anything. */
    None: 0,
    /** Only 0-9, for a count or a price. */
    Digits: 1,
    /** 0-9, a point and a minus sign, for a number that may have a fraction or be negative. */
    Decimal: 2,
    /** 0-9 and the characters of a phone number: + * # and -. */
    Phone: 3,
} as const;
export type TextInputFilter = typeof TextInputFilter[keyof typeof TextInputFilter];

/** `value` with the characters the filter does not allow taken out. */
export function applyTextInputFilter(value: string, filter: TextInputFilter | undefined): string {
    switch (filter) {
        case TextInputFilter.Digits: return value.replace(/[^0-9]/g, '');
        case TextInputFilter.Decimal: return value.replace(/[^0-9.\-]/g, '');
        case TextInputFilter.Phone: return value.replace(/[^0-9+*#\-]/g, '');
        default: return value;
    }
}

export interface TextInputData {
    value: string;
    placeholder: string;
    /** Optional catalog key for the displayed hint. Does not change the value or authored placeholder. */
    placeholderI18nKey?: string;
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
    /** Characters the field accepts; see {@link TextInputFilter}. */
    inputFilter: TextInputFilter;
    multiline: boolean;
    password: boolean;
    readOnly: boolean;
    focused: boolean;
    cursorPos: number;
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
    placeholderI18nKey: '',
    placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
    font: 0,
    fontFamily: '',
    fontSize: 16,
    color: { r: 1, g: 1, b: 1, a: 1 },
    backgroundColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
    padding: 6,
    maxLength: 0,
    inputFilter: TextInputFilter.None,
    multiline: false,
    password: false,
    readOnly: false,
    focused: false,
    cursorPos: 0,
    textAlign: TextAlign.Left,
    renderMode: TextRenderMode.Auto,
}, {
    assetFields: [{ field: 'font', type: 'font' }],
    fields: {
        placeholderI18nKey: { label: 'Placeholder I18n Key', enumSource: 'localeKeys', tooltip: 'Translate the empty-field hint through the Localization resource. Leave empty for a literal placeholder.' },
        font: { label: 'Font', tooltip: 'A font file this project ships (.ttf / .otf). Overrides Font Family when set; leave empty to use a font the host already has.' },
        fontFamily: { tooltip: 'A font the HOST already has (system or page-loaded). Ignored when Font is set.' },
        inputFilter: {
            enum: enumOptions(TextInputFilter),
            tooltip: 'Which characters the field accepts. Digits keeps only 0-9, whether typed or pasted, for a count or a price.',
        },
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
