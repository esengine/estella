// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure display + selection derivation for the TextInput plugin: placeholder
 *        / password masking, the masked prefix that positions the caret and
 *        selection edges, and the normalized selection range. The plugin feeds
 *        these the *effective* value + selection — which, while a field is
 *        focused, are the hidden textarea's live state (caret, IME preedit,
 *        native shift/Ctrl-A selection) — so covering the branches here covers
 *        the caret / preedit / selection render paths.
 */
import { describe, it, expect } from 'vitest';
import {
    textFieldDisplay, maskedPrefix, fieldSelection, nearestCaretIndex, alignOffset,
    splitLines, caretLineCol, lineSelections, imeAnchorCss,
} from '../src/ui/text/text-input-view';

const BULLET = '●';

describe('textFieldDisplay', () => {
    it('shows the placeholder for an empty value', () => {
        expect(textFieldDisplay('', false, 'Your name', BULLET)).toEqual({ text: 'Your name', isPlaceholder: true });
    });

    it('an empty password field still shows the placeholder (empty wins over masking)', () => {
        expect(textFieldDisplay('', true, 'Password', BULLET)).toEqual({ text: 'Password', isPlaceholder: true });
    });

    it('renders the value verbatim when not a password', () => {
        expect(textFieldDisplay('hello 你好', false, 'ph', BULLET)).toEqual({ text: 'hello 你好', isPlaceholder: false });
    });

    it('masks the whole value bullet-for-bullet for a password', () => {
        expect(textFieldDisplay('secret', true, 'ph', BULLET)).toEqual({ text: BULLET.repeat(6), isPlaceholder: false });
    });
});

describe('maskedPrefix', () => {
    it('is the value sliced to the index', () => {
        expect(maskedPrefix('hello', 3, false, BULLET)).toBe('hel');
    });

    it('clamps past the end and below zero', () => {
        expect(maskedPrefix('hi', 99, false, BULLET)).toBe('hi');
        expect(maskedPrefix('hi', -5, false, BULLET)).toBe('');
    });

    it('masks the prefix bullet-for-bullet for a password', () => {
        expect(maskedPrefix('secret', 4, true, BULLET)).toBe(BULLET.repeat(4));
    });

    it('treats a live IME preedit as ordinary text (plugin passes textarea value)', () => {
        expect(maskedPrefix('ab你好', 4, false, BULLET)).toBe('ab你好');
    });
});

describe('fieldSelection', () => {
    it('a collapsed selection has no range; caret at the index', () => {
        expect(fieldSelection(3, 3, false, 10)).toEqual({ lo: 3, hi: 3, caret: 3, hasRange: false });
    });

    it('a forward selection parks the caret at the end', () => {
        expect(fieldSelection(2, 6, false, 10)).toEqual({ lo: 2, hi: 6, caret: 6, hasRange: true });
    });

    it('a backward selection parks the caret at the start', () => {
        expect(fieldSelection(6, 2, true, 10)).toEqual({ lo: 2, hi: 6, caret: 2, hasRange: true });
    });

    it('orders lo/hi regardless of argument order', () => {
        const a = fieldSelection(6, 2, false, 10);
        expect(a.lo).toBe(2);
        expect(a.hi).toBe(6);
    });

    it('clamps both ends into [0, len]', () => {
        expect(fieldSelection(-3, 99, false, 5)).toEqual({ lo: 0, hi: 5, caret: 5, hasRange: true });
    });

    it('a full select-all spans the whole value (Ctrl-A)', () => {
        expect(fieldSelection(0, 8, false, 8)).toEqual({ lo: 0, hi: 8, caret: 8, hasRange: true });
    });
});

describe('nearestCaretIndex', () => {
    // Prefix widths for a 4-char field where each char is 10px wide.
    const widths = [0, 10, 20, 30, 40];

    it('snaps a click to the nearest character boundary', () => {
        expect(nearestCaretIndex(widths, 0)).toBe(0);
        expect(nearestCaretIndex(widths, 12)).toBe(1);   // closest to 10
        expect(nearestCaretIndex(widths, 16)).toBe(2);   // closest to 20
        expect(nearestCaretIndex(widths, 40)).toBe(4);
    });

    it('clamps a click past the end to the last boundary', () => {
        expect(nearestCaretIndex(widths, 999)).toBe(4);
    });

    it('clamps a click before the start to 0', () => {
        expect(nearestCaretIndex(widths, -50)).toBe(0);
    });

    it('returns 0 for an empty field', () => {
        expect(nearestCaretIndex([0], 25)).toBe(0);
    });
});

describe('splitLines', () => {
    it('returns one line for a value with no newline', () => {
        expect(splitLines('hello')).toEqual([{ text: 'hello', start: 0 }]);
    });

    it('splits on \\n and records start indices', () => {
        expect(splitLines('ab\ncd\ne')).toEqual([
            { text: 'ab', start: 0 },
            { text: 'cd', start: 3 },
            { text: 'e', start: 6 },
        ]);
    });

    it('keeps empty lines (a trailing newline yields a trailing empty line)', () => {
        expect(splitLines('a\n')).toEqual([
            { text: 'a', start: 0 },
            { text: '', start: 2 },
        ]);
    });
});

describe('caretLineCol', () => {
    it('locates the caret on a single line', () => {
        expect(caretLineCol('hello', 3)).toEqual({ line: 0, col: 3, lineStart: 0 });
    });

    it('locates the caret on the second line', () => {
        expect(caretLineCol('ab\ncd', 4)).toEqual({ line: 1, col: 1, lineStart: 3 });
    });

    it('the end of a line (before its newline) stays on that line', () => {
        expect(caretLineCol('ab\ncd', 2)).toEqual({ line: 0, col: 2, lineStart: 0 });
    });

    it('the start of the next line (after the newline) is column 0 there', () => {
        expect(caretLineCol('ab\ncd', 3)).toEqual({ line: 1, col: 0, lineStart: 3 });
    });
});

describe('lineSelections', () => {
    it('a within-line selection is one span', () => {
        expect(lineSelections('hello', 1, 4)).toEqual([{ line: 0, from: 1, to: 4 }]);
    });

    it('a multi-line selection spans each line it covers', () => {
        // "ab\ncd\nef", select from index 1 ('b') through index 7 ('f').
        expect(lineSelections('ab\ncd\nef', 1, 7)).toEqual([
            { line: 0, from: 1, to: 2 }, // "b"
            { line: 1, from: 0, to: 2 }, // "cd"
            { line: 2, from: 0, to: 1 }, // "e"
        ]);
    });

    it('orders the endpoints and clamps', () => {
        expect(lineSelections('abc', 5, -2)).toEqual([{ line: 0, from: 0, to: 3 }]);
    });

    it('an empty selection yields no spans', () => {
        expect(lineSelections('abc', 2, 2)).toEqual([]);
    });
});

describe('imeAnchorCss', () => {
    it('flips GL bottom-up device px into top-down CSS px (dpr 1)', () => {
        // screenH 600, a point 100px up from the bottom → 500px down from the top.
        expect(imeAnchorCss(200, 100, 600, 1)).toEqual({ left: 200, top: 500 });
    });

    it('divides by the device pixel ratio', () => {
        expect(imeAnchorCss(400, 200, 1200, 2)).toEqual({ left: 200, top: 500 });
    });

    it('is the exact inverse of the hit-test mapping (mouseX*dpr, screenH − mouseY*dpr)', () => {
        const cssX = 137, cssY = 88, screenH = 600, dpr = 1.5;
        const glX = cssX * dpr, glY = screenH - cssY * dpr;
        const back = imeAnchorCss(glX, glY, screenH, dpr);
        expect(back.left).toBeCloseTo(cssX, 6);
        expect(back.top).toBeCloseTo(cssY, 6);
    });

    it('guards a zero dpr', () => {
        expect(imeAnchorCss(200, 100, 600, 0)).toEqual({ left: 200, top: 500 });
    });
});

describe('alignOffset', () => {
    it('leaves a left-aligned line at the start of the box', () => {
        expect(alignOffset(0, 200, 40)).toBe(0);
        expect(alignOffset(0, 200, 400)).toBe(0);
    });

    it('splits the slack for center and hands it all over for right', () => {
        expect(alignOffset(1, 200, 40)).toBe(80);
        expect(alignOffset(2, 200, 40)).toBe(160);
    });

    it('collapses to zero once the line fills the box, so the scroll takes over', () => {
        // The caret has to stay reachable: past the box width the field scrolls,
        // and an offset that kept centring would drag the text off both edges.
        expect(alignOffset(1, 200, 200)).toBe(0);
        expect(alignOffset(1, 200, 500)).toBe(0);
        expect(alignOffset(2, 200, 500)).toBe(0);
    });

    it('survives a degenerate box', () => {
        expect(alignOffset(1, 0, 40)).toBe(0);
        expect(alignOffset(2, -10, 40)).toBe(0);
    });
});
