/**
 * @file    ui/FocusPlugin.ts
 * @brief   Back-compat shim — the focus plugin moved to the input concept module
 *          (REARCH_GUI P0). Re-exported here to keep the public symbol +
 *          existing imports stable until REARCH_GUI P4.
 */
export { FocusPlugin, focusPlugin } from './input/focus';
