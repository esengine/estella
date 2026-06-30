// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Animator.ts
 * @brief   Animation state machine (pure TypeScript), built on the existing
 *          sprite-animation channel.
 *
 * Design (per REARCH_2D_PARITY.md T2): the state machine is a *strategy layer*
 * over the existing animation channels — it does not run its own clip playback.
 * A state names a sprite clip; when a transition fires, the Animator switches the
 * entity's {@link SpriteAnimator}.clip. Frame playback stays the single
 * responsibility of {@link SpriteAnimationApi}. Parameters/triggers drive
 * transitions, mirroring the Unity Animator's SetFloat/SetBool/SetTrigger model.
 *
 * The transition evaluator ({@link evaluateAnimatorTransitions}) is pure — no
 * World, no side effects — so it is fully unit-testable.
 */

import { defineComponent, type ComponentDef } from '../component';
import { defineResource } from '../resource';
import type { Entity } from '../types';
import type { World } from '../world';
import { SpriteAnimator, type SpriteAnimatorData } from './SpriteAnimator';

// =============================================================================
// Controller definition (the graph data)
// =============================================================================

export type AnimatorParamType = 'float' | 'bool' | 'trigger';

export interface AnimatorParam {
    name: string;
    type: AnimatorParamType;
    /** Default value for float (number) / bool (boolean). Triggers default off. */
    default?: number | boolean;
}

/**
 * A transition condition. Numeric comparisons (`gt`/`lt`/`eq`/`neq`) carry a
 * `value`; `true`/`false` test a bool param; `trigger` fires when the named
 * trigger is set (and consumes it).
 */
export type AnimatorCondition =
    | { param: string; op: 'gt' | 'lt' | 'eq' | 'neq'; value: number }
    | { param: string; op: 'true' | 'false' | 'trigger' };

export interface AnimatorTransition {
    /** Target state name. */
    to: string;
    /** All conditions must hold (AND). Empty = unconditional. */
    conditions: AnimatorCondition[];
}

export interface AnimatorState {
    name: string;
    /** Sprite clip name this state plays (registered with SpriteAnimation). */
    clip: string;
    speed?: number;
    loop?: boolean;
    transitions: AnimatorTransition[];
}

export interface AnimatorControllerDef {
    parameters: AnimatorParam[];
    states: AnimatorState[];
    initialState: string;
    /** Transitions evaluated from every state, before the current state's own. */
    anyStateTransitions?: AnimatorTransition[];
}

// =============================================================================
// Pure transition evaluator (no World, no side effects → unit-testable)
// =============================================================================

export type AnimatorParamValues = Readonly<Record<string, number | boolean>>;

export interface AnimatorEvalResult {
    /** Target state if a transition fired, else null (stay). */
    next: string | null;
    /** Trigger params a fired transition consumed (caller resets them). */
    consumedTriggers: string[];
}

function conditionHolds(
    c: AnimatorCondition,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
): boolean {
    switch (c.op) {
        case 'gt': return Number(params[c.param] ?? 0) > c.value;
        case 'lt': return Number(params[c.param] ?? 0) < c.value;
        case 'eq': return Number(params[c.param] ?? 0) === c.value;
        case 'neq': return Number(params[c.param] ?? 0) !== c.value;
        case 'true': return params[c.param] === true;
        case 'false': return params[c.param] === false;
        case 'trigger': return triggers.has(c.param);
    }
}

/** First transition in `list` whose conditions all hold, with the triggers it used. */
function firstReady(
    list: readonly AnimatorTransition[],
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
): { to: string; usedTriggers: string[] } | null {
    for (const t of list) {
        const used: string[] = [];
        let ok = true;
        for (const c of t.conditions) {
            if (!conditionHolds(c, params, triggers)) { ok = false; break; }
            if (c.op === 'trigger') used.push(c.param);
        }
        if (ok) return { to: t.to, usedTriggers: used };
    }
    return null;
}

/**
 * Evaluate one step of the state machine. Any-state transitions are checked
 * before the current state's. Returns the next state (or null to stay) and the
 * triggers a fired transition consumed. Pure.
 */
export function evaluateAnimatorTransitions(
    def: AnimatorControllerDef,
    currentState: string,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
): AnimatorEvalResult {
    const fromAny = firstReady(def.anyStateTransitions ?? [], params, triggers);
    const current = def.states.find((s) => s.name === currentState);
    const fired = fromAny ?? firstReady(current?.transitions ?? [], params, triggers);
    return fired
        ? { next: fired.to, consumedTriggers: fired.usedTriggers }
        : { next: null, consumedTriggers: [] };
}

/** Merge a controller's declared parameter defaults with per-entity overrides. */
export function resolveParams(
    def: AnimatorControllerDef,
    overrides: ReadonlyMap<string, number | boolean>,
): Record<string, number | boolean> {
    const out: Record<string, number | boolean> = {};
    for (const p of def.parameters) {
        if (p.type === 'trigger') continue;
        out[p.name] = p.default ?? (p.type === 'bool' ? false : 0);
    }
    for (const [k, v] of overrides) out[k] = v;
    return out;
}

// =============================================================================
// Animator component
// =============================================================================

export interface AnimatorData {
    /** Registered controller name (see AnimatorControllerApi.registerController). */
    controller: string;
    /** Active state; empty until the first update seeds it from initialState. */
    currentState: string;
    enabled: boolean;
}

export const Animator: ComponentDef<AnimatorData> = defineComponent('Animator', {
    controller: '',
    currentState: '',
    enabled: true,
});

// =============================================================================
// AnimatorController — per-App registry + parameters + driving system
// =============================================================================

/**
 * Owns one App's animator-controller registry and per-entity parameter/trigger
 * values, evaluates each Animator's state machine, and drives the entity's
 * SpriteAnimator clip on state changes. Published as the {@link AnimatorController}
 * resource; read it as `app.getResource(AnimatorController)`.
 */
export class AnimatorControllerApi {
    private readonly controllers = new Map<string, AnimatorControllerDef>();
    private readonly params = new Map<Entity, Map<string, number | boolean>>();
    private readonly triggers = new Map<Entity, Set<string>>();

    // -- controller registry --------------------------------------------------

    registerController(name: string, def: AnimatorControllerDef): void {
        this.controllers.set(name, def);
    }

    unregisterController(name: string): void {
        this.controllers.delete(name);
    }

    getController(name: string): AnimatorControllerDef | undefined {
        return this.controllers.get(name);
    }

    clearControllers(): void {
        this.controllers.clear();
    }

    // -- parameters / triggers ------------------------------------------------

    setFloat(entity: Entity, name: string, value: number): void {
        this.paramStore(entity).set(name, value);
    }

    setBool(entity: Entity, name: string, value: boolean): void {
        this.paramStore(entity).set(name, value);
    }

    setTrigger(entity: Entity, name: string): void {
        this.triggerStore(entity).add(name);
    }

    resetTrigger(entity: Entity, name: string): void {
        this.triggers.get(entity)?.delete(name);
    }

    getFloat(entity: Entity, name: string): number {
        return Number(this.params.get(entity)?.get(name) ?? 0);
    }

    getBool(entity: Entity, name: string): boolean {
        return this.params.get(entity)?.get(name) === true;
    }

    /** Drop an entity's parameter/trigger state (wire to world.onDespawn). */
    removeEntity(entity: Entity): void {
        this.params.delete(entity);
        this.triggers.delete(entity);
    }

    private paramStore(entity: Entity): Map<string, number | boolean> {
        let m = this.params.get(entity);
        if (!m) { m = new Map(); this.params.set(entity, m); }
        return m;
    }

    private triggerStore(entity: Entity): Set<string> {
        let s = this.triggers.get(entity);
        if (!s) { s = new Set(); this.triggers.set(entity, s); }
        return s;
    }

    // -- per-frame system -----------------------------------------------------

    update(world: World): void {
        const entities = world.getEntitiesWithComponents([Animator]);
        for (const entity of entities) {
            const a = world.get(entity, Animator) as AnimatorData;
            if (!a.enabled) continue;

            const def = this.controllers.get(a.controller);
            if (!def || def.states.length === 0) continue;

            // Seed / repair the active state.
            const known = a.currentState && def.states.some((s) => s.name === a.currentState);
            const fromState = known ? a.currentState : def.initialState;

            const params = resolveParams(def, this.params.get(entity) ?? EMPTY_PARAMS);
            const triggerSet = this.triggers.get(entity);
            const { next, consumedTriggers } = evaluateAnimatorTransitions(
                def, fromState, params, triggerSet ?? EMPTY_TRIGGERS,
            );
            if (triggerSet) for (const t of consumedTriggers) triggerSet.delete(t);

            const target = next ?? fromState;
            if (target !== a.currentState) {
                a.currentState = target;
                this.applyState(world, entity, def, target);
                world.insert(entity, Animator, a);
            }
        }
    }

    /** Switch the entity's SpriteAnimator to the state's clip (restart from frame 0). */
    private applyState(world: World, entity: Entity, def: AnimatorControllerDef, stateName: string): void {
        const st = def.states.find((s) => s.name === stateName);
        if (!st || !world.has(entity, SpriteAnimator)) return;
        const sp = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
        sp.clip = st.clip;
        sp.speed = st.speed ?? 1.0;
        sp.loop = st.loop ?? true;
        sp.currentFrame = 0;
        sp.frameTimer = 0;
        sp.playing = true;
        sp.enabled = true;
        world.insert(entity, SpriteAnimator, sp);
    }
}

const EMPTY_PARAMS: ReadonlyMap<string, number | boolean> = new Map();
const EMPTY_TRIGGERS: ReadonlySet<string> = new Set();

/**
 * Per-App animator resource (controller registry + per-entity parameters),
 * published by `AnimationPlugin`. Read as `app.getResource(AnimatorController)`.
 */
export const AnimatorController = defineResource<AnimatorControllerApi>(null!, 'AnimatorController');
