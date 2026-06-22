/**
 * @file    ui/DragPlugin.ts
 * @brief   Back-compat shim — the drag plugin moved to the input concept module
 *          (REARCH_GUI P0). Re-exported here to keep the public symbol +
 *          existing imports stable until REARCH_GUI P4.
 */
export { DragPlugin, dragPlugin } from './input/drag';
