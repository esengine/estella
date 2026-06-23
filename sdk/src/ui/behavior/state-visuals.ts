// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/state-visuals.ts
 * @brief   StateVisuals — named state → visual overrides.
 *
 * A variable-length `states` list replaced the old 8 hardcoded `slotN*` field
 * quartets + stringly-keyed reflection. The apply system reads the entity's
 * StateMachine.current, finds the matching {@link VisualState} by name, and
 * applies its color/sprite/scale to `targetGraphic`. Mirrors the C++
 * `StateVisuals` builtin; `VisualState` mirrors the C++ POD (flat r/g/b/a so it
 * round-trips through the embind vector path).
 */
import { defineBuiltin } from '../../component';
import type { Color, Entity } from '../../types';

export const TransitionFlag = {
    None:       0,
    ColorTint:  1 << 0,
    SpriteSwap: 1 << 1,
    Scale:      1 << 2,
} as const;

export type TransitionFlag = (typeof TransitionFlag)[keyof typeof TransitionFlag];

/** One named visual state (mirrors the C++ VisualState; color is flat r/g/b/a). */
export interface VisualState {
    name: string;
    r: number;
    g: number;
    b: number;
    a: number;
    /** Texture-handle id for sprite swap; 0 = none. */
    sprite: number;
    scale: number;
}

export interface StateVisualsData {
    targetGraphic: Entity;
    transitionFlags: number;
    fadeDuration: number;
    states: VisualState[];
}

/** Build a {@link VisualState} from a name + Color (+ optional sprite/scale). */
export function visualState(
    name: string,
    color: Color,
    opts: { sprite?: number; scale?: number } = {},
): VisualState {
    return {
        name,
        r: color.r, g: color.g, b: color.b, a: color.a,
        sprite: opts.sprite ?? 0,
        scale: opts.scale ?? 1,
    };
}

export const StateVisuals = defineBuiltin<StateVisualsData>('StateVisuals', {
    targetGraphic: 0 as Entity,
    transitionFlags: 0,
    fadeDuration: 0,
    states: [],
});
