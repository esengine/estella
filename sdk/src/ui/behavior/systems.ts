import { defineSystem, type SystemDef } from '../../system';
import { Transform, type TransformData } from '../../component';
import { Res, Time, type TimeData } from '../../resource';
import type { Entity, Color } from '../../types';
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
 * Per-entity transition bookkeeping for StateVisualsApplySystem.
 *
 * Kept in a closure Map rather than an ECS component so the state is
 * invisible to serialization and GC'd naturally when an entity's
 * StateVisuals row disappears (stale entries are purged lazily via
 * `world.valid` and slot-change checks). Color and scalar scale fade
 * continuously over `sv.fadeDuration`; sprite swaps snap (can't lerp
 * between two discrete texture handles).
 */
interface VisualTransitionState {
    readonly toSlot: number;
    elapsed: number;
    /** Snapshot of the target's color at the moment the transition started. */
    readonly startColor: Color;
    /** Snapshot of the target's uniform scale at the moment the transition started. */
    readonly startScale: number;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerpColor(from: Color, to: Color, t: number): Color {
    return {
        r: lerp(from.r, to.r, t),
        g: lerp(from.g, to.g, t),
        b: lerp(from.b, to.b, t),
        a: lerp(from.a, to.a, t),
    };
}

/**
 * Reads StateMachine.current, looks up the matching StateVisuals slot,
 * and applies the selected visual dimensions (color / sprite / scale)
 * to the targetGraphic entity (or the owning entity when unset).
 *
 * When `fadeDuration > 0` and the target slot changed from the last
 * frame's, color and scale continuously interpolate from whatever value
 * the target already had over `fadeDuration` seconds. Sprite swaps are
 * discrete and still snap (no meaningful interpolation between textures).
 */
export function createStateVisualsApplySystem(world: World): SystemDef {
    const transitions = new Map<Entity, VisualTransitionState>();

    return defineSystem([Res(Time)], (time: TimeData) => {
        const dt = time.delta;
        const entities = world.getEntitiesWithComponents([StateMachine, StateVisuals]);
        const seen = new Set<Entity>();

        for (const e of entities) {
            seen.add(e);
            const sm = world.get(e, StateMachine) as StateMachineData;
            const sv = world.get(e, StateVisuals) as StateVisualsData;
            const slot = findStateSlot(sv, sm.current);
            if (slot < 0) {
                transitions.delete(e);
                continue;
            }

            const target = sv.targetGraphic !== 0 ? sv.targetGraphic : e;
            const flags = sv.transitionFlags;
            const record = sv as unknown as Record<string, unknown>;
            const targetColor = record[`slot${slot}Color`] as Color;
            const targetScale = record[`slot${slot}Scale`] as number;
            const fade = Math.max(0, sv.fadeDuration);

            // Detect a slot change. If we have no prior entry OR the entry
            // points at a different slot, seed a new transition with the
            // target's *current* values as the "from" endpoint so the fade
            // blends from whatever the user/driver left there.
            let tx = transitions.get(e);
            if (!tx || tx.toSlot !== slot) {
                const startColor = (flags & TransitionFlag.ColorTint) && world.has(target, UIRenderer)
                    ? { ...(world.get(target, UIRenderer) as UIRendererData).color }
                    : { ...targetColor };
                const startScale = (flags & TransitionFlag.Scale) && world.has(target, Transform)
                    ? (world.get(target, Transform) as TransformData).scale.x
                    : targetScale;
                tx = { toSlot: slot, elapsed: 0, startColor, startScale };
                transitions.set(e, tx);
            } else {
                tx.elapsed += dt;
            }

            const t = fade > 0 ? Math.min(tx.elapsed / fade, 1) : 1;

            if ((flags & TransitionFlag.ColorTint) && world.has(target, UIRenderer)) {
                const r = world.get(target, UIRenderer) as UIRendererData;
                r.color = t >= 1 ? targetColor : lerpColor(tx.startColor, targetColor, t);
                world.insert(target, UIRenderer, r);
            }

            if ((flags & TransitionFlag.SpriteSwap) && world.has(target, UIRenderer)) {
                // Sprite swap is discrete: apply immediately at the slot change.
                const r = world.get(target, UIRenderer) as UIRendererData;
                r.texture = record[`slot${slot}Sprite`] as number;
                world.insert(target, UIRenderer, r);
            }

            if ((flags & TransitionFlag.Scale) && world.has(target, Transform)) {
                const tr = world.get(target, Transform) as TransformData;
                const s = t >= 1 ? targetScale : lerp(tx.startScale, targetScale, t);
                tr.scale = { x: s, y: s, z: 1 };
                world.insert(target, Transform, tr);
            }

            if (t >= 1) {
                transitions.delete(e);
            }
        }

        // Purge entries whose entity vanished or no longer carries the components.
        if (transitions.size > 0) {
            for (const e of transitions.keys()) {
                if (!seen.has(e) || !world.valid(e)) transitions.delete(e);
            }
        }
    }, { name: 'StateVisualsApplySystem' });
}
