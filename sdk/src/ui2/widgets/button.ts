import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../behavior/interactable';
import { StateMachine } from '../behavior/state-machine';
import {
    StateVisuals,
    TransitionFlag,
    type StateVisualsData,
} from '../behavior/state-visuals';
import { UIEventType, type UIEventQueue } from '../core/events';

import {
    spawnUIEntity,
    type UIRectInit,
    type UIRendererInit,
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
    rect?: UIRectInit;
    /** Background renderer config. Default: solid white quad. */
    background?: UIRendererInit;
    /** Label text. Omit to skip spawning a child label entity. */
    text?: string | TextInit;
    /**
     * Map of state name (e.g. "normal", "hover", "pressed", "disabled")
     * to its visual override. The Interactable driver writes the four
     * canonical state names; callers may add more (e.g. "loading") and
     * flip them manually via `setState`.
     */
    states: Record<string, ButtonStateVisual>;
    /** Combination of TransitionFlag values. Default: ColorTint. */
    transitionFlags?: number;
    /** Lerp time for ColorTint/Scale transitions. Default 0 (snap). */
    fadeDuration?: number;
    /** Start in the disabled state (Interactable.enabled = false). */
    disabled?: boolean;
    onClick?: (entity: Entity) => void;
}

const MAX_STATE_SLOTS = 8;

function writeSlots(
    data: StateVisualsData,
    states: Record<string, ButtonStateVisual>,
): void {
    const names = Object.keys(states);
    if (names.length > MAX_STATE_SLOTS) {
        throw new Error(
            `[createButton] up to ${MAX_STATE_SLOTS} states are supported, got ${names.length}`,
        );
    }
    const record = data as unknown as Record<string, unknown>;
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const slot = states[name]!;
        record[`slot${i}Name`] = name;
        record[`slot${i}Color`] = slot.color ?? { r: 1, g: 1, b: 1, a: 1 };
        record[`slot${i}Sprite`] = slot.sprite ?? 0;
        record[`slot${i}Scale`] = slot.scale ?? 1;
    }
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
        rect: opts.rect,
        renderer: opts.background ?? {},
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
        slot0Name: '', slot0Color: { r: 1, g: 1, b: 1, a: 1 }, slot0Sprite: 0, slot0Scale: 1,
        slot1Name: '', slot1Color: { r: 1, g: 1, b: 1, a: 1 }, slot1Sprite: 0, slot1Scale: 1,
        slot2Name: '', slot2Color: { r: 1, g: 1, b: 1, a: 1 }, slot2Sprite: 0, slot2Scale: 1,
        slot3Name: '', slot3Color: { r: 1, g: 1, b: 1, a: 1 }, slot3Sprite: 0, slot3Scale: 1,
        slot4Name: '', slot4Color: { r: 1, g: 1, b: 1, a: 1 }, slot4Sprite: 0, slot4Scale: 1,
        slot5Name: '', slot5Color: { r: 1, g: 1, b: 1, a: 1 }, slot5Sprite: 0, slot5Scale: 1,
        slot6Name: '', slot6Color: { r: 1, g: 1, b: 1, a: 1 }, slot6Sprite: 0, slot6Scale: 1,
        slot7Name: '', slot7Color: { r: 1, g: 1, b: 1, a: 1 }, slot7Sprite: 0, slot7Scale: 1,
    };
    writeSlots(visuals, opts.states);
    world.insert(entity, StateVisuals, visuals);

    if (opts.text !== undefined) {
        const textInit = typeof opts.text === 'string' ? { content: opts.text } : opts.text;
        spawnUIEntity({
            world,
            parent: entity,
            rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
            text: textInit,
        });
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
