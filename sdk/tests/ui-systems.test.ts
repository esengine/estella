// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    driverStateFor,
    findStateSlot,
    TransitionFlag,
    visualState,
    type StateVisualsData,
    type UIInteractionData,
} from '../src/ui';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const named = (...names: string[]) => names.map(n => visualState(n, WHITE));

const sv = (overrides: Partial<StateVisualsData> = {}): StateVisualsData => ({
    targetGraphic: 0 as never,
    transitionFlags: 0,
    fadeDuration: 0,
    states: [],
    ...overrides,
});

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

describe('findStateSlot', () => {
    it('returns -1 when state is the empty string', () => {
        expect(findStateSlot(sv({ states: named('normal') }), '')).toBe(-1);
    });

    it('returns the index of the matching state', () => {
        const data = sv({ states: named('normal', 'hover', 'pressed') });
        expect(findStateSlot(data, 'normal')).toBe(0);
        expect(findStateSlot(data, 'hover')).toBe(1);
        expect(findStateSlot(data, 'pressed')).toBe(2);
    });

    it('returns -1 when no state matches', () => {
        expect(findStateSlot(sv({ states: named('normal') }), 'loading')).toBe(-1);
    });

    it('returns -1 when the states list is empty', () => {
        expect(findStateSlot(sv(), 'any')).toBe(-1);
    });

    it('returns the first match when names collide', () => {
        const data = sv({ states: named('a', 'x', 'b', 'x') });
        expect(findStateSlot(data, 'x')).toBe(1);
    });
});

describe('TransitionFlag composability', () => {
    it('composable via bitwise OR', () => {
        const flags = TransitionFlag.ColorTint | TransitionFlag.Scale;
        expect(flags & TransitionFlag.ColorTint).toBeTruthy();
        expect(flags & TransitionFlag.Scale).toBeTruthy();
        expect(flags & TransitionFlag.SpriteSwap).toBe(0);
    });
});
