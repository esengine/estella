// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/toggle.ts
 * @brief   UIToggle — data-driven on/off state.
 *
 * A group makes them exclusive: UIToggleGroup on a common ancestor.
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
import { EntityStateMap, walkParentChain } from '../util/helpers';

export interface UIToggleData {
    isOn: boolean;
    /** The on-state indicator entity (UIVisual.enabled tracks `isOn`). */
    check: Entity;
}

export const UIToggle = defineComponent<UIToggleData>('UIToggle', {
    isOn: false,
    check: 0 as Entity,
}, { entityFields: ['check'] });

export interface UIToggleGroupData {
    /** Whether the group may end up with nothing selected. */
    allowSwitchOff: boolean;
}

/**
 * Makes the UIToggles beneath it exclusive — a radio group, a tab bar, a
 * difficulty picker. Sits on the COMMON ANCESTOR, like FlexContainer, so the
 * toggles need no reference to each other or to it.
 */
export const UIToggleGroup = defineComponent<UIToggleGroupData>('UIToggleGroup', {
    allowSwitchOff: false,
}, {
    fields: {
        allowSwitchOff: { tooltip: 'Let a click turn the selected toggle off, leaving none selected.' },
    },
});

/** The nearest ancestor that groups this toggle, or 0 when it is on its own. */
function groupOf(world: World, entity: Entity): Entity {
    let group = 0 as Entity;
    walkParentChain(world, entity, (ancestor) => {
        if (!world.has(ancestor, UIToggleGroup)) return false;
        group = ancestor;
        return true;
    });
    return group;
}

/** Turn off every other toggle the same group owns. */
function clearSiblings(world: World, group: Entity, keep: Entity): void {
    for (const other of world.getEntitiesWithComponents([UIToggle])) {
        if (other === keep) continue;
        const d = world.get(other, UIToggle) as UIToggleData;
        if (!d.isOn || groupOf(world, other) !== group) continue;
        d.isOn = false;
        world.insert(other, UIToggle, d);
    }
}

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
        const group = groupOf(world, e);
        // A group that must keep a selection ignores a click on the selected
        // one; otherwise the tab bar can be clicked into showing nothing.
        if (group && d.isOn
            && !(world.get(group, UIToggleGroup) as UIToggleGroupData).allowSwitchOff) return;
        d.isOn = !d.isOn;
        world.insert(e, UIToggle, d);
        if (group && d.isOn) clearSiblings(world, group, e);
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
