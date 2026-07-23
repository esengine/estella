// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/text-input-view.ts
 * @brief   Pure derivation of *what a text field shows* — the glyph string, the
 *          masked substring before an index (whose width places the caret /
 *          selection edges), and the normalized selection range. Kept pure (no
 *          ECS, DOM or engine) so the placeholder / password / selection rules
 *          are unit-testable; the input plugin feeds it the effective value +
 *          selection, which — while a field is focused — come straight from the
 *          hidden textarea (the single source of truth for editing: caret moves,
 *          IME preedit, and native shift/Ctrl-A selection all land there).
 */

export interface TextFieldDisplay {
    /** The glyph string to render: the value, the placeholder when empty, or a
     *  run of bullets when the field is a password. */
    text: string;
    /** True when {@link text} is the placeholder (drives placeholder color). */
    isPlaceholder: boolean;
}

/** The shown glyphs for a field with `value`. Empty ⇒ the placeholder; password
 *  ⇒ one bullet per character. Pure. */
export function textFieldDisplay(
    value: string,
    password: boolean,
    placeholder: string,
    bullet: string,
): TextFieldDisplay {
    if (value.length === 0) return { text: placeholder, isPlaceholder: true };
    return { text: password ? bullet.repeat(value.length) : value, isPlaceholder: false };
}

/**
 * The (already password-masked) substring of `value` up to char `index`, whose
 * measured width positions the caret / a selection edge. `index` is clamped to
 * `[0, value.length]`; a password masks the prefix bullet-for-bullet so an edge
 * still lands between masked characters. Pure.
 */
export function maskedPrefix(value: string, index: number, password: boolean, bullet: string): string {
    const i = Math.max(0, Math.min(index, value.length));
    return password ? bullet.repeat(i) : value.slice(0, i);
}

export interface FieldSelection {
    /** Selection start (the lower index). */
    lo: number;
    /** Selection end (the higher index). */
    hi: number;
    /** The caret — the moving/focus end (`lo` for a backward selection, else `hi`). */
    caret: number;
    /** True when `lo < hi`, i.e. there is a range to highlight. */
    hasRange: boolean;
}

/**
 * Normalize a textarea selection (`selectionStart`, `selectionEnd`, direction)
 * into an ordered range + caret index, all clamped to `[0, len]`. The caret sits
 * at the focus end: the start for a backward (shift-left / shift-up) selection,
 * the end otherwise — matching where a native input parks the blinking caret.
 * Pure.
 */
export function fieldSelection(selStart: number, selEnd: number, backward: boolean, len: number): FieldSelection {
    const a = Math.max(0, Math.min(selStart, len));
    const b = Math.max(0, Math.min(selEnd, len));
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return { lo, hi, caret: backward ? lo : hi, hasRange: hi > lo };
}
