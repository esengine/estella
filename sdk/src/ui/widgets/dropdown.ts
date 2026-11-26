// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../ecs/world';
import { Transform } from '../../ecs/component';
import { q } from '../../math/quat';

import { UIController, controllerState, interactionController } from '../controller/ui-controller';
import { UIGear, gearBinding } from '../controller/ui-gear';
import { interactionGears } from '../controller/interaction-gears';
import { UIEventType, type UIEventQueue } from '../core/events';

import { spawnUIEntity, type UINodeInit } from '../core/compose';
import { percent, px } from '../core/dimension';
import { UIPositionType } from '../core/ui-node';
import { TextAlign, TextOverflow } from '../core/text';
import { makeWidgetInteractable } from '../input/interactable';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import {
    UIDropdown,
    DROPDOWN_CONTROLLER,
    clampDropdownIndex,
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
    const labels = opts.options.map((option, index) => labelOf(option, index));
    const selectedIndex = clampDropdownIndex(opts.selectedIndex ?? 0, labels.length);

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
        controllers: [interactionController(['normal', 'hover', 'pressed', 'focused']), controllerState(DROPDOWN_CONTROLLER, ['closed', 'open'])],
    });
    world.insert(button, UIGear, {
        bindings: interactionGears({
            normal: { color: btnColors.normal },
            hover: { color: btnColors.hover },
            pressed: { color: btnColors.pressed },
            focused: { color: c.controlFocus },
        }),
    });
    if (opts.buttonStates === undefined) {
        markThemed(world, button, { states: { normal: 'control', hover: 'controlHover', pressed: 'controlActive', focused: 'controlFocus' } });
    }

    const label = spawnUIEntity({
        world,
        parent: button,
        node: { fill: true, insetLeft: px(11), insetRight: px(28) },
        text: { content: labels[selectedIndex] ?? '', color: c.text, align: TextAlign.Left, overflow: TextOverflow.Ellipsis },
    });
    markThemed(world, label, { text: 'text' });
    // Two strokes keep the chevron legible at its design size across fonts.
    // Both rotations share the same quaternion w when flipped about their centres.
    for (const [right, angle] of [[15, -40], [9, 40]] as const) {
        const stroke = spawnUIEntity({ world, parent: button, node: {
            position: UIPositionType.Absolute, insetTop: percent(50), marginTop: px(-1),
            insetRight: px(right), width: px(8), height: px(2),
        }, visual: { color: c.text } });
        const rotation = q.setAngleZ(undefined, angle);
        world.insert(stroke, Transform, { ...world.get(stroke, Transform), rotation });
        world.insert(stroke, UIGear, { bindings: [
            gearBinding(DROPDOWN_CONTROLLER, 'Transform', 'rotation.z', { closed: rotation.z, open: -rotation.z }),
        ] });
        markThemed(world, stroke, { visual: 'text' });
    }

    world.insert(button, UIDropdown, {
        options: labels,
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
