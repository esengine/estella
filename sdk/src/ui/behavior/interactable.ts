/**
 * @file    ui/behavior/interactable.ts
 * @brief   Back-compat shim — Interactable/UIInteraction moved to the input
 *          concept module (REARCH_GUI P0). Re-exported here to keep existing
 *          imports stable until REARCH_GUI P4.
 */
export {
    Interactable,
    UIInteraction,
    type InteractableData,
    type UIInteractionData,
} from '../input/interactable';
