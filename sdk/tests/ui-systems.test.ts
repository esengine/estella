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

    it('returns "normal" when idle or no interaction data', () => {
        expect(driverStateFor(true, inter(false, false))).toBe('normal');
        expect(driverStateFor(true, null)).toBe('normal');
    });
});
