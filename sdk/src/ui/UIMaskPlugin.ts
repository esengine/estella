/**
 * @file    ui/UIMaskPlugin.ts
 * @brief   Back-compat shim — the UIMask registration plugin moved to the render
 *          concept module (REARCH_GUI P0). Re-exported here to keep the public
 *          symbol + existing imports stable until REARCH_GUI P4.
 */
export { UIMaskPlugin, uiMaskPlugin } from './render/mask';
