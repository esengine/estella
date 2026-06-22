/**
 * @file    ui/UIRenderOrderPlugin.ts
 * @brief   Back-compat shim — the UI render-order pass moved to the render
 *          concept module (REARCH_GUI P0). Re-exported here to keep the public
 *          symbol + existing imports stable until REARCH_GUI P4.
 */
export { UIRenderOrderPlugin, uiRenderOrderPlugin } from './render/render-order';
