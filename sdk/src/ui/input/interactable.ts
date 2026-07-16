// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/input/interactable.ts
 * @brief   Input concept primitives: Interactable (hit-test gate config) and
 *          UIInteraction (per-frame pointer state written by the hit-test
 *          system). Foundation that controllers + drag/focus build on.
 */
import { defineBuiltin } from '../../component';

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
// never persisted. The hit-test getOrEmplaces it on demand.
export const UIInteraction = defineBuiltin<UIInteractionData>('UIInteraction', {
    hovered: false,
    pressed: false,
    justPressed: false,
    justReleased: false,
}, { transient: true });
