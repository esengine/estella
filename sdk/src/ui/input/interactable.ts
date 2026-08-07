// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/input/interactable.ts
 * @brief   Input concept primitives: Interactable (hit-test gate config) and
 *          UIInteraction (per-frame pointer state written by the hit-test
 *          system). Foundation that controllers + drag/focus build on.
 */
import { defineBuiltin } from '../../ecs/component';
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import { Focusable } from './focusable';

export interface InteractableData {
    enabled: boolean;
    blockRaycast: boolean;
    raycastTarget: boolean;
}

export const Interactable = defineBuiltin<InteractableData>('Interactable', {
    enabled: true,
    blockRaycast: true,
    raycastTarget: true,
});

export interface UIInteractionData {
    hovered: boolean;
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
}

// Per-frame pointer state written by the hit-test system — never authored,
// never persisted. The hit-test getOrEmplaces it on demand. `transient` is
// declared at the C++ ES_COMPONENT site and arrives through COMPONENT_META.
export const UIInteraction = defineBuiltin<UIInteractionData>('UIInteraction', {
    hovered: false,
    pressed: false,
    justPressed: false,
    justReleased: false,
});

export interface WidgetInteractionInit {
    /** Start disabled (Interactable.enabled = false). */
    disabled?: boolean;
    /** Participate in Tab traversal + keyboard activation. Default true. */
    focusable?: boolean;
    /** Tab order within the focus ring. Default 0 (document order). */
    tabIndex?: number;
}

/**
 * The one interaction assembly every widget shares: a raycast-blocking
 * Interactable plus (by default) a Focusable so the control is keyboard-
 * reachable. Per-frame pointer state (UIInteraction) is transient — the
 * hit-test system creates it on demand, widgets never insert it.
 */
export function makeWidgetInteractable(
    world: World,
    entity: Entity,
    init: WidgetInteractionInit = {},
): void {
    world.insert(entity, Interactable, {
        enabled: !init.disabled,
        blockRaycast: true,
        raycastTarget: true,
    });
    if (init.focusable ?? true) {
        world.insert(entity, Focusable, { tabIndex: init.tabIndex ?? 0, isFocused: false });
    }
}
