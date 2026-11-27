// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Focusable, type FocusManagerState } from './focusable';
import { isFocusEligible } from './focus-inspection';
import { UIEventType, type UIEventQueue } from '../core/events';

/** End focus on a live entity even when it has already lost its Focusable component. */
export function clearUIFocus(world: World, events: UIEventQueue, manager: FocusManagerState): void {
    const previous = manager.blur();
    if (previous === null || !world.valid(previous)) return;
    if (world.has(previous, Focusable)) {
        world.set(previous, Focusable, { ...world.get(previous, Focusable), isFocused: false });
    }
    events.emit(previous, UIEventType.Blur);
}

/** One transition path for Tab traversal and compound widgets. Handlers may redirect focus. */
export function moveUIFocus(world: World, events: UIEventQueue, manager: FocusManagerState,
    entity: Entity, visible: boolean): void {
    if (!isFocusEligible(world, entity)) return;
    if (manager.focusedEntity === entity) { manager.focusVisible = visible; return; }
    clearUIFocus(world, events, manager);
    if (manager.focusedEntity !== null || !isFocusEligible(world, entity)) return;
    manager.focus(entity, visible);
    world.set(entity, Focusable, { ...world.get(entity, Focusable), isFocused: true });
    events.emit(entity, UIEventType.Focus);
    if (manager.focusedEntity === entity && !isFocusEligible(world, entity)) {
        clearUIFocus(world, events, manager);
    }
}
