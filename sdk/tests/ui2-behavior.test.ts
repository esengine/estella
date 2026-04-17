import { describe, it, expect } from 'vitest';
import {
    StateMachine,
    StateVisuals,
    TransitionFlag,
    STATE_VISUALS_SLOT_COUNT,
    Interactable,
    UIInteraction,
    Focusable,
    Draggable,
} from '../src/ui2';

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

        it('exposes exactly 8 slots', () => {
            expect(STATE_VISUALS_SLOT_COUNT).toBe(8);
            const d = StateVisuals._default as Record<string, unknown>;
            for (let i = 0; i < 8; i++) {
                expect(d[`slot${i}Name`]).toBe('');
                expect(d[`slot${i}Color`]).toEqual({ r: 1, g: 1, b: 1, a: 1 });
                expect(d[`slot${i}Sprite`]).toBe(0);
                expect(d[`slot${i}Scale`]).toBe(1);
            }
        });

        it('declares targetGraphic as an entity reference for serialization', () => {
            // EHT populates entityFields from ES_PROPERTY(entity_ref)
            expect(StateVisuals.entityFields).toContain('targetGraphic');
        });

        it('declares each slot color for editor color-picker detection', () => {
            for (let i = 0; i < 8; i++) {
                expect(StateVisuals.colorKeys).toContain(`slot${i}Color`);
            }
        });

        it('declares each slot sprite as a texture asset field', () => {
            const fields = StateVisuals.assetFields.map((f) => f.field);
            for (let i = 0; i < 8; i++) {
                expect(fields).toContain(`slot${i}Sprite`);
            }
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
