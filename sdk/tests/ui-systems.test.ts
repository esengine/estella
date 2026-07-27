// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { driverStateFor, type UIInteractionData } from '../src/ui';

const inter = (hovered: boolean, pressed: boolean): UIInteractionData => ({
    hovered, pressed, justPressed: false, justReleased: false,
});

describe('driverStateFor', () => {
    it('returns "disabled" when the component is disabled regardless of input', () => {
        expect(driverStateFor(false, null)).toBe('disabled');
        expect(driverStateFor(false, inter(true, true))).toBe('disabled');
    });

    it('returns "pressed" when the pointer is pressing', () => {
        expect(driverStateFor(true, inter(true, true))).toBe('pressed');
        expect(driverStateFor(true, inter(false, true))).toBe('pressed');
    });

    it('returns "hover" when only hovered', () => {
        expect(driverStateFor(true, inter(true, false))).toBe('hover');
    });

    it('shows "focused" only for VISIBLE focus, and never over pointer state', () => {
        // The third argument is `:focus-visible`, not "has focus". A pointer press
        // focuses too, and a button that keeps the focus look after a click stays
        // lit long after the pointer has gone — which is what this ranking prevents.
        expect(driverStateFor(true, inter(false, false), true)).toBe('focused');
        expect(driverStateFor(true, inter(false, false), false)).toBe('normal');
        // Pointer state still wins while the pointer is actually there.
        expect(driverStateFor(true, inter(true, false), true)).toBe('hover');
        expect(driverStateFor(true, inter(true, true), true)).toBe('pressed');
        expect(driverStateFor(false, inter(false, false), true)).toBe('disabled');
    });

    it('returns "normal" when idle or no interaction data', () => {
        expect(driverStateFor(true, inter(false, false))).toBe('normal');
        expect(driverStateFor(true, null)).toBe('normal');
    });
});
