// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    StateMachine,
    StateVisuals,
    TransitionFlag,
    Interactable,
    UIInteraction,
    Focusable,
    Draggable,
} from '../src/ui';

describe('ui2 behavior components', () => {
    describe('StateMachine', () => {
        it('registers as a builtin named "StateMachine"', () => {
            expect(StateMachine._builtin).toBe(true);
            expect(StateMachine._name).toBe('StateMachine');
        });

        it('defaults to empty current and previous', () => {
            expect(StateMachine._default).toEqual({ current: '', previous: '' });
        });
    });

    describe('StateVisuals', () => {
        it('registers as a builtin named "StateVisuals"', () => {
            expect(StateVisuals._builtin).toBe(true);
            expect(StateVisuals._name).toBe('StateVisuals');
        });

        it('defaults to an empty states list (variable-length, REARCH_GUI F5)', () => {
            const d = StateVisuals._default as { states: unknown[] };
            expect(Array.isArray(d.states)).toBe(true);
            expect(d.states).toHaveLength(0);
        });

        it('declares targetGraphic as an entity reference for serialization', () => {
            // EHT populates entityFields from ES_PROPERTY(entity_ref)
            expect(StateVisuals.entityFields).toContain('targetGraphic');
        });
    });

    describe('TransitionFlag', () => {
        it('defines composable bitmask values', () => {
            expect(TransitionFlag.None).toBe(0);
            expect(TransitionFlag.ColorTint).toBe(1);
            expect(TransitionFlag.SpriteSwap).toBe(2);
            expect(TransitionFlag.Scale).toBe(4);

            const combined = TransitionFlag.ColorTint | TransitionFlag.Scale;
            expect(combined & TransitionFlag.ColorTint).toBeTruthy();
            expect(combined & TransitionFlag.Scale).toBeTruthy();
            expect(combined & TransitionFlag.SpriteSwap).toBeFalsy();
        });
    });

    describe('re-exported behaviors', () => {
        it('Interactable points at the existing builtin', () => {
            expect(Interactable._builtin).toBe(true);
            expect(Interactable._name).toBe('Interactable');
        });

        it('UIInteraction points at the existing builtin', () => {
            expect(UIInteraction._builtin).toBe(true);
            expect(UIInteraction._name).toBe('UIInteraction');
        });

        it('Focusable is a user component (ts-side)', () => {
            expect(Focusable._builtin).toBe(false);
            expect(Focusable._name).toBe('Focusable');
        });

        it('Draggable is a user component (ts-side)', () => {
            expect(Draggable._builtin).toBe(false);
            expect(Draggable._name).toBe('Draggable');
        });
    });
});
