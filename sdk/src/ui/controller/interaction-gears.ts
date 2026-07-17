// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/interaction-gears.ts
 * @brief   Fold per-state visual overrides into `$interaction` gear bindings.
 *
 * Controller-layer sugar shared by every consumer that authors interaction
 * visuals — the button/toggle factories and the dropdown popup rows built by
 * the behavior system.
 */
import type { Color } from '../../types';
import { EasingType } from '../../animation/Easing';
import { INTERACTION_CONTROLLER } from './ui-controller';
import { gearBinding, type GearBinding, type GearValue } from './ui-gear';

/**
 * Visual overrides for a single interaction state. Omitted fields leave the
 * live value alone on that state (the gear's sparse-page semantics).
 */
export interface ButtonStateVisual {
    color?: Color;
    sprite?: number;
    scale?: number;
}

/**
 * Fold the state-name → override record into per-field gear bindings on the
 * `$interaction` controller. A field a state doesn't override gets no page
 * entry there (sparse pages: the gear leaves it alone). Sprite swaps are
 * discrete and always snap; color and scale tween over `fadeDuration`.
 */
export function interactionGears(
    states: Record<string, ButtonStateVisual>,
    fadeDuration = 0,
): GearBinding[] {
    const color: Record<string, GearValue> = {};
    const sprite: Record<string, GearValue> = {};
    const scale: Record<string, GearValue> = {};
    for (const [page, v] of Object.entries(states)) {
        if (v.color !== undefined) color[page] = { ...v.color };
        if (v.sprite !== undefined) sprite[page] = v.sprite;
        if (v.scale !== undefined) scale[page] = { x: v.scale, y: v.scale, z: 1 };
    }
    const tween = fadeDuration > 0
        ? { easing: EasingType.Linear, duration: fadeDuration }
        : undefined;

    const bindings: GearBinding[] = [];
    if (Object.keys(color).length > 0) {
        bindings.push(gearBinding(INTERACTION_CONTROLLER, 'UIVisual', 'color', color, tween));
    }
    if (Object.keys(sprite).length > 0) {
        bindings.push(gearBinding(INTERACTION_CONTROLLER, 'UIVisual', 'texture', sprite));
    }
    if (Object.keys(scale).length > 0) {
        bindings.push(gearBinding(INTERACTION_CONTROLLER, 'Transform', 'scale', scale, tween));
    }
    return bindings;
}
