// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/binding/two-way.ts
 * @brief   bindWidgetValue — two-way binding between a Signal and a widget's
 *          value component field.
 *
 * Down: `bind` writes the signal into the field (the widget's behavior system
 * observes the component and updates visuals + emits `change`). Up: the
 * widget's `change` event writes back into the signal. The signal is the
 * loop breaker — `Signal.set` and the down-binding both no-op on equal
 * values, so a round trip settles in one hop.
 *
 * Works with any component whose behavior system emits `change` with the new
 * value in its payload: `UISlider.value` (`{ value }`), `UIToggle.isOn`
 * (`{ isOn }`), `UIDropdown.selectedIndex` (`{ index }`).
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import type { ComponentDef } from '../../ecs/component';
import { UIEventType, type UIEventQueue } from '../core/events';
import type { Signal } from './signal';
import { bind } from './bind';

/**
 * Two-way bind `signal` ↔ `entity`'s `component.field`, with the widget's
 * `change` event as the upstream edge. `payloadKey` names the field in the
 * change payload (e.g. `'value'` for UISlider, `'isOn'` for UIToggle,
 * `'index'` for UIDropdown). Returns a dispose that tears down both
 * directions (the down-binding also auto-disposes on despawn).
 */
export function bindWidgetValue<C extends object, K extends keyof C>(
    world: World,
    events: UIEventQueue,
    entity: Entity,
    component: ComponentDef<C>,
    field: K,
    signal: Signal<C[K]>,
    payloadKey: string = field as string,
): () => void {
    const down = bind(world, entity, component, field, signal);
    const up = events.on(entity, UIEventType.Change, (ev) => {
        const payload = ev.data as Record<string, unknown> | undefined;
        if (!payload || !(payloadKey in payload)) return;
        signal.set(payload[payloadKey] as C[K]);
    });
    return () => {
        down();
        up();
    };
}
