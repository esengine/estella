// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { UIEventType, type UIEventQueue } from '../core/events';
import { Interactable, type InteractableData } from '../input/interactable';

import { createButton, type ButtonStateVisual } from './button';
import { spawnUIEntity, setUIVisible, type UINodeInit, type UIVisualInit } from './helpers';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';

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
    isOn(): boolean;
    setIsOn(value: boolean, silent?: boolean): void;
    setDisabled(disabled: boolean): void;
    dispose(): void;
}

/**
 * Compose a Toggle from a Button (interaction + visual states) plus a
 * separate child entity driven by `isOn` for the check-mark visual.
 * Click flips isOn and emits `change` on the button entity.
 */
export function createToggle(opts: ToggleOptions): ToggleHandle {
    const { world, events } = opts;
    let isOn = opts.isOn ?? false;

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

    const offClick = events.on(button, UIEventType.Click, () => {
        const interactable = world.get(button, Interactable) as InteractableData;
        if (interactable.enabled) setIsOn(!isOn);
    });

    function setIsOn(value: boolean, silent = false): void {
        if (value === isOn) return;
        isOn = value;
        setUIVisible(world, check, isOn);
        if (!silent) {
            events.emit(button, UIEventType.Change, { isOn });
            opts.onChange?.(isOn, button);
        }
    }

    return {
        entity: button,
        isOn: () => isOn,
        setIsOn,
        setDisabled: btn.setDisabled,
        dispose: () => {
            offClick();
            btn.dispose();
        },
    };
}
