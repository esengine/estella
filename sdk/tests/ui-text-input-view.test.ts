// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure display derivation for the TextInput plugin: placeholder / password
 *        masking and the caret-prefix that positions the caret. The plugin feeds
 *        this the *effective* value + caret — which, mid-IME-composition, are the
 *        hidden textarea's live preedit — so covering the branches here covers
 *        the preedit render path too.
 */
import { describe, it, expect } from 'vitest';
import { textFieldDisplay } from '../src/ui/text/text-input-view';

const BULLET = '●';

describe('textFieldDisplay', () => {
    it('shows the placeholder for an empty value (caret parks at the origin)', () => {
        expect(textFieldDisplay('', 0, false, 'Your name', BULLET)).toEqual({
            text: 'Your name', isPlaceholder: true, beforeCaret: '',
        });
    });

    it('an empty password field still shows the placeholder (empty wins over masking)', () => {
        expect(textFieldDisplay('', 0, true, 'Password', BULLET)).toEqual({
            text: 'Password', isPlaceholder: true, beforeCaret: '',
        });
    });

    it('renders the value verbatim with the caret prefix up to the caret index', () => {
        expect(textFieldDisplay('hello', 3, false, 'ph', BULLET)).toEqual({
            text: 'hello', isPlaceholder: false, beforeCaret: 'hel',
        });
    });

    it('clamps a caret past the end so the prefix is the whole value', () => {
        expect(textFieldDisplay('hi', 99, false, 'ph', BULLET).beforeCaret).toBe('hi');
    });

    it('clamps a negative caret to the origin', () => {
        expect(textFieldDisplay('hi', -5, false, 'ph', BULLET).beforeCaret).toBe('');
    });

    it('masks a password value AND its caret prefix bullet-for-bullet', () => {
        const d = textFieldDisplay('secret', 4, true, 'ph', BULLET);
        expect(d.text).toBe(BULLET.repeat(6));
        expect(d.beforeCaret).toBe(BULLET.repeat(4));
        expect(d.isPlaceholder).toBe(false);
    });

    it('treats a live IME preedit as ordinary text (the plugin passes the composed value + caret)', () => {
        // Mid-composition the plugin passes textarea.value ("ab你好") + selectionStart (4).
        expect(textFieldDisplay('ab你好', 4, false, 'ph', BULLET)).toEqual({
            text: 'ab你好', isPlaceholder: false, beforeCaret: 'ab你好',
        });
    });
});
