import { defineBuiltin } from '../../component';
import type { Color, Entity } from '../../types';

export const TransitionFlag = {
    None:       0,
    ColorTint:  1 << 0,
    SpriteSwap: 1 << 1,
    Scale:      1 << 2,
} as const;

export type TransitionFlag = (typeof TransitionFlag)[keyof typeof TransitionFlag];

export const STATE_VISUALS_SLOT_COUNT = 8;

export interface StateVisualsData {
    targetGraphic: Entity;
    transitionFlags: number;
    fadeDuration: number;

    slot0Name: string; slot0Color: Color; slot0Sprite: number; slot0Scale: number;
    slot1Name: string; slot1Color: Color; slot1Sprite: number; slot1Scale: number;
    slot2Name: string; slot2Color: Color; slot2Sprite: number; slot2Scale: number;
    slot3Name: string; slot3Color: Color; slot3Sprite: number; slot3Scale: number;
    slot4Name: string; slot4Color: Color; slot4Sprite: number; slot4Scale: number;
    slot5Name: string; slot5Color: Color; slot5Sprite: number; slot5Scale: number;
    slot6Name: string; slot6Color: Color; slot6Sprite: number; slot6Scale: number;
    slot7Name: string; slot7Color: Color; slot7Sprite: number; slot7Scale: number;
}

const WHITE = (): Color => ({ r: 1, g: 1, b: 1, a: 1 });

export const StateVisuals = defineBuiltin<StateVisualsData>('StateVisuals', {
    targetGraphic: 0 as Entity,
    transitionFlags: 0,
    fadeDuration: 0,

    slot0Name: '', slot0Color: WHITE(), slot0Sprite: 0, slot0Scale: 1,
    slot1Name: '', slot1Color: WHITE(), slot1Sprite: 0, slot1Scale: 1,
    slot2Name: '', slot2Color: WHITE(), slot2Sprite: 0, slot2Scale: 1,
    slot3Name: '', slot3Color: WHITE(), slot3Sprite: 0, slot3Scale: 1,
    slot4Name: '', slot4Color: WHITE(), slot4Sprite: 0, slot4Scale: 1,
    slot5Name: '', slot5Color: WHITE(), slot5Sprite: 0, slot5Scale: 1,
    slot6Name: '', slot6Color: WHITE(), slot6Sprite: 0, slot6Scale: 1,
    slot7Name: '', slot7Color: WHITE(), slot7Sprite: 0, slot7Scale: 1,
});
