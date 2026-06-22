/**
 * @file    ui/UIInteractionPlugin.ts
 * @brief   Back-compat shim — the hit-test + UI event plugin moved to the input
 *          concept module (REARCH_GUI P0). Re-exported here to keep the public
 *          symbol + existing imports stable until REARCH_GUI P4.
 */
export { UIInteractionPlugin, uiInteractionPlugin } from './input/interaction';
