/**
 * @file    ui/behavior/draggable.ts
 * @brief   Back-compat shim — Draggable/DragState moved to the input concept
 *          module (REARCH_GUI P0). Re-exported here to keep existing imports
 *          stable until REARCH_GUI P4.
 */
export {
    Draggable,
    DragState,
    type DraggableData,
    type DragStateData,
} from '../input/draggable';
