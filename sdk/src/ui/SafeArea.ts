/**
 * @file    ui/SafeArea.ts
 * @brief   Back-compat shim — the SafeArea component moved into the layout
 *          concept module (REARCH_GUI P0). Re-exported here to keep the
 *          public symbol + existing imports stable until REARCH_GUI P4.
 */
export { SafeArea, type SafeAreaData } from './layout/safe-area';
