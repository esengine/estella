import { describe, it, expect } from 'vitest';
import {
    driverStateFor,
    findStateSlot,
    TransitionFlag,
    type StateVisualsData,
    type UIInteractionData,
} from '../src/ui2';

const sv = (overrides: Partial<StateVisualsData> = {}): StateVisualsData => ({
    targetGraphic: 0 as never,
    transitionFlags: 0,
    fadeDuration: 0,
    slot0Name: '', slot0Color: { r: 1, g: 1, b: 1, a: 1 }, slot0Sprite: 0, slot0Scale: 1,
    slot1Name: '', slot1Color: { r: 1, g: 1, b: 1, a: 1 }, slot1Sprite: 0, slot1Scale: 1,
    slot2Name: '', slot2Color: { r: 1, g: 1, b: 1, a: 1 }, slot2Sprite: 0, slot2Scale: 1,
    slot3Name: '', slot3Color: { r: 1, g: 1, b: 1, a: 1 }, slot3Sprite: 0, slot3Scale: 1,
    slot4Name: '', slot4Color: { r: 1, g: 1, b: 1, a: 1 }, slot4Sprite: 0, slot4Scale: 1,
    slot5Name: '', slot5Color: { r: 1, g: 1, b: 1, a: 1 }, slot5Sprite: 0, slot5Scale: 1,
    slot6Name: '', slot6Color: { r: 1, g: 1, b: 1, a: 1 }, slot6Sprite: 0, slot6Scale: 1,
    slot7Name: '', slot7Color: { r: 1, g: 1, b: 1, a: 1 }, slot7Sprite: 0, slot7Scale: 1,
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
        expect(findStateSlot(sv({ slot0Name: 'normal' }), '')).toBe(-1);
    });

    it('returns the index of the matching slot', () => {
        const data = sv({
            slot0Name: 'normal',
            slot1Name: 'hover',
            slot2Name: 'pressed',
        });
        expect(findStateSlot(data, 'normal')).toBe(0);
        expect(findStateSlot(data, 'hover')).toBe(1);
        expect(findStateSlot(data, 'pressed')).toBe(2);
    });

    it('returns -1 when no slot matches', () => {
        expect(findStateSlot(sv({ slot0Name: 'normal' }), 'loading')).toBe(-1);
    });

    it('returns -1 for user-defined states in unused slots (all slots empty)', () => {
        expect(findStateSlot(sv(), 'any')).toBe(-1);
    });

    it('returns the first match when names collide', () => {
        const data = sv({ slot2Name: 'x', slot5Name: 'x' });
        expect(findStateSlot(data, 'x')).toBe(2);
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
