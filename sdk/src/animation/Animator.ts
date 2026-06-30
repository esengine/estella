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
    /**
     * Only fire once the current state's clip has finished (a non-looping sprite
     * clip reached its end). Combined with `conditions`, both must hold. With no
     * conditions, this is "auto-advance when the clip ends" (e.g. attack→idle).
     */
    hasExitTime?: boolean;
}

/** One stop on a 1D blend: at/above `value`, play `clip`. */
export interface AnimatorBlendThreshold {
    value: number;
    clip: string;
    speed?: number;
    loop?: boolean;
}

/**
 * 1D parameter-driven clip selection. The sprite channel plays one clip at a
 * time, so a "blend" here is a *selection* by threshold (idle→walk→run as a
 * speed parameter rises), not a weighted pose blend (that's the skeletal/Spine
 * follow-on). Thresholds may be given in any order.
 */
export interface AnimatorBlend1D {
    /** Float parameter that drives the selection. */
    parameter: string;
    thresholds: AnimatorBlendThreshold[];
}

/** A state that drives a Spine skeletal animation instead of a sprite clip. */
export interface AnimatorSpineMotion {
    animation: string;
    loop?: boolean;
}

/**
 * Minimal channel the Animator uses to drive Spine, kept here so the animation
 * core does not depend on the optional spine module. `SpineManager` satisfies it
 * structurally; `SpinePlugin` injects it via `AnimatorController.setSpineDriver`.
 */
export interface SpineAnimationDriver {
    setAnimation(entity: Entity, animation: string, loop: boolean): void;
}

/**
 * A nested state machine. A state carrying one is a *container* (it plays no
 * motion of its own); on entry the machine descends to `initialState`, and the
 * container state's own `transitions` are the edges that exit the whole machine.
 */
export interface AnimatorSubMachine {
    states: AnimatorState[];
    initialState: string;
    /** Transitions evaluated from every sub-state in this machine. */
    anyStateTransitions?: AnimatorTransition[];
}

export interface AnimatorState {
    name: string;
    /** Single sprite clip this state plays. Mutually exclusive with `blend`/`spine`/`stateMachine`. */
    clip?: string;
    /** 1D blend selection. Mutually exclusive with `clip`/`spine`/`stateMachine`. */
    blend?: AnimatorBlend1D;
    /** Drive a Spine animation instead of a sprite clip. */
    spine?: AnimatorSpineMotion;
    /** Nested machine — makes this a container state (no motion of its own). */
    stateMachine?: AnimatorSubMachine;
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

/**
 * The shape shared by the top-level controller and every nested machine: a set of
 * states, an entry point, and machine-wide any-state transitions.
 */
export type AnimatorScope = Pick<AnimatorControllerDef, 'states' | 'initialState' | 'anyStateTransitions'>;

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

/** First transition in `list` that is ready (conditions hold; exit time met if
 *  required), with the triggers it used. */
function firstReady(
    list: readonly AnimatorTransition[],
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean,
): { to: string; usedTriggers: string[] } | null {
    for (const t of list) {
        if (t.hasExitTime && !clipFinished) continue;
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
 * before the current state's. `clipFinished` gates `hasExitTime` transitions
 * (true = the current clip has ended); it defaults true so transitions without
 * exit time are unaffected. Returns the next state (or null to stay) and the
 * triggers a fired transition consumed. Pure.
 */
export function evaluateAnimatorTransitions(
    def: AnimatorControllerDef,
    currentState: string,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean = true,
): AnimatorEvalResult {
    const fromAny = firstReady(def.anyStateTransitions ?? [], params, triggers, clipFinished);
    const current = def.states.find((s) => s.name === currentState);
    const fired = fromAny ?? firstReady(current?.transitions ?? [], params, triggers, clipFinished);
    return fired
        ? { next: fired.to, consumedTriggers: fired.usedTriggers }
        : { next: null, consumedTriggers: [] };
}

// =============================================================================
// Nested state machines — path resolution + recursive evaluator (pure)
// =============================================================================

/** The active state is a `/`-separated path of state names (e.g. `Combat/Attack1`). */
export const STATE_PATH_SEP = '/';

/**
 * Descend from state `name` in `scope` to a concrete leaf, returning the path
 * segments. A container state (one with a `stateMachine`) recurses into its
 * `initialState`; a normal state ends the path.
 */
export function enterStatePath(scope: AnimatorScope, name: string): string[] {
    const st = scope.states.find((s) => s.name === name);
    if (!st || !st.stateMachine) return [name];
    return [name, ...enterStatePath(st.stateMachine, st.stateMachine.initialState)];
}

interface ResolvedPath {
    /** The scope that contains `states[i]` (top-level for i=0). */
    scopes: AnimatorScope[];
    /** The state chain from the outermost container down to the leaf. */
    states: AnimatorState[];
}

/** Resolve a path to its scope/state chain, or null if any segment is unknown. */
function resolveStatePath(top: AnimatorScope, segments: readonly string[]): ResolvedPath | null {
    if (segments.length === 0) return null;
    const scopes: AnimatorScope[] = [];
    const states: AnimatorState[] = [];
    let scope: AnimatorScope = top;
    for (const seg of segments) {
        const st = scope.states.find((s) => s.name === seg);
        if (!st) return null;
        scopes.push(scope);
        states.push(st);
        if (!st.stateMachine) break;
        scope = st.stateMachine;
    }
    return { scopes, states };
}

export interface AnimatorPathEvalResult {
    /** Target path if a transition fired, else null (stay). */
    nextPath: string | null;
    consumedTriggers: string[];
}

/**
 * Evaluate one step of a (possibly nested) state machine over a path. Transitions
 * are checked highest-priority first: top-level any-state, then each enclosing
 * machine's any-state from outermost in, then the leaf's own transitions, then the
 * container exit transitions from innermost out. A fired transition's `to` is
 * resolved within the machine that owns it (descending into a sub-machine's
 * initial state when needed). `clipFinished` reflects the leaf clip. Pure.
 */
export function evaluateAnimatorPath(
    def: AnimatorControllerDef,
    currentPath: string,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean = true,
): AnimatorPathEvalResult {
    const segments = currentPath ? currentPath.split(STATE_PATH_SEP) : [];
    const resolved = resolveStatePath(def, segments);
    if (!resolved) return { nextPath: null, consumedTriggers: [] };
    const { scopes, states } = resolved;
    const depth = states.length;

    // (list, owning scope, path to that scope) in priority order.
    const lists: { list: readonly AnimatorTransition[]; scope: AnimatorScope; base: string[] }[] = [];
    lists.push({ list: def.anyStateTransitions ?? [], scope: def, base: [] });
    for (let i = 0; i < depth - 1; i++) {
        const sm = states[i].stateMachine!;
        lists.push({ list: sm.anyStateTransitions ?? [], scope: sm, base: segments.slice(0, i + 1) });
    }
    lists.push({ list: states[depth - 1].transitions ?? [], scope: scopes[depth - 1], base: segments.slice(0, depth - 1) });
    for (let i = depth - 2; i >= 0; i--) {
        lists.push({ list: states[i].transitions ?? [], scope: scopes[i], base: segments.slice(0, i) });
    }

    for (const entry of lists) {
        const fired = firstReady(entry.list, params, triggers, clipFinished);
        if (fired) {
            const next = [...entry.base, ...enterStatePath(entry.scope, fired.to)];
            return { nextPath: next.join(STATE_PATH_SEP), consumedTriggers: fired.usedTriggers };
        }
    }
    return { nextPath: null, consumedTriggers: [] };
}

/** The leaf (motion-bearing) state of a resolved path, or null if unresolvable. */
export function leafStateOf(def: AnimatorControllerDef, path: string): AnimatorState | null {
    const resolved = resolveStatePath(def, path ? path.split(STATE_PATH_SEP) : []);
    return resolved ? resolved.states[resolved.states.length - 1] : null;
}

/**
 * Select a 1D blend's clip for a parameter value: the threshold with the
 * greatest `value` ≤ `value`, clamped up to the first stop when below all.
 * Pure. Returns `{ clip: '' }` for an empty blend.
 */
export function selectBlendClip(blend: AnimatorBlend1D, value: number): AnimatorBlendThreshold {
    const sorted = [...blend.thresholds].sort((a, b) => a.value - b.value);
    if (sorted.length === 0) return { value: 0, clip: '' };
    let chosen = sorted[0];
    for (const t of sorted) {
        if (value >= t.value) chosen = t;
        else break;
    }
    return chosen;
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
    private spineDriver_: SpineAnimationDriver | null = null;

    /** Inject the Spine driver (SpinePlugin wires SpineManager here). Optional —
     *  without it, spine-targeting states are inert. */
    setSpineDriver(driver: SpineAnimationDriver | null): void {
        this.spineDriver_ = driver;
    }

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

            // Seed / repair the active state path. The path descends into a
            // sub-machine's initial state when the entry point is a container.
            let fromPath = a.currentState;
            let leaf = fromPath ? leafStateOf(def, fromPath) : null;
            if (!leaf) {
                fromPath = enterStatePath(def, def.initialState).join(STATE_PATH_SEP);
                leaf = leafStateOf(def, fromPath);
                if (!leaf) continue;
            }

            const params = resolveParams(def, this.params.get(entity) ?? EMPTY_PARAMS);
            const triggerSet = this.triggers.get(entity);
            // The leaf clip has finished when its SpriteAnimator is playing exactly
            // that clip and has stopped — not merely stopped (also true before the
            // clip is ever applied, e.g. the frame a state is entered). Only a
            // sprite leaf reports this; a spine leaf's completion is SpineManager's.
            const spNow = world.has(entity, SpriteAnimator)
                ? (world.get(entity, SpriteAnimator) as SpriteAnimatorData)
                : null;
            const expectedClip = !leaf.spine ? this.motionClipOf(leaf, params).clip : '';
            const clipFinished = expectedClip !== '' && spNow != null
                && spNow.clip === expectedClip && !spNow.playing;

            const { nextPath, consumedTriggers } = evaluateAnimatorPath(
                def, fromPath, params, triggerSet ?? EMPTY_TRIGGERS, clipFinished,
            );
            if (triggerSet) for (const t of consumedTriggers) triggerSet.delete(t);

            const target = nextPath ?? fromPath;
            const stateChanged = target !== a.currentState;
            if (stateChanged) {
                a.currentState = target;
                world.insert(entity, Animator, a);
            }
            const targetLeaf = nextPath ? leafStateOf(def, target) : leaf;
            // Apply the active leaf's motion every frame: a 1D-blend leaf's selected
            // clip can change as its parameter crosses a threshold without any state
            // change. A single-clip leaf in steady state is a no-op (cheap).
            if (targetLeaf) this.applyMotion(world, entity, targetLeaf, params, stateChanged);
        }
    }

    /**
     * Drive the entity's SpriteAnimator from a leaf state's motion (single clip or
     * 1D-blend selection). Writes only when the desired clip differs or the state
     * just changed — restarting from frame 0 on a switch.
     */
    private applyMotion(
        world: World, entity: Entity, st: AnimatorState,
        params: AnimatorParamValues, forceRestart: boolean,
    ): void {
        // Spine state: set the skeletal animation on entry (SpineManager owns the
        // track playback/mixing); don't re-set every frame or touch SpriteAnimator.
        if (st.spine) {
            if (forceRestart && this.spineDriver_) {
                this.spineDriver_.setAnimation(entity, st.spine.animation, st.spine.loop ?? true);
            }
            return;
        }

        if (!world.has(entity, SpriteAnimator)) return;
        const sel = this.motionClipOf(st, params);
        const sp = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
        if (sp.clip === sel.clip && !forceRestart) return;

        sp.clip = sel.clip;
        sp.speed = sel.speed ?? st.speed ?? 1.0;
        sp.loop = sel.loop ?? st.loop ?? true;
        sp.currentFrame = 0;
        sp.frameTimer = 0;
        sp.playing = true;
        sp.enabled = true;
        world.insert(entity, SpriteAnimator, sp);
    }

    /** The clip (and its speed/loop) a state would play for the given params:
     *  the single clip, or the 1D-blend selection. */
    private motionClipOf(st: AnimatorState, params: AnimatorParamValues): AnimatorBlendThreshold {
        return st.blend
            ? selectBlendClip(st.blend, Number(params[st.blend.parameter] ?? 0))
            : { value: 0, clip: st.clip ?? '', speed: st.speed, loop: st.loop };
    }
}

const EMPTY_PARAMS: ReadonlyMap<string, number | boolean> = new Map();
const EMPTY_TRIGGERS: ReadonlySet<string> = new Set();

/**
 * Per-App animator resource (controller registry + per-entity parameters),
 * published by `AnimationPlugin`. Read as `app.getResource(AnimatorController)`.
 */
export const AnimatorController = defineResource<AnimatorControllerApi>(null!, 'AnimatorController');
