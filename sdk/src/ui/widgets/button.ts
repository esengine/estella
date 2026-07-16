// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction, type InteractableData } from '../input/interactable';
import {
    UIController,
    INTERACTION_CONTROLLER,
    INTERACTION_PAGES,
    interactionController,
    type UIControllerData,
} from '../controller/ui-controller';
import { UIGear, gearBinding, type GearBinding, type GearValue } from '../controller/ui-gear';
import { EasingType } from '../../animation/Easing';
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
 * Visual overrides for a single button state. Omitted fields leave the
 * live value alone on that state (the gear's sparse-page semantics).
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
     * to its visual override. The `$interaction` driver writes the four
     * canonical state names; callers may add more (e.g. "loading") and
     * flip them manually via `setButtonState`. Omit to default to the
     * active theme's control roles ({@link themeButtonStates}).
     */
    states?: Record<string, ButtonStateVisual>;
    /** Tween time for color/scale state changes. Default 0 (snap). */
    fadeDuration?: number;
    /** Start in the disabled state (Interactable.enabled = false). */
    disabled?: boolean;
    onClick?: (entity: Entity) => void;
}

/**
 * Fold the state-name → override record into per-field gear bindings on the
 * `$interaction` controller. A field a state doesn't override gets no page
 * entry there (sparse pages: the gear leaves it alone). Sprite swaps are
 * discrete and always snap; color and scale tween over `fadeDuration`.
 */
export function interactionGears(
    states: Record<string, ButtonStateVisual>,
    fadeDuration = 0,
): GearBinding[] {
    const color: Record<string, GearValue> = {};
    const sprite: Record<string, GearValue> = {};
    const scale: Record<string, GearValue> = {};
    for (const [page, v] of Object.entries(states)) {
        if (v.color !== undefined) color[page] = { ...v.color };
        if (v.sprite !== undefined) sprite[page] = v.sprite;
        if (v.scale !== undefined) scale[page] = { x: v.scale, y: v.scale, z: 1 };
    }
    const tween = fadeDuration > 0
        ? { easing: EasingType.Linear, duration: fadeDuration }
        : undefined;

    const bindings: GearBinding[] = [];
    if (Object.keys(color).length > 0) {
        bindings.push(gearBinding(INTERACTION_CONTROLLER, 'UIVisual', 'color', color, tween));
    }
    if (Object.keys(sprite).length > 0) {
        bindings.push(gearBinding(INTERACTION_CONTROLLER, 'UIVisual', 'texture', sprite));
    }
    if (Object.keys(scale).length > 0) {
        bindings.push(gearBinding(INTERACTION_CONTROLLER, 'Transform', 'scale', scale, tween));
    }
    return bindings;
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
 * Spawn a clickable button entity composed of Interactable + a `$interaction`
 * UIController + UIGear state bindings, optionally with a child Text label.
 *
 * Click comes straight from the interaction layer's `click` event (released
 * while still over the button); the handler is gated on Interactable.enabled.
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

    const states = opts.states ?? themeButtonStates();
    // Canonical pages first (the driver's vocabulary), then any custom states
    // (e.g. "loading") so setButtonState can flip to them.
    const pages = [
        ...INTERACTION_PAGES,
        ...Object.keys(states).filter((s) => !(INTERACTION_PAGES as readonly string[]).includes(s)),
    ];
    const ctrl = interactionController(pages);
    ctrl.current = opts.disabled ? 'disabled' : 'normal';
    world.insert(entity, UIController, { controllers: [ctrl] });
    world.insert(entity, UIGear, { bindings: interactionGears(states, opts.fadeDuration ?? 0) });

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
        events.on(entity, UIEventType.Click, () => {
            const interactable = world.get(entity, Interactable) as InteractableData;
            if (interactable.enabled) handler(entity);
        });
    }

    return entity;
}

/**
 * Imperatively set a button's `$interaction` page. Useful for custom states
 * like "loading" that the pointer driver does not manage — the driver leaves
 * any non-canonical page alone until user code switches back.
 */
export function setButtonState(world: World, entity: Entity, state: string): void {
    if (!world.has(entity, UIController)) return;
    const data = world.get(entity, UIController) as UIControllerData;
    const ctrl = data.controllers.find((c) => c.name === INTERACTION_CONTROLLER);
    if (!ctrl || ctrl.current === state) return;
    if (!ctrl.pages.includes(state)) ctrl.pages.push(state);
    ctrl.current = state;
    world.insert(entity, UIController, data);
}
