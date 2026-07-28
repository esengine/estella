// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/toggle.ts
 * @brief   UIToggle — data-driven on/off state.
 *
 * The component IS the state (`isOn` + the check-indicator entity ref); the
 * system flips it on click and is the single writer of the check visual. Any
 * writer — the pointer, `setValue`, a binding, the editor inspector — shows
 * the indicator and fires `change` identically, so a prefab-placed toggle
 * works without code.
 */
import { defineComponent } from '../../ecs/component';
import { defineSystem, type SystemDef } from '../../ecs/system';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { setUIVisible } from '../core/compose';
import { Interactable, type InteractableData } from '../input/interactable';
import { UIEventType, type UIEventQueue } from '../core/events';
import { EntityStateMap } from '../util/helpers';

export interface UIToggleData {
    isOn: boolean;
    /** The on-state indicator entity (UIVisual.enabled tracks `isOn`). */
    check: Entity;
}

export const UIToggle = defineComponent<UIToggleData>('UIToggle', {
    isOn: false,
    check: 0 as Entity,
}, { entityFields: ['check'] });

/** Flips on click; syncs `isOn` → check visibility; emits `change`. */
export function createToggleSystem(world: World, events: UIEventQueue): SystemDef {
    const shown = new EntityStateMap<boolean>(); // last isOn whose visual was applied

    // The interaction layer defines what a click is (release over the pressed
    // entity); the toggle just listens.
    events.on(UIEventType.Click, (ev) => {
        const e = ev.target;
        if (!world.valid(e) || !world.has(e, UIToggle)) return;
        if (world.has(e, Interactable)
            && !(world.get(e, Interactable) as InteractableData).enabled) return;
        const d = world.get(e, UIToggle) as UIToggleData;
        d.isOn = !d.isOn;
        world.insert(e, UIToggle, d);
    });

    return defineSystem([], () => {
        for (const e of world.getEntitiesWithComponents([UIToggle])) {
            const d = world.get(e, UIToggle) as UIToggleData;
            if (shown.get(e) === d.isOn) continue;
            const emitChange = shown.has(e); // first sync is initial paint
            shown.set(e, d.isOn);
            setUIVisible(world, d.check, d.isOn);
            if (emitChange) events.emit(e, UIEventType.Change, { isOn: d.isOn });
        }
        shown.cleanup(world);
    }, { name: 'UIToggleSystem' });
}
