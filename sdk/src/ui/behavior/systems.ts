import { defineSystem, type SystemDef } from '../../system';
import { Transform, type TransformData } from '../../component';
import type { World } from '../../world';

import { Interactable, UIInteraction, type InteractableData, type UIInteractionData } from './interactable';
import { StateMachine, type StateMachineData } from './state-machine';
import {
    StateVisuals,
    TransitionFlag,
    STATE_VISUALS_SLOT_COUNT,
    type StateVisualsData,
} from './state-visuals';
import { UIRenderer, type UIRendererData } from '../core/ui-renderer';
import { UIEventType, type UIEventQueue } from '../core/events';

/**
 * State names that the interactable driver owns. If StateMachine.current
 * holds any other value, it was set by user code (e.g. "loading") and
 * the driver must not overwrite it.
 */
const DRIVER_OWNED_STATES: ReadonlySet<string> = new Set([
    '', 'normal', 'hover', 'pressed', 'disabled',
]);

/**
 * Pure derivation: choose the state a hit-test pass implies.
 * Extracted so unit tests can cover the branching without a World.
 */
export function driverStateFor(
    enabled: boolean,
    interaction: UIInteractionData | null,
): string {
    if (!enabled) return 'disabled';
    if (interaction?.pressed) return 'pressed';
    if (interaction?.hovered) return 'hover';
    return 'normal';
}

/**
 * Pure lookup: index of the StateVisuals slot whose name matches `state`.
 * Returns -1 if no slot matches (caller should skip applying visuals).
 */
export function findStateSlot(sv: StateVisualsData, state: string): number {
    if (state === '') return -1;
    const record = sv as unknown as Record<string, unknown>;
    for (let i = 0; i < STATE_VISUALS_SLOT_COUNT; i++) {
        if (record[`slot${i}Name`] === state) return i;
    }
    return -1;
}

/**
 * Writes StateMachine.current based on Interactable + UIInteraction.
 * Leaves user-managed states (anything outside DRIVER_OWNED_STATES) alone.
 */
export function createInteractableDriverSystem(world: World): SystemDef {
    return defineSystem([], () => {
        const entities = world.getEntitiesWithComponents([Interactable, StateMachine]);
        for (const e of entities) {
            const sm = world.get(e, StateMachine) as StateMachineData;
            if (!DRIVER_OWNED_STATES.has(sm.current)) continue;

            const inter = world.has(e, UIInteraction)
                ? (world.get(e, UIInteraction) as UIInteractionData)
                : null;
            const interactable = world.get(e, Interactable) as InteractableData;
            const next = driverStateFor(interactable.enabled, inter);
            if (next !== sm.current) {
                sm.current = next;
                world.insert(e, StateMachine, sm);
            }
        }
    }, { name: 'InteractableDriverSystem' });
}

/**
 * Emits a `state_changed` event on every StateMachine whose `current`
 * differs from `previous`, then advances `previous` to match.
 */
export function createStateMachineDiffSystem(
    world: World,
    events: UIEventQueue,
): SystemDef {
    return defineSystem([], () => {
        const entities = world.getEntitiesWithComponents([StateMachine]);
        for (const e of entities) {
            const sm = world.get(e, StateMachine) as StateMachineData;
            if (sm.current === sm.previous) continue;
            events.emit(e, UIEventType.StateChanged, {
                from: sm.previous,
                to: sm.current,
            });
            sm.previous = sm.current;
            world.insert(e, StateMachine, sm);
        }
    }, { name: 'StateMachineDiffSystem' });
}

/**
 * Reads StateMachine.current, looks up the matching StateVisuals slot,
 * and applies the selected visual dimensions (color / sprite / scale)
 * to the targetGraphic entity (or the owning entity when unset).
 *
 * `fadeDuration` is currently ignored — changes snap. Continuous fading
 * will be layered on in a later iteration.
 */
export function createStateVisualsApplySystem(world: World): SystemDef {
    return defineSystem([], () => {
        const entities = world.getEntitiesWithComponents([StateMachine, StateVisuals]);
        for (const e of entities) {
            const sm = world.get(e, StateMachine) as StateMachineData;
            const sv = world.get(e, StateVisuals) as StateVisualsData;
            const slot = findStateSlot(sv, sm.current);
            if (slot < 0) continue;

            const target = sv.targetGraphic !== 0 ? sv.targetGraphic : e;
            const flags = sv.transitionFlags;
            const record = sv as unknown as Record<string, unknown>;

            if ((flags & TransitionFlag.ColorTint) && world.has(target, UIRenderer)) {
                const r = world.get(target, UIRenderer) as UIRendererData;
                r.color = record[`slot${slot}Color`] as UIRendererData['color'];
                world.insert(target, UIRenderer, r);
            }

            if ((flags & TransitionFlag.SpriteSwap) && world.has(target, UIRenderer)) {
                const r = world.get(target, UIRenderer) as UIRendererData;
                r.texture = record[`slot${slot}Sprite`] as number;
                world.insert(target, UIRenderer, r);
            }

            if ((flags & TransitionFlag.Scale) && world.has(target, Transform)) {
                const t = world.get(target, Transform) as TransformData;
                const s = record[`slot${slot}Scale`] as number;
                t.scale = { x: s, y: s, z: 1 };
                world.insert(target, Transform, t);
            }
        }
    }, { name: 'StateVisualsApplySystem' });
}
