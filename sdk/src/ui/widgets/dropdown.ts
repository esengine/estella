// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../ecs/world';

import { UIController, interactionController } from '../controller/ui-controller';
import { UIGear } from '../controller/ui-gear';
import { interactionGears } from '../controller/interaction-gears';
import { UIEventType, type UIEventQueue } from '../core/events';

import { spawnUIEntity, type UINodeInit } from '../core/compose';
import { makeWidgetInteractable } from '../input/interactable';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import {
    UIDropdown,
    isDropdownOpen,
    openDropdown,
    closeDropdown,
    type UIDropdownData,
} from '../behavior/dropdown';

export interface DropdownOptions<T> {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;

    options: readonly T[];
    selectedIndex?: number;
    optionToLabel?: (option: T, index: number) => string;

    /** Visual state overrides for the main button. */
    buttonStates?: {
        normal?: Color;
        hover?: Color;
        pressed?: Color;
    };
    /** Height of each option row in pixels. Default 32. */
    optionHeight?: number;

    /** Start disabled. */
    disabled?: boolean;
    /** Participate in Tab traversal + arrow-key selection. Default true. */
    focusable?: boolean;
    tabIndex?: number;

    onSelect?: (index: number, option: T, entity: Entity) => void;
}

export interface DropdownHandle<T> {
    readonly entity: Entity;
    readonly labelEntity: Entity;
    isOpen(): boolean;
    getSelectedIndex(): number;
    getSelected(): T;
    setSelectedIndex(index: number): void;
    open(): void;
    close(): void;
    dispose(): void;
}

/**
 * Dropdown: a button showing the current selection that opens a popup with
 * clickable option rows. State + behavior live in the {@link UIDropdown}
 * component and its system: click toggles the popup, a click anywhere else
 * closes it, arrow keys step the selection while focused, and the label
 * follows `selectedIndex` for any writer. The factory adds the generic-type
 * mapping (`options: T[]` + `optionToLabel`) on top.
 */
export function createDropdown<T>(opts: DropdownOptions<T>): DropdownHandle<T> {
    const { world, events } = opts;
    const labelOf = opts.optionToLabel ?? ((o: T) => String(o));
    const selectedIndex = opts.selectedIndex ?? 0;

    const c = themeColors();
    const btnColors = {
        normal:  opts.buttonStates?.normal  ?? c.control,
        hover:   opts.buttonStates?.hover   ?? c.controlHover,
        pressed: opts.buttonStates?.pressed ?? c.controlActive,
    };

    // Button root.
    const button = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: { color: btnColors.normal },
    });
    makeWidgetInteractable(world, button, {
        disabled: opts.disabled,
        focusable: opts.focusable,
        tabIndex: opts.tabIndex,
    });
    world.insert(button, UIController, {
        controllers: [interactionController(['normal', 'hover', 'pressed'])],
    });
    world.insert(button, UIGear, {
        bindings: interactionGears({
            normal: { color: btnColors.normal },
            hover: { color: btnColors.hover },
            pressed: { color: btnColors.pressed },
        }),
    });
    if (opts.buttonStates === undefined) {
        markThemed(world, button, { states: { normal: 'control', hover: 'controlHover', pressed: 'controlActive' } });
    }

    const label = spawnUIEntity({
        world,
        parent: button,
        node: { fill: true },
        text: { content: labelOf(opts.options[selectedIndex]!, selectedIndex), color: c.text },
    });
    markThemed(world, label, { text: 'text' });

    world.insert(button, UIDropdown, {
        options: opts.options.map((o, i) => labelOf(o, i)),
        selectedIndex,
        optionHeight: opts.optionHeight ?? 32,
        label,
    });

    const offSelect = opts.onSelect
        ? events.on(button, UIEventType.Change, (ev) => {
              const data = ev.data as { index?: number };
              if (typeof data?.index !== 'number') return;
              opts.onSelect!(data.index, opts.options[data.index]!, button);
          })
        : undefined;

    const selected = () => (world.get(button, UIDropdown) as UIDropdownData).selectedIndex;

    return {
        entity: button,
        labelEntity: label,
        isOpen: () => isDropdownOpen(world, button),
        getSelectedIndex: selected,
        getSelected: () => opts.options[selected()]!,
        setSelectedIndex: (index: number) => {
            if (index < 0 || index >= opts.options.length) return;
            const d = world.get(button, UIDropdown) as UIDropdownData;
            if (d.selectedIndex === index) return;
            d.selectedIndex = index;
            world.insert(button, UIDropdown, d);
        },
        open: () => openDropdown(world, events, button),
        close: () => closeDropdown(world, button),
        dispose: () => {
            offSelect?.();
            closeDropdown(world, button);
            if (world.valid(button)) world.despawn(button);
        },
    };
}
