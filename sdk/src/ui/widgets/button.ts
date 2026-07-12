// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../input/interactable';
import { StateMachine } from '../behavior/state-machine';
import {
    StateVisuals,
    TransitionFlag,
    visualState,
    type VisualState,
    type StateVisualsData,
} from '../behavior/state-visuals';
import { UIEventType, type UIEventQueue } from '../core/events';
import { themeColors, themeType } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';

import {
    spawnUIEntity,
    type UINodeInit,
    type UIVisualInit,
    type TextInit,
} from './helpers';

/**
 * Visual overrides for a single button state. Omitted fields stay at
 * their slot default (color white, scale 1, no sprite).
 */
export interface ButtonStateVisual {
    color?: Color;
    sprite?: number;
    scale?: number;
}

export interface ButtonOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    /** CSS-box layout. Default: fill the parent. */
    node?: UINodeInit;
    /** Background renderer config. Default: solid white quad. */
    background?: UIVisualInit;
    /** Label text. Omit to skip spawning a child label entity. */
    text?: string | TextInit;
    /**
     * Map of state name (e.g. "normal", "hover", "pressed", "disabled")
     * to its visual override. The Interactable driver writes the four
     * canonical state names; callers may add more (e.g. "loading") and
     * flip them manually via `setState`. Omit to default to the active
     * theme's control roles ({@link themeButtonStates}).
     */
    states?: Record<string, ButtonStateVisual>;
    /** Combination of TransitionFlag values. Default: ColorTint. */
    transitionFlags?: number;
    /** Lerp time for ColorTint/Scale transitions. Default 0 (snap). */
    fadeDuration?: number;
    /** Start in the disabled state (Interactable.enabled = false). */
    disabled?: boolean;
    onClick?: (entity: Entity) => void;
}

/** Map the state-name → override record to the VisualState[] list. */
function buildStates(states: Record<string, ButtonStateVisual>): VisualState[] {
    return Object.entries(states).map(([name, v]) =>
        visualState(name, v.color ?? { r: 1, g: 1, b: 1, a: 1 },
            { sprite: v.sprite, scale: v.scale }));
}

/** The canonical button state colors from the active theme's control roles —
 *  `createButton`'s default when the caller passes no `states`. `disabled` reuses
 *  the resting control fill at reduced alpha. */
export function themeButtonStates(): Record<string, ButtonStateVisual> {
    const c = themeColors();
    return {
        normal: { color: c.control },
        hover: { color: c.controlHover },
        pressed: { color: c.controlActive },
        disabled: { color: { ...c.control, a: c.control.a * 0.5 } },
    };
}

/**
 * Spawn a clickable button entity composed of Interactable +
 * StateMachine + StateVisuals, optionally with a child Text label.
 *
 * Click is detected via state_changed (`pressed` → `hover`): the
 * canonical "released while still over the button" gesture.
 */
export function createButton(opts: ButtonOptions): Entity {
    const { world, events } = opts;

    const entity = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: opts.background ?? {},
    });

    world.insert(entity, Interactable, {
        enabled: !opts.disabled,
        blockRaycast: true,
        raycastTarget: true,
    });
    world.insert(entity, UIInteraction, {
        hovered: false, pressed: false, justPressed: false, justReleased: false,
    });
    world.insert(entity, StateMachine, {
        current: opts.disabled ? 'disabled' : 'normal',
        previous: '',
    });

    const visuals: StateVisualsData = {
        targetGraphic: 0 as Entity,
        transitionFlags: opts.transitionFlags ?? TransitionFlag.ColorTint,
        fadeDuration: opts.fadeDuration ?? 0,
        states: buildStates(opts.states ?? themeButtonStates()),
    };
    world.insert(entity, StateVisuals, visuals);
    // Only theme-managed default states re-resolve on a theme swap; caller-supplied
    // colors are the caller's own.
    if (opts.states === undefined) {
        markThemed(world, entity, {
            states: { normal: 'control', hover: 'controlHover', pressed: 'controlActive', disabled: 'control' },
        });
    }

    if (opts.text !== undefined) {
        const userText = typeof opts.text === 'string' ? { content: opts.text } : opts.text;
        // Theme-default the label's color + size; the caller's fields win.
        const textInit = { color: themeColors().text, fontSize: themeType().label, ...userText };
        const label = spawnUIEntity({
            world,
            parent: entity,
            node: { fill: true },
            text: textInit,
        });
        if (userText.color === undefined) markThemed(world, label, { text: 'text' });
    }

    if (opts.onClick) {
        const handler = opts.onClick;
        events.on(entity, UIEventType.StateChanged, (event) => {
            const data = event.data as { from: string; to: string };
            if (data.from === 'pressed' && data.to === 'hover') {
                handler(entity);
            }
        });
    }

    return entity;
}

/**
 * Imperatively set a button's state string. Useful for custom states
 * like "loading" that the Interactable driver does not manage.
 */
export function setButtonState(world: World, entity: Entity, state: string): void {
    if (!world.has(entity, StateMachine)) return;
    const sm = world.get(entity, StateMachine) as { current: string; previous: string };
    if (sm.current === state) return;
    sm.current = state;
    world.insert(entity, StateMachine, sm);
}
