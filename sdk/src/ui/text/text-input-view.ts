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

/**
 * The caret index whose position is closest to text-space offset `x`, given
 * `prefixWidths[i]` = the measured width of the first `i` characters
 * (`prefixWidths[0] === 0`, length = value length + 1). Used to place the caret
 * where a pointer clicks inside the field. Pure. Returns 0 for an empty field.
 */
export function nearestCaretIndex(prefixWidths: readonly number[], x: number): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < prefixWidths.length; i++) {
        const d = Math.abs(prefixWidths[i] - x);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

/** Convert an on-screen point — device px, GL bottom-up, the space the UI
 *  hit-test / camera use — into CSS pixels (top-down) for positioning the hidden
 *  IME `<textarea>` so the OS candidate window anchors at the caret instead of
 *  the screen corner. Inverse of the hit-test's `mouseX*dpr`, `screenH −
 *  mouseY*dpr`. Pure. */
export function imeAnchorCss(screenX: number, screenY: number, screenH: number, dpr: number): { left: number; top: number } {
    const d = dpr > 0 ? dpr : 1;
    return { left: screenX / d, top: (screenH - screenY) / d };
}

/** A visual line of a multiline value: its text (no trailing `\n`) and the
 *  index in the full value where it starts. */
export interface VisualLine {
    text: string;
    start: number;
}

/** Split a value into its hard-broken (`\n`) visual lines with their start
 *  indices. Always at least one line. Pure. (Soft word-wrap is not modeled —
 *  the multiline field breaks on explicit newlines.) */
export function splitLines(value: string): VisualLine[] {
    const lines: VisualLine[] = [];
    let start = 0;
    for (;;) {
        const nl = value.indexOf('\n', start);
        if (nl < 0) { lines.push({ text: value.slice(start), start }); break; }
        lines.push({ text: value.slice(start, nl), start });
        start = nl + 1;
    }
    return lines;
}

/** Locate a caret index as a (line, column) in the `\n`-broken value. `column`
 *  is the offset within the line's text; `lineStart` is the line's start index
 *  so `value.slice(lineStart, caret)` is the prefix whose width places the
 *  caret on that line. Pure. */
export function caretLineCol(value: string, caret: number): { line: number; col: number; lineStart: number } {
    const c = Math.max(0, Math.min(caret, value.length));
    const lines = splitLines(value);
    for (let i = 0; i < lines.length; i++) {
        const end = lines[i].start + lines[i].text.length;
        if (c <= end) return { line: i, col: c - lines[i].start, lineStart: lines[i].start };
    }
    const last = lines[lines.length - 1];
    return { line: lines.length - 1, col: last.text.length, lineStart: last.start };
}

/** Per-line column span of a selection `[lo, hi]` over the `\n`-broken value:
 *  one entry per visual line that has selected text, giving the column range to
 *  highlight on that line. Used to draw one highlight rect per line. Pure. */
export function lineSelections(value: string, lo: number, hi: number): Array<{ line: number; from: number; to: number }> {
    const a = Math.max(0, Math.min(Math.min(lo, hi), value.length));
    const b = Math.max(0, Math.min(Math.max(lo, hi), value.length));
    const out: Array<{ line: number; from: number; to: number }> = [];
    const lines = splitLines(value);
    for (let i = 0; i < lines.length; i++) {
        const ls = lines[i].start;
        const le = ls + lines[i].text.length;
        const from = Math.max(a, ls);
        const to = Math.min(b, le);
        if (to > from) out.push({ line: i, from: from - ls, to: to - ls });
    }
    return out;
}

/**
 * How far into the inner box a line of `textW` starts, for `align` in `innerW`.
 *
 * A single-line field realizes its alignment through this offset rather than
 * through its child Text's own `align`, because the text layout aligns WITHOUT a
 * clamp: a value wider than the box would be centred and overflow both edges,
 * fighting the horizontal scroll that exists to keep the caret in view. Clamped
 * at zero, a field holds its alignment while the value is short and behaves
 * exactly as a left-aligned one once the value fills the box.
 *
 * It lives here because three things have to agree about it — where the glyphs
 * are drawn, where the caret and selection rect go, and which character a click
 * lands on. Align is 0 left / 1 center / 2 right, matching TextAlign.
 */
export function alignOffset(align: number, innerW: number, textW: number): number {
    const slack = Math.max(0, innerW - textW);
    return align === 1 ? slack / 2 : align === 2 ? slack : 0;
}
