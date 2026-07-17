// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/dropdown.ts
 * @brief   UIDropdown — data-driven select control.
 *
 * The component holds the display labels + `selectedIndex` + the button-label
 * entity ref; the system owns the popup lifecycle (click toggles it, a click
 * anywhere else closes it), row selection, keyboard stepping while focused,
 * and the label sync — the single writer, so `setSelectedIndex`, a binding,
 * the editor inspector, and pointer selection all behave identically. A
 * prefab-placed dropdown is fully functional without code.
 *
 * The popup is a transient runtime subtree, rebuilt on each open with fresh
 * theme colors and tagged with ThemeStyle roles for live re-theming.
 */
import { defineComponent } from '../../component';
import { defineSystem, type SystemDef } from '../../system';
import { Res } from '../../resource';
import { Input, type InputState } from '../../input';
import type { World } from '../../world';
import type { Entity } from '../../types';
import { px, percent } from '../core/dimension';
import { spawnUIEntity } from '../core/compose';
import { Text, type TextData } from '../core/text';
import { UIEventType, type UIEventQueue } from '../core/events';
import { Interactable, makeWidgetInteractable, type InteractableData } from '../input/interactable';
import { Focusable, type FocusableData } from '../input/focusable';
import { UIController, interactionController } from '../controller/ui-controller';
import { UIGear } from '../controller/ui-gear';
import { interactionGears } from '../controller/interaction-gears';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { EntityStateMap, walkParentChain } from '../util/helpers';

export interface UIDropdownData {
    /** Display labels, one per option. */
    options: string[];
    selectedIndex: number;
    /** Popup row height in px. */
    optionHeight: number;
    /** The button's label Text entity (content tracks the selection). */
    label: Entity;
}

export const UIDropdown = defineComponent<UIDropdownData>('UIDropdown', {
    options: [],
    selectedIndex: 0,
    optionHeight: 32,
    label: 0 as Entity,
}, { entityFields: ['label'] });

interface PopupState {
    panel: Entity;
    unsubs: Array<() => void>;
}

// Popup registries are runtime-only and per-world (unit tests run many worlds).
const popupsByWorld = new WeakMap<World, Map<Entity, PopupState>>();

function popupsOf(world: World): Map<Entity, PopupState> {
    let m = popupsByWorld.get(world);
    if (!m) {
        m = new Map();
        popupsByWorld.set(world, m);
    }
    return m;
}

export function isDropdownOpen(world: World, e: Entity): boolean {
    return popupsOf(world).has(e);
}

export function closeDropdown(world: World, e: Entity): void {
    const popups = popupsOf(world);
    const p = popups.get(e);
    if (!p) return;
    popups.delete(e);
    for (const off of p.unsubs) off();
    if (world.valid(p.panel)) world.despawn(p.panel);
}

export function openDropdown(world: World, events: UIEventQueue, e: Entity): void {
    const popups = popupsOf(world);
    if (popups.has(e) || !world.has(e, UIDropdown)) return;
    const d = world.get(e, UIDropdown) as UIDropdownData;

    // Fresh theme resolution per open — the popup is transient, so a stale
    // capture would pin whatever theme was active earlier.
    const t = themeColors();
    const panel = spawnUIEntity({
        world,
        parent: e,
        // Below the button: absolute, full width, top at the button's bottom edge.
        node: {
            position: 1,
            insetLeft: px(0),
            insetRight: px(0),
            insetTop: percent(100),
            height: px(d.options.length * d.optionHeight),
        },
        visual: { color: t.surfaceElevated },
    });
    markThemed(world, panel, { visual: 'surfaceElevated' });

    const unsubs: Array<() => void> = [];
    for (let i = 0; i < d.options.length; i++) {
        const row = spawnUIEntity({
            world,
            parent: panel,
            node: {
                position: 1,
                insetLeft: px(0),
                insetRight: px(0),
                insetTop: px(i * d.optionHeight),
                height: px(d.optionHeight),
            },
            visual: { color: t.control },
        });
        // Rows are pointer-only: the popup is transient, so they stay out of
        // the Tab ring.
        makeWidgetInteractable(world, row, { focusable: false });
        world.insert(row, UIController, {
            controllers: [interactionController(['normal', 'hover', 'pressed'])],
        });
        world.insert(row, UIGear, {
            bindings: interactionGears({
                normal: { color: t.control },
                hover: { color: t.primaryHover },
                pressed: { color: t.primaryActive },
            }),
        });
        markThemed(world, row, {
            states: { normal: 'control', hover: 'primaryHover', pressed: 'primaryActive' },
        });

        const rowLabel = spawnUIEntity({
            world,
            parent: row,
            node: { fill: true },
            text: { content: d.options[i]!, color: t.text },
        });
        markThemed(world, rowLabel, { text: 'text' });

        const index = i;
        unsubs.push(events.on(row, UIEventType.Click, () => {
            const cur = world.get(e, UIDropdown) as UIDropdownData;
            closeDropdown(world, e);
            if (cur.selectedIndex !== index) {
                cur.selectedIndex = index;
                world.insert(e, UIDropdown, cur);
            }
        }));
    }
    popups.set(e, { panel, unsubs });
}

/** True when `entity` is inside the popup subtree of any open dropdown. */
function insideAnyPopup(world: World, entity: Entity): boolean {
    const popups = popupsOf(world);
    if (popups.size === 0) return false;
    const panels = new Set<number>();
    for (const p of popups.values()) panels.add(p.panel as number);
    if (panels.has(entity as number)) return true;
    let inside = false;
    walkParentChain(world, entity, (ancestor) => {
        if (panels.has(ancestor as number)) {
            inside = true;
            return true;
        }
        return false;
    });
    return inside;
}

/**
 * Popup lifecycle + selection + keyboard + label sync for every UIDropdown.
 */
export function createDropdownSystem(world: World, events: UIEventQueue): SystemDef {
    const shown = new EntityStateMap<number>(); // last index whose label was applied

    // One global click handler arbitrates: the dropdown root toggles its own
    // popup; a click inside a popup is the row handler's business; any other
    // click closes every open popup (click-outside-to-close).
    events.on(UIEventType.Click, (ev) => {
        const target = ev.target;
        if (world.valid(target) && world.has(target, UIDropdown)) {
            const enabled = !world.has(target, Interactable)
                || (world.get(target, Interactable) as InteractableData).enabled;
            if (!enabled) return;
            if (isDropdownOpen(world, target)) closeDropdown(world, target);
            else openDropdown(world, events, target);
            return;
        }
        if (insideAnyPopup(world, target)) return;
        for (const e of [...popupsOf(world).keys()]) closeDropdown(world, e);
    });

    world.onDespawn((e) => {
        // The popup subtree dies with its parent; drop the bookkeeping.
        if (popupsOf(world).has(e)) closeDropdown(world, e);
    });

    return defineSystem([Res(Input)], (input: InputState) => {
        for (const e of world.getEntitiesWithComponents([UIDropdown])) {
            const d = world.get(e, UIDropdown) as UIDropdownData;

            // Keyboard: step the selection while focused and closed (the
            // native <select> convention).
            const focused = world.has(e, Focusable)
                && (world.get(e, Focusable) as FocusableData).isFocused;
            const enabled = !world.has(e, Interactable)
                || (world.get(e, Interactable) as InteractableData).enabled;
            if (focused && enabled && !isDropdownOpen(world, e) && d.options.length > 0) {
                let next = d.selectedIndex;
                if (input.isKeyPressed('ArrowDown')) next = Math.min(next + 1, d.options.length - 1);
                if (input.isKeyPressed('ArrowUp')) next = Math.max(next - 1, 0);
                if (next !== d.selectedIndex) {
                    d.selectedIndex = next;
                    world.insert(e, UIDropdown, d);
                }
            }

            // Selection → label + change event, whoever wrote the index.
            if (shown.get(e) !== d.selectedIndex) {
                const emitChange = shown.has(e); // first sync is initial paint
                shown.set(e, d.selectedIndex);
                if (world.valid(d.label) && world.has(d.label, Text)) {
                    const txt = world.get(d.label, Text) as TextData;
                    const content = d.options[d.selectedIndex] ?? '';
                    if (txt.content !== content) {
                        txt.content = content;
                        world.insert(d.label, Text, txt);
                    }
                }
                if (emitChange) events.emit(e, UIEventType.Change, { index: d.selectedIndex });
            }
        }
        shown.cleanup(world);
    }, { name: 'UIDropdownSystem' });
}
