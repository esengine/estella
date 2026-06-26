// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/interactable.ts
 * @brief   Back-compat shim — Interactable/UIInteraction moved to the input
 *          concept module. Re-exported here to keep existing imports stable.
 */
export {
    Interactable,
    UIInteraction,
    type InteractableData,
    type UIInteractionData,
} from '../input/interactable';
