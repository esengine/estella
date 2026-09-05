// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Animator.ts
 * @brief   Animation state machine (pure TypeScript) over motions of any kind.
 *
 * Design (per REARCH_2D_PARITY.md T2): the state machine is a *strategy layer*
 * over the engine's animation channels — it does not run its own clip playback.
 * A state names a MOTION; a {@link MotionDriver} registered for that motion's
 * kind is what plays it, so the graph is the same whether the entity is a sprite
 * sheet or a skinned model, and a new kind of animation is a registration rather
 * than another branch through here. Parameters/triggers drive transitions,
 * mirroring the Unity Animator's SetFloat/SetBool/SetTrigger model.
 *
 * The transition evaluator ({@link evaluateAnimatorTransitions}) is pure — no
 * World, no side effects — so it is fully unit-testable.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import { isUuidRef } from '../asset/AssetRegistry';
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import {
    MotionRegistry, blend1DMotionDriver,
    type AnimatorMotion, type AnimatorClipMotion, type AnimatorBlend1DMotion,
    type MotionContext, type MotionDriver,
} from './motion';
import { SPRITE_MOTION, spriteMotionDriver } from './spriteMotion';
import { Pose } from './pose';
import { mixPoses } from './poseMix';

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
     * Seconds to blend from the state being left into the one being entered.
     * Absent or 0 cuts. Honoured only where both motions can be sampled: a
     * sprite sheet is switched, having nothing to be halfway between.
     */
    duration?: number;
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
    /**
     * What this state plays, of any registered kind (`sprite`, `timeline`, a
     * blend over either). Takes precedence over the single-kind fields below,
     * which are the same thing spelled for one kind and are migrated to this.
     */
    motion?: AnimatorMotion;
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
    /** Editor-only canvas position; the interpreter ignores it. */
    x?: number;
    y?: number;
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
): { to: string; usedTriggers: string[]; fadeDuration: number } | null {
    for (const t of list) {
        if (t.hasExitTime && !clipFinished) continue;
        const used: string[] = [];
        let ok = true;
        for (const c of t.conditions) {
            if (!conditionHolds(c, params, triggers)) { ok = false; break; }
            if (c.op === 'trigger') used.push(c.param);
        }
        if (ok) return { to: t.to, usedTriggers: used, fadeDuration: t.duration ?? 0 };
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
    /** Seconds the fired transition blends over; 0 when it cuts. */
    fadeDuration: number;
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
    if (!resolved) return { nextPath: null, consumedTriggers: [], fadeDuration: 0 };
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
            return {
                nextPath: next.join(STATE_PATH_SEP),
                consumedTriggers: fired.usedTriggers,
                fadeDuration: fired.fadeDuration,
            };
        }
    }
    return { nextPath: null, consumedTriggers: [], fadeDuration: 0 };
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

/** Motion kind for a Spine animation; the spine module registers its driver. */
export const SPINE_MOTION = 'spine';

/**
 * Migrated motions, keyed by the state that spelled one the single-kind way.
 * A controller's states are stable objects, so this converts once rather than
 * every frame — and keeps `motionOf` free to return a fresh shape without
 * allocating one per tick.
 */
const migratedMotions = new WeakMap<AnimatorState, AnimatorMotion | null>();

/** A legacy 1D blend over sprite clips, as the equivalent blend over motions.
 *  A stop's own speed/loop wins over the state's, which is what it did before. */
function spriteBlendMotion(st: AnimatorState, blend: AnimatorBlend1D): AnimatorBlend1DMotion {
    return {
        kind: 'blend1d',
        parameter: blend.parameter,
        thresholds: blend.thresholds.map(t => ({
            value: t.value,
            motion: {
                kind: SPRITE_MOTION,
                clip: t.clip,
                speed: t.speed ?? st.speed,
                loop: t.loop ?? st.loop,
            } satisfies AnimatorClipMotion,
        })),
    };
}

/**
 * What a state plays, whichever way it was authored: `motion`, or the
 * `clip`/`blend`/`spine` fields every controller written before motions used.
 * Read here rather than rewritten on load, so those keep working untouched.
 * Null for a state with no motion of its own (a container).
 */
export function motionOf(st: AnimatorState): AnimatorMotion | null {
    const cached = migratedMotions.get(st);
    if (cached !== undefined) return cached;

    let motion: AnimatorMotion | null = null;
    if (st.motion) motion = st.motion;
    else if (st.spine) {
        motion = { kind: SPINE_MOTION, clip: st.spine.animation, loop: st.spine.loop };
    } else if (st.blend) motion = spriteBlendMotion(st, st.blend);
    else if (st.clip) {
        motion = { kind: SPRITE_MOTION, clip: st.clip, speed: st.speed, loop: st.loop };
    }

    migratedMotions.set(st, motion);
    return motion;
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

/** The fields of the `Animator` component, whose tier this shape carries.
 *  @beta */
export interface AnimatorData {
    /** Registered controller name (see AnimatorControllerAPI.registerController). */
    controller: string;
    /** Active state; empty until the first update seeds it from initialState. */
    currentState: string;
    enabled: boolean;
}

/**
 * A state machine over clips: the controller decides which clip plays from the
 * parameters a game writes, so gameplay sets `speed` or fires a trigger rather
 * than naming a clip.
 *
 * @beta
 */
export const Animator: ComponentDef<AnimatorData> = defineComponent('Animator', {
    controller: '',
    currentState: '',
    enabled: true,
}, {
    assetFields: [{ field: 'controller', type: 'animatorcontroller' }],
    // Preload a `.esanimator` path (or an editor-serialized uuid ref) with the
    // scene so the controller is registered before the first tick. A plain
    // `registerController` name (code path) is left alone — this callback is the
    // discovery authority; the assetField above only drives the editor picker.
    discoverAssets: data => {
        const c = data.controller;
        return typeof c === 'string' && (c.endsWith('.esanimator') || isUuidRef(c))
            ? [{ type: 'animatorcontroller', path: c }]
            : [];
    },
});

/**
 * Controllers a game registered in CODE by path, process-wide. Not where a
 * `.esanimator` lands — an asset belongs to the realm that loaded it, which is
 * why {@link AnimatorControllerAPI.getController} asks its own registrations,
 * then its realm, and only then here.
 */
const animatorControllerStore = new Map<string, AnimatorControllerDef>();

/** Register a controller under `key` (an asset path); the loader and any code
 *  path that keys by path share this store. */
export function registerAnimatorController(key: string, def: AnimatorControllerDef): void {
    animatorControllerStore.set(key, def);
}

export function getRegisteredAnimatorController(key: string): AnimatorControllerDef | undefined {
    return animatorControllerStore.get(key);
}

/** Drop all path-registered controllers (tests / hot-reload). */
export function clearAnimatorControllerStore(): void {
    animatorControllerStore.clear();
}

// =============================================================================
// AnimatorController — per-App registry + parameters + driving system
// =============================================================================

/**
 * Owns one App's animator-controller registry and per-entity parameter/trigger
 * values, evaluates each Animator's state machine, and drives the entity's
 * SpriteAnimator clip on state changes. Published as the {@link AnimatorController}
 * resource; read it as `app.getResource(AnimatorController)`.
 */
export class AnimatorControllerAPI {
    private assetControllers_: ((ref: string) => AnimatorControllerDef | undefined) | null = null;
    private readonly controllers = new Map<string, AnimatorControllerDef>();
    private readonly params = new Map<Entity, Map<string, number | boolean>>();
    private readonly triggers = new Map<Entity, Set<string>>();
    private readonly runtimes_ = new Map<Entity, AnimatorRuntime>();
    private readonly motions_ = new MotionRegistry();

    constructor() {
        // The kinds the animation core itself can play. Everything else — a
        // timeline, a spine track — is registered by the module that owns it,
        // which is what keeps this file from importing them.
        this.motions_.register(SPRITE_MOTION, spriteMotionDriver);
        this.motions_.register('blend1d', blend1DMotionDriver);
    }

    /**
     * Teach this animator a kind of motion. Called by the plugin that owns the
     * kind (TimelinePlugin, SpinePlugin); a state naming an unregistered kind is
     * inert rather than an error, since a scene may be authored against a module
     * this build does not load.
     */
    registerMotionDriver<M extends AnimatorMotion>(
        kind: M['kind'], driver: MotionDriver<M>,
    ): void {
        this.motions_.register(kind, driver);
    }

    /** Whether some driver can play `kind` here. */
    hasMotionDriver(kind: string): boolean {
        return this.motions_.has(kind);
    }

    /** Inject the Spine driver (SpinePlugin wires SpineManager here). Optional —
     *  without it, spine-targeting states are inert. */
    setSpineDriver(driver: SpineAnimationDriver | null): void {
        if (!driver) {
            this.motions_.unregister(SPINE_MOTION);
            return;
        }
        this.motions_.register<AnimatorClipMotion>(SPINE_MOTION, {
            // On entry only: SpineManager owns track playback and mixing, and
            // re-setting the animation every frame would restart it every frame.
            apply: (ctx: MotionContext, motion: AnimatorClipMotion, enter: boolean) => {
                if (enter) driver.setAnimation(ctx.entity, motion.clip, motion.loop ?? true);
            },
            // Track completion lives in SpineManager, which this seam does not
            // read; an exit-time transition out of a spine state needs a condition.
            isFinished: () => false,
        });
    }

    // -- controller registry --------------------------------------------------

    registerController(name: string, def: AnimatorControllerDef): void {
        this.controllers.set(name, def);
    }

    unregisterController(name: string): void {
        this.controllers.delete(name);
    }

    /**
     * @internal Where a `.esanimator` comes from: this app's realm. Set by the
     * animation plugin; without one only code registrations answer.
     */
    useAssetControllers(source: (ref: string) => AnimatorControllerDef | undefined): void {
        this.assetControllers_ = source;
    }

    getController(name: string): AnimatorControllerDef | undefined {
        // A code-registered name wins, then this realm's asset, then a
        // controller registered by path through the module door.
        return this.controllers.get(name)
            ?? this.assetControllers_?.(name)
            ?? getRegisteredAnimatorController(name);
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

    /** Drop an entity's parameter/trigger/playback state (wire to world.onDespawn). */
    removeEntity(entity: Entity): void {
        this.params.delete(entity);
        this.triggers.delete(entity);
        this.runtimes_.delete(entity);
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

    /** `dt` seconds advance the animator's own clock, which is what a sampled
     *  motion is evaluated against and what a crossfade progresses on. */
    update(world: World, dt: number = 0): void {
        const entities = world.getEntitiesWithComponents([Animator]);
        for (const entity of entities) {
            const a = world.get(entity, Animator) as AnimatorData;
            if (!a.enabled) continue;

            const def = this.getController(a.controller);
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
            const ctx = this.motions_.context(world, entity, params);
            const rt = this.runtimeFor(entity);
            // Advance BEFORE asking whether the motion ran out: judging the clip
            // on the previous frame's clock holds every exit-time transition one
            // frame past the clip it was waiting for.
            this.advance(rt, dt);
            const leafMotion = motionOf(leaf);
            const clipFinished = leafMotion !== null && this.motionEnded(ctx, leafMotion, rt.time);

            const { nextPath, consumedTriggers, fadeDuration } = evaluateAnimatorPath(
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
            if (!targetLeaf) continue;
            // Drive the active leaf every frame: a blend's selection can change as
            // its parameter crosses a threshold without any state change. A driver
            // is a no-op in steady state, which is what keeps that cheap.
            const motion = targetLeaf === leaf ? leafMotion : motionOf(targetLeaf);

            if (stateChanged) {
                this.beginState(rt, leafMotion, motion, fadeDuration);
            }
            if (motion) this.driveMotion(ctx, world, rt, motion, stateChanged);
        }
    }

    /**
     * Enter a state: the clock restarts, and the motion being left keeps running
     * as the thing to fade out of. Only when BOTH can be sampled - a switched
     * motion has no partial state to hold, so a fade over one would be a pause.
     */
    private beginState(
        rt: AnimatorRuntime,
        leaving: AnimatorMotion | null, entering: AnimatorMotion | null, fadeDuration: number,
    ): void {
        const blendable = fadeDuration > 0 && leaving !== null && entering !== null
            && this.canSample(leaving) && this.canSample(entering);
        if (blendable) {
            rt.fadeFrom = leaving;
            rt.fadeFromTime = rt.time;
            rt.fadeElapsed = 0;
            rt.fadeDuration = fadeDuration;
        } else {
            rt.fadeFrom = null;
        }
        rt.time = 0;
    }

    /** Advance the state's clock, and the fade's if one is running. */
    private advance(rt: AnimatorRuntime, dt: number): void {
        rt.time += dt;
        if (rt.fadeFrom === null) return;
        rt.fadeFromTime += dt;
        rt.fadeElapsed += dt;
        if (rt.fadeElapsed >= rt.fadeDuration) rt.fadeFrom = null;
    }

    /**
     * Put the motion on the entity. Through a pose where it can be sampled - two
     * composed while a fade runs - so what lands does not depend on sample order.
     */
    private driveMotion(
        ctx: MotionContext, world: World, rt: AnimatorRuntime,
        motion: AnimatorMotion, enter: boolean,
    ): void {
        if (rt.fadeFrom !== null) {
            rt.poseFrom.reset();
            rt.poseTo.reset();
            const from = ctx.sample(rt.fadeFrom, rt.fadeFromTime, rt.poseFrom);
            const to = ctx.sample(motion, rt.time, rt.poseTo);
            if (from && to) {
                const t = Math.min(rt.fadeElapsed / rt.fadeDuration, 1);
                rt.mixed.reset();
                mixPoses(
                    [{ pose: rt.poseFrom, weight: 1 - t }, { pose: rt.poseTo, weight: t }],
                    rt.mixed, world,
                );
                rt.mixed.applyTo(world);
                return;
            }
            rt.fadeFrom = null;
        }

        rt.poseTo.reset();
        if (ctx.sample(motion, rt.time, rt.poseTo)) {
            rt.poseTo.applyTo(world);
            return;
        }
        ctx.drive(motion, enter);
    }

    /** Whether a motion has run out. A clip whose length the driver states is
     *  judged against our clock; anything else answers for itself. */
    private motionEnded(ctx: MotionContext, motion: AnimatorMotion, time: number): boolean {
        if (ctx.loops(motion)) return false;
        const duration = ctx.duration(motion);
        return duration > 0 ? time >= duration : ctx.finished(motion);
    }

    private canSample(motion: AnimatorMotion): boolean {
        return this.motions_.driverFor(motion)?.sample !== undefined;
    }

    private runtimeFor(entity: Entity): AnimatorRuntime {
        let rt = this.runtimes_.get(entity);
        if (!rt) {
            rt = {
                time: 0, fadeFrom: null, fadeFromTime: 0, fadeElapsed: 0, fadeDuration: 0,
                poseFrom: new Pose(), poseTo: new Pose(), mixed: new Pose(),
            };
            this.runtimes_.set(entity, rt);
        }
        return rt;
    }
}

/** One entity's playback state: transient, so it lives here and not on the
 *  component, which is what a scene saves and an inspector shows. */
interface AnimatorRuntime {
    /** Seconds the current state's motion has been playing. */
    time: number;
    /** The motion being faded out, or null when nothing is. */
    fadeFrom: AnimatorMotion | null;
    fadeFromTime: number;
    fadeElapsed: number;
    fadeDuration: number;
    poseFrom: Pose;
    poseTo: Pose;
    mixed: Pose;
}

const EMPTY_PARAMS: ReadonlyMap<string, number | boolean> = new Map();
const EMPTY_TRIGGERS: ReadonlySet<string> = new Set();

/**
 * Per-App animator resource (controller registry + per-entity parameters),
 * published by `AnimationPlugin`. Read as `app.getResource(AnimatorController)`.
 */
export const AnimatorController = defineResource<AnimatorControllerAPI>(null!, 'AnimatorController');
