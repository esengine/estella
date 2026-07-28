// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../ecs/world';

import { UIEventType, type UIEventQueue } from '../core/events';
import type { ButtonStateVisual } from '../controller/interaction-gears';

import { createButton } from './button';
import { spawnUIEntity, setUIVisible, type UINodeInit, type UIVisualInit } from '../core/compose';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { UIToggle, type UIToggleData } from '../behavior/toggle';

export interface ToggleOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;

    /** Background renderer for the frame. */
    background?: UIVisualInit;

    /** Interaction states (normal / hover / pressed / disabled) for the frame.
     *  Defaults to the active theme's control roles (as createButton). */
    interactionStates?: Record<string, ButtonStateVisual>;

    /**
     * Optional rendering for the on-state indicator ("check mark").
     * A child entity hidden when off, shown when on. Fills the parent by
     * default; override via `check.node`.
     */
    check?: {
        node?: UINodeInit;
        color?: Color;
        sprite?: number;
    };

    /** Initial on/off state. */
    isOn?: boolean;
    /** Start disabled. */
    disabled?: boolean;
    /** Participate in Tab traversal + Enter/Space activation. Default true. */
    focusable?: boolean;
    tabIndex?: number;

    onChange?: (isOn: boolean, entity: Entity) => void;
}

export interface ToggleHandle {
    readonly entity: Entity;
    getValue(): boolean;
    setValue(value: boolean): void;
    setDisabled(disabled: boolean): void;
    dispose(): void;
}

/**
 * Compose a Toggle from a Button (interaction + visual states) plus a
 * separate child entity driven by `isOn` for the check-mark visual.
 * State + flipping live in the {@link UIToggle} component and its behavior
 * system — click, `setValue`, a binding, or the editor inspector all flip the
 * indicator and emit `change` identically.
 */
export function createToggle(opts: ToggleOptions): ToggleHandle {
    const { world, events } = opts;
    const isOn = opts.isOn ?? false;

    const btn = createButton({
        world,
        events,
        parent: opts.parent,
        node: opts.node,
        background: opts.background,
        states: opts.interactionStates,
        disabled: opts.disabled,
        focusable: opts.focusable,
        tabIndex: opts.tabIndex,
    });
    const button = btn.entity;

    // The on-state indicator defaults to the theme accent so it re-themes live;
    // a caller-supplied color is the caller's own.
    const check = spawnUIEntity({
        world,
        parent: button,
        node: opts.check?.node ?? { fill: true },
        visual: {
            color: opts.check?.color ?? themeColors().primary,
            texture: opts.check?.sprite,
            visualType: opts.check?.sprite ? 2 /* Image */ : 1 /* SolidColor */,
        },
    });
    if (opts.check?.color === undefined) markThemed(world, check, { visual: 'primary' });

    setUIVisible(world, check, isOn);
    world.insert(button, UIToggle, { isOn, check });

    const offChange = opts.onChange
        ? events.on(button, UIEventType.Change, (ev) => {
              opts.onChange!((ev.data as { isOn: boolean }).isOn, button);
          })
        : undefined;

    return {
        entity: button,
        getValue: () => (world.get(button, UIToggle) as UIToggleData).isOn,
        setValue: (value: boolean) => {
            const d = world.get(button, UIToggle) as UIToggleData;
            if (d.isOn === value) return;
            d.isOn = value;
            world.insert(button, UIToggle, d);
        },
        setDisabled: btn.setDisabled,
        dispose: () => {
            offChange?.();
            btn.dispose();
        },
    };
}
