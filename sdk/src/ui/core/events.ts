// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/events.ts
 * @brief   The UI's vocabulary over the engine's entity event channel.
 *
 * The queue itself is not UI-specific and lives in `entityEvents.ts` (so the
 * core binding layer and non-UI producers can speak it without importing
 * `ui/`); the names below are aliases of those very objects — one queue, one
 * resource, two spellings. What IS UI-specific is {@link UIEventType}: the set
 * of type strings the built-in widgets emit.
 */
// The queue class and the shared resource, under their UI-facing names — the
// same objects, so `Res(UIEvents)` and `Res(EntityEvents)` resolve identically.
export { EntityEventQueue as UIEventQueue, EntityEvents as UIEvents } from '../../ecs/entityEvents';
export type {
    EntityEvent as UIEvent,
    EntityEventHandler as UIEventHandler,
    Unsubscribe,
} from '../../ecs/entityEvents';

/**
 * Common UI event types. Event type strings are open — users may emit any
 * string they like (e.g. `'item_selected'` from a ListView). These constants
 * document the standard set emitted by built-in widgets.
 */
export const UIEventType = {
    Click: 'click',
    Press: 'press',
    Release: 'release',
    HoverEnter: 'hover_enter',
    HoverExit: 'hover_exit',
    Focus: 'focus',
    Blur: 'blur',
    Change: 'change',
    Submit: 'submit',
    DragStart: 'drag_start',
    DragMove: 'drag_move',
    DragEnd: 'drag_end',
    Scroll: 'scroll',
    Select: 'select',
    Deselect: 'deselect',
} as const;

/**
 * Union of the string values in `UIEventType`. Event emitters accept
 * any string (widgets may define their own), but consumers can narrow
 * to this type when they only handle built-ins.
 */
export type UIEventType = typeof UIEventType[keyof typeof UIEventType];
