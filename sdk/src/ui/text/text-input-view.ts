// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/text-input-view.ts
 * @brief   Pure derivation of *what a text field shows* — the glyph string,
 *          whether it is the placeholder, and the (already-masked) substring
 *          before the caret whose width positions the caret. Kept pure (no ECS,
 *          DOM or engine) so the placeholder / password / caret-offset rules are
 *          unit-testable; the input plugin feeds it the effective value + caret
 *          (which, while an IME composition is active, come straight from the
 *          hidden textarea so the preedit renders live).
 */

export interface TextFieldDisplay {
    /** The glyph string to render: the value, the placeholder when empty, or a
     *  run of bullets when the field is a password. */
    text: string;
    /** True when {@link text} is the placeholder (drives placeholder color). */
    isPlaceholder: boolean;
    /** The substring up to the caret — already password-masked — whose measured
     *  width places the caret and drives horizontal scroll. Empty for the
     *  placeholder (an empty field parks the caret at the left edge). */
    beforeCaret: string;
}

/**
 * Resolve the shown text + caret prefix for a field with `value` and caret index
 * `caret`. Empty ⇒ the placeholder (caret at the origin); password ⇒ every glyph
 * is `bullet`, including the caret prefix, so the caret still lands between
 * masked characters. Pure.
 */
export function textFieldDisplay(
    value: string,
    caret: number,
    password: boolean,
    placeholder: string,
    bullet: string,
): TextFieldDisplay {
    if (value.length === 0) {
        return { text: placeholder, isPlaceholder: true, beforeCaret: '' };
    }
    const clamped = Math.max(0, Math.min(caret, value.length));
    if (password) {
        return { text: bullet.repeat(value.length), isPlaceholder: false, beforeCaret: bullet.repeat(clamped) };
    }
    return { text: value, isPlaceholder: false, beforeCaret: value.slice(0, clamped) };
}
