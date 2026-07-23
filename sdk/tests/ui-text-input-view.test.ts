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
import { textFieldDisplay, maskedPrefix, fieldSelection, nearestCaretIndex } from '../src/ui/text/text-input-view';

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
