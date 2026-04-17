/**
 * @file    ui2/index.ts
 * @brief   Barrel for the v4 UI framework (WIP).
 *
 * This folder holds the rewritten UI system (see docs/ui-redesign.md).
 * It lives alongside the legacy `src/ui/` until P7, at which point the
 * old folder is removed and this one is renamed back to `ui/`.
 */

export {
    UIEventQueue,
    UIEventType,
    type UIEvent,
    type UIEventHandler,
    type Unsubscribe,
} from './core/events';

export {
    ViewPool,
    type ViewPoolOptions,
    type ViewPoolTemplate,
} from './collection/view-pool';
