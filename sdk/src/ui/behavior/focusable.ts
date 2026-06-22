/**
 * @file    ui/behavior/focusable.ts
 * @brief   Back-compat shim — Focusable/FocusManager moved to the input concept
 *          module (REARCH_GUI P0). Re-exported here to keep existing imports
 *          stable until REARCH_GUI P4.
 */
export {
    Focusable,
    FocusManager,
    FocusManagerState,
    type FocusableData,
} from '../input/focusable';
