// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { UIEventType, type UIEventQueue } from '../core/events';

import { createButton, type ButtonStateVisual } from './button';
import { spawnUIEntity, setUIVisible, type UINodeInit, type UIVisualInit } from './helpers';

export interface ToggleOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;

    /** Background renderer for the frame. */
    background?: UIVisualInit;

    /** Interaction states (normal / hover / pressed / disabled) for the frame. */
    interactionStates: Record<string, ButtonStateVisual>;

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

    onChange?: (isOn: boolean, entity: Entity) => void;
}

export interface ToggleHandle {
    readonly entity: Entity;
    isOn(): boolean;
    setIsOn(value: boolean, silent?: boolean): void;
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

    const button = createButton({
        world,
        events,
        parent: opts.parent,
        node: opts.node,
        background: opts.background,
        states: opts.interactionStates,
        disabled: opts.disabled,
    });

    const check = spawnUIEntity({
        world,
        parent: button,
        node: opts.check?.node ?? { fill: true },
        visual: opts.check
            ? {
                  color: opts.check.color,
                  texture: opts.check.sprite,
                  visualType: opts.check.sprite ? 2 /* Image */ : 1 /* SolidColor */,
              }
            : {},
    });

    setUIVisible(world, check, isOn);

    const offClick = events.on(button, UIEventType.StateChanged, (event) => {
        const data = event.data as { from: string; to: string };
        if (data.from === 'pressed' && data.to === 'hover') {
            setIsOn(!isOn);
        }
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
        dispose: () => {
            offClick();
            if (world.valid(button)) world.despawn(button);
        },
    };
}
