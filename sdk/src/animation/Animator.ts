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
 * set with SetFloat/SetBool/SetTrigger.
 *
 * The transition evaluator ({@link evaluateAnimatorTransitions}) is pure — no
 * World, no side effects — so it is fully unit-testable.
 */

import { registeredAssetFields } from '../asset/registeredAssetFields';
import { defineComponent, namedFieldDiscovery, type ComponentDef } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import type { Entity, Vec3 } from '../types';
import type { World } from '../ecs/world';
import {
    MotionRegistry, blend1DMotionDriver, blend2DMotionDriver,
    type AnimatorMotion, type AnimatorClipMotion, type AnimatorBlend1DMotion,
    type MotionContext, type MotionDriver, type MotionEvent, type MotionSpan, type MotionWindow,
    type RootMotionDelta,
} from './motion';
import { SPRITE_MOTION, spriteMotionDriver } from './spriteMotion';
import { Pose } from './pose';
import { poseStorageFor, type PoseStorage } from './poseStorage';
import { mixPoses, type WeightedPose } from './poseMix';
import { overlayPose, addPoseOver } from './layerStack';
import { MaskReach, type AnimatorMask } from './animatorMask';
import {
    avatarResolver, rebasePose, travelRatio, type AnimatorAvatar, type JointResolver,
} from './animatorAvatar';
import { solveAnimatorIK, type AnimatorIK, type GroundContext, type GroundProbe } from './animatorIK';
import { AnimatorRootMotion, type AnimatorRootMotionData } from './animatorRootMotion';
import { applyInertia, beginInertia, recordInertia, type InertiaState } from './inertialize';
import type { AnimatorEventSink } from './animatorEvent';
import { Parent, Transform, type TransformData } from '../ecs/component';
import { q } from '../math/quat';

// =============================================================================
// Controller definition (the graph data)
// =============================================================================

export type AnimatorParamType = 'float' | 'bool' | 'trigger';

export interface AnimatorParam {
    name: string;
    type: AnimatorParamType;
    /** Default value for float (number) / bool (boolean). Triggers default off. */
    default?: number | boolean;
    /**
     * A trigger's input buffer, in seconds of animator time: a set trigger no
     * transition uses within this long is dropped. A press made a little before a
     * combo window opens still chains; one made long before does not fire an
     * attack nobody asked for when the current one ends. Absent, a trigger waits
     * until a transition uses it.
     */
    buffer?: number;
}

/**
 * A transition condition. Numeric comparisons (`gt`/`lt`/`eq`/`neq`) carry a
 * `value`; `true`/`false` test a bool param; `trigger` fires when the named
 * trigger is set (and consumes it); `window` holds while the state being left
 * has the window `param` names open (a combo's input window: a custom event with
 * a duration on its clip), so a chain is taken only where the clip allows it.
 * An empty name leaves the condition unbound and unable to pass.
 */
export type AnimatorCondition =
    | { param: string; op: 'gt' | 'lt' | 'eq' | 'neq'; value: number }
    | { param: string; op: 'true' | 'false' | 'trigger' | 'window' };

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
     * How the two motions meet over `duration`. `crossfade` samples both and mixes them; `inertialize` plays the
     * new one at once and lets the difference from where the old one had each joint die away (inertialize.ts), so the
     * character is never in two motions at once. Absent takes the controller's `transitionBlend`.
     */
    blend?: AnimatorTransitionBlend;
    /**
     * Only fire once the current state's clip has finished (a non-looping sprite
     * clip reached its end). Combined with `conditions`, both must hold. With no
     * conditions, this is "auto-advance when the clip ends" (e.g. attack→idle).
     */
    hasExitTime?: boolean;
}

/** How a transition carries the character from one motion to the next. */
export type AnimatorTransitionBlend = 'crossfade' | 'inertialize';

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
    /**
     * This state's motion states where the CHARACTER goes, not how it is posed:
     * its root track leaves the pose and becomes a request on
     * {@link AnimatorRootMotion}. Per state, because a locomotion state is
     * stick-driven and a lunge is not, and the export cannot say which.
     */
    rootMotion?: boolean;
    speed?: number;
    /**
     * A float parameter that multiplies how fast this state plays: its clock advances by `dt * parameter`, so a run clip follows a character's
     * speed and a parameter of 0 holds the pose. Whatever the motion's kind, because it is the state's clock that is scaled. A missing or
     * negative parameter plays at the normal rate or stops, never backwards.
     */
    speedParameter?: string;
    /**
     * A float parameter saying how far the character has left to go before it stops, in world units: the state is then
     * played by distance rather than by time. Each frame it is put at the point of its motion that has that much
     * travel left in its root track, so a stop clip's feet come to rest where the character does however hard it
     * brakes; once the distance is spent the clip plays on by time and settles. Never backwards. For a stop, start or
     * turn clip with a root track whose pace changes (a model imported with Root Motion, Its Own Pace).
     */
    distanceParameter?: string;
    /** World units of travel left under which a state played by distance plays on by time instead. Default 2. */
    distanceFloor?: number;
    /** The most a state played by distance is run ahead of its own pace in one frame, as a multiple of it. Default 2.5. */
    distanceMaxPace?: number;
    loop?: boolean;
    transitions: AnimatorTransition[];
    /** Editor-only canvas position; the interpreter ignores it. */
    x?: number;
    y?: number;
}

/** How a layer's pose meets what the layers under it already said. */
export type AnimatorLayerBlend = 'override' | 'additive';

/**
 * A layer over the base one: a state machine of its own, and how much of what it
 * says survives. Neither `weight` nor `blend` exists on the base layer, both
 * being statements about what is underneath and nothing being.
 */
export interface AnimatorLayer extends AnimatorScope {
    name: string;
    /** 0 leaves the layers below untouched, 1 states this layer whole. */
    weight?: number;
    blend?: AnimatorLayerBlend;
    /** Which part of the rig this layer may write; absent is all of it. */
    mask?: AnimatorMask;
}

/** What a `.esanimator` this build writes claims. */
export const ANIMATOR_FORMAT_VERSION = 2;

export interface AnimatorControllerDef {
    /**
     * Absent is 1, the shape before layers. A file claiming a version this build
     * does not know is refused rather than read for the parts it recognises,
     * which would drop a layer silently and animate the wrong character.
     */
    version?: number;
    parameters: AnimatorParam[];
    states: AnimatorState[];
    initialState: string;
    /** Transitions evaluated from every state, before the current state's own. */
    anyStateTransitions?: AnimatorTransition[];
    /** How a transition that does not say blends: `crossfade` when absent. Inertialization applies to the base layer. */
    transitionBlend?: AnimatorTransitionBlend;
    /**
     * The `.esavatar` this controller's CLIPS were authored against. With one on
     * the rig as well, a pose is restated from that rig's bind pose to this one;
     * without it a name map alone is only right between rigs that share a bind
     * pose.
     */
    avatar?: string;
    /** Layers over the base one, laid down in order. */
    layers?: AnimatorLayer[];
    /**
     * Constraints applied to the stack's answer, in order. Not per layer: a layer
     * answers who is speaking, and a foot belongs on the ground whichever one
     * decided how the leg swings.
     */
    ik?: AnimatorIK[];
}

/**
 * The shape shared by the top-level controller, every layer and every nested
 * machine: a set of states, an entry point, and machine-wide any-state
 * transitions.
 */
export type AnimatorScope = Pick<AnimatorControllerDef, 'states' | 'initialState' | 'anyStateTransitions'>;

/** How many state machines run on one entity: the base layer and those over it. */
export function animatorLayerCount(def: AnimatorControllerDef): number {
    return 1 + (def.layers?.length ?? 0);
}

/**
 * Layer `index`'s active state. Read and written through here so each layer's
 * state has one home: the base layer's is `currentState`, which is what a
 * single-layer controller has always had and what every reader of one expects.
 */
export function layerState(a: AnimatorData, index: number): string {
    return index === 0 ? a.currentState : (a.layerStates?.[index - 1] ?? '');
}

export function setLayerState(a: AnimatorData, index: number, path: string): void {
    if (index === 0) { a.currentState = path; return; }
    if (!a.layerStates) a.layerStates = [];
    while (a.layerStates.length < index) a.layerStates.push('');
    a.layerStates[index - 1] = path;
}

/** Layer `index`, the base one at 0. Null for an index the controller has not got. */
export function animatorLayer(def: AnimatorControllerDef, index: number): AnimatorScope | null {
    if (index === 0) return def;
    return def.layers?.[index - 1] ?? null;
}

/**
 * Every machine a controller runs, base layer first. The ONE way to walk them: a
 * reader that reaches for `def.states` sees the base layer and calls it the
 * controller, which is how the loader shipped acquiring no clip any layer played
 * — silent in a real project, green in every hand-built test.
 */
export function animatorScopes(def: AnimatorControllerDef): AnimatorScope[] {
    return [def, ...(def.layers ?? [])];
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

const NO_OPEN_WINDOWS: ReadonlySet<string> = new Set();

function conditionHolds(
    c: AnimatorCondition,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    windows: ReadonlySet<string>,
): boolean {
    if (!c.param) return false;
    switch (c.op) {
        case 'gt': return Number(params[c.param] ?? 0) > c.value;
        case 'lt': return Number(params[c.param] ?? 0) < c.value;
        case 'eq': return Number(params[c.param] ?? 0) === c.value;
        case 'neq': return Number(params[c.param] ?? 0) !== c.value;
        case 'true': return params[c.param] === true;
        case 'false': return params[c.param] === false;
        case 'trigger': return triggers.has(c.param);
        case 'window': return windows.has(c.param);
    }
}

interface ReadyTransition {
    targetPath: string[];
    usedTriggers: string[];
    fadeDuration: number;
    blend?: AnimatorTransitionBlend;
}

/** First ready transition with a valid destination, and the triggers it used. */
function firstReady(
    scope: AnimatorScope,
    list: readonly AnimatorTransition[] | undefined,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean,
    windows: ReadonlySet<string>,
): ReadyTransition | null {
    if (!list) return null;
    for (const t of list) {
        if (t.hasExitTime && !clipFinished) continue;
        let used: string[] | undefined;
        let ok = true;
        for (const c of t.conditions) {
            if (!conditionHolds(c, params, triggers, windows)) { ok = false; break; }
            if (c.op === 'trigger') (used ??= []).push(c.param);
        }
        if (!ok) continue;
        const entry = stateEntry(scope, t.to);
        if (entry.hasLeaf) return { targetPath: entry.path, usedTriggers: used ?? [], fadeDuration: t.duration ?? 0, blend: t.blend };
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
    def: AnimatorScope,
    currentState: string,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean = true,
    windows: ReadonlySet<string> = NO_OPEN_WINDOWS,
): AnimatorEvalResult {
    const fromAny = firstReady(def, def.anyStateTransitions, params, triggers, clipFinished, windows);
    const current = def.states.find((s) => s.name === currentState);
    const fired = fromAny ?? firstReady(def, current?.transitions, params, triggers, clipFinished, windows);
    return fired
        ? { next: fired.targetPath[0], consumedTriggers: fired.usedTriggers }
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
    return stateEntry(scope, name).path;
}

function stateEntry(scope: AnimatorScope, name: string): { path: string[]; hasLeaf: boolean } {
    const path = [name];
    let state = scope.states.find(s => s.name === name);
    while (state?.stateMachine) {
        const machine = state.stateMachine;
        path.push(machine.initialState);
        state = machine.states.find(s => s.name === machine.initialState);
    }
    return { path, hasLeaf: state !== undefined };
}

interface ResolvedPath {
    segments: string[];
    /** The scope that contains `states[i]` (top-level for i=0). */
    scopes: AnimatorScope[];
    /** The state chain from the outermost container down to the leaf. */
    states: AnimatorState[];
}

/** Resolve a path to its scope/state chain, or null if any segment is unknown. */
function resolveStatePath(top: AnimatorScope, path: string): ResolvedPath | null {
    if (!path) return null;
    const segments = path.split(STATE_PATH_SEP);
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
    return { segments, scopes, states };
}

export interface AnimatorPathEvalResult {
    /** Target path if a transition fired, else null (stay). */
    nextPath: string | null;
    consumedTriggers: string[];
    /** Seconds the fired transition blends over; 0 when it cuts. */
    fadeDuration: number;
    /** How the fired transition says it blends; absent takes the controller's. */
    blend?: AnimatorTransitionBlend;
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
    def: AnimatorScope,
    currentPath: string,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean = true,
    windows: ReadonlySet<string> = NO_OPEN_WINDOWS,
): AnimatorPathEvalResult {
    const resolved = resolveStatePath(def, currentPath);
    if (!resolved) return { nextPath: null, consumedTriggers: [], fadeDuration: 0 };
    return evaluateResolvedAnimatorPath(resolved, params, triggers, clipFinished, windows);
}

function evaluateResolvedAnimatorPath(
    resolved: ResolvedPath,
    params: AnimatorParamValues,
    triggers: ReadonlySet<string>,
    clipFinished: boolean,
    windows: ReadonlySet<string>,
): AnimatorPathEvalResult {
    const { segments, scopes, states } = resolved;
    // Any State edges run from the outermost machine inward.
    for (let i = 0; i < scopes.length; i++) {
        const scope = scopes[i];
        const fired = firstReady(scope, scope.anyStateTransitions, params, triggers, clipFinished, windows);
        if (fired) return pathTransitionResult(segments, i, fired);
    }
    // The leaf runs before its containers, whose edges exit to their owning machine.
    for (let i = states.length - 1; i >= 0; i--) {
        const fired = firstReady(scopes[i], states[i].transitions, params, triggers, clipFinished, windows);
        if (fired) return pathTransitionResult(segments, i, fired);
    }
    return { nextPath: null, consumedTriggers: [], fadeDuration: 0 };
}

function pathTransitionResult(segments: string[], depth: number, fired: ReadyTransition): AnimatorPathEvalResult {
    const target = fired.targetPath.join(STATE_PATH_SEP);
    return {
        nextPath: depth === 0 ? target : segments.slice(0, depth).join(STATE_PATH_SEP) + STATE_PATH_SEP + target,
        consumedTriggers: fired.usedTriggers,
        fadeDuration: fired.fadeDuration,
        blend: fired.blend,
    };
}

/** The leaf (motion-bearing) state of a resolved path, or null if unresolvable. */
export function leafStateOf(def: AnimatorScope, path: string): AnimatorState | null {
    const resolved = resolveStatePath(def, path);
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
/**
 * A window an animated entity's active motion holds open: a stretch of a clip
 * declared as lasting (a custom event with a duration), reported while the playhead
 * is inside it.
 *
 * @experimental
 */
export interface AnimatorWindow {
    /** One opening: the same while it stays open, new each time it opens. */
    id: number;
    /** The animator layer whose motion holds it. */
    layer: number;
    name: string;
    value: number;
    text: string;
    /** Where it opens in the clip's own time. */
    start: number;
}

const NO_WINDOWS: readonly AnimatorWindow[] = [];

export const SPINE_MOTION = 'spine';

/**
 * Migrated motions, keyed by the state that spelled one the single-kind way.
 * A controller's states are stable objects, so this converts once rather than
 * every frame — and keeps `motionOf` free to return a fresh shape without
 * allocating one per tick.
 */
const migratedMotions = new WeakMap<AnimatorState, AnimatorMotion | null>();

/** How much faster than the clock a state's own clock runs: its speed parameter's value, or 1 for a state that names none. */
export function stateTimeScale(state: AnimatorState, params: Readonly<Record<string, number | boolean>>): number {
    if (!state.speedParameter) return 1;
    const value = params[state.speedParameter];
    return typeof value === 'number' && value > 0 ? value : typeof value === 'number' ? 0 : 1;
}

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
 * What `clip`, `blend` or `spine` mean as a {@link AnimatorMotion} — each is one
 * kind's own word for what `motion` says generally. Pure, so the migration and
 * the runtime's cache share one conversion rather than two that can drift.
 */
export function legacyMotionOf(st: AnimatorState): AnimatorMotion | null {
    if (st.spine) return { kind: SPINE_MOTION, clip: st.spine.animation, loop: st.spine.loop };
    if (st.blend) return spriteBlendMotion(st, st.blend);
    if (st.clip) return { kind: SPRITE_MOTION, clip: st.clip, speed: st.speed, loop: st.loop };
    return null;
}

/**
 * What a state plays. A file is normalized on load, so this converts only for a
 * controller built in code with the older fields — which nothing new writes, and
 * which stays readable rather than becoming a silent no-motion.
 * Null for a state with no motion of its own (a container).
 */
export function motionOf(st: AnimatorState): AnimatorMotion | null {
    if (st.motion) return st.motion;
    const cached = migratedMotions.get(st);
    if (cached !== undefined) return cached;
    const motion = legacyMotionOf(st);

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
    /** The base layer's active state; empty until the first update seeds it. */
    currentState: string;
    /** A `.esavatar` saying how THIS rig spells the joints the clips name. Empty
     *  where the clips were authored against this rig and need no translation. */
    avatar: string;
    /** The active state of each layer ABOVE the base one, by that layer's index
     *  minus one — the base layer's is {@link currentState}, for the same reason
     *  the base layer has no weight. */
    layerStates: string[];
    /**
     * The entity whose children the clips pose, when the skeleton is not this
     * entity's own: a character that carries its model as a child, set down and
     * scaled where the model was imported. Every path a clip names is then found
     * under it, and a root track is that entity's, stated in its axes and its
     * units. Empty for a rig that hangs directly from the animator.
     */
    rig?: Entity;
    enabled: boolean;
}

/** `v`, stated in `entity`'s own axes and units, as its parent sees it. */
function inFrameOf(world: World, entity: Entity, v: Vec3): Vec3 {
    if (!world.has(entity, Transform)) return v;
    const t = world.get(entity, Transform) as TransformData;
    return q.rotate(t.rotation, { x: v.x * t.scale.x, y: v.y * t.scale.y, z: v.z * t.scale.z });
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
    avatar: '',
    currentState: '',
    layerStates: [] as string[],
    rig: 0 as Entity,
    enabled: true,
}, {
    entityFields: ['rig'],
    fields: {
        rig: { tooltip: 'The model this animator poses, when it is a child of this entity and not this entity itself. Empty poses the children of this one.' },
    },
    assetFields: [
        registeredAssetFields.Animator,
        { field: 'avatar', type: 'avatar' },
    ],
    // The avatar picker takes files only. Discovery also recognizes older scenes' short avatar paths.
    discoverAssets: namedFieldDiscovery([registeredAssetFields.Animator, { field: 'avatar', type: 'avatar', fileExtension: '.esavatar' }]),
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
    private assetControllers_: ((ref: string, entity?: Entity) => AnimatorControllerDef | undefined) | null = null;
    private assetAvatars_: ((ref: string, entity?: Entity) => AnimatorAvatar | undefined) | null = null;
    private readonly controllers = new Map<string, AnimatorControllerDef>();
    private readonly params = new Map<Entity, Map<string, number | boolean>>();
    private readonly triggers = new Map<Entity, Set<string>>();
    private readonly runtimes_ = new Map<Entity, AnimatorRuntime>();
    private readonly motions_ = new MotionRegistry();
    private groundProbe_: GroundProbe | null = null;

    constructor() {
        // The kinds the animation core itself can play. Everything else — a
        // timeline, a spine track — is registered by the module that owns it,
        // which is what keeps this file from importing them.
        this.motions_.register(SPRITE_MOTION, spriteMotionDriver);
        this.motions_.register('blend1d', blend1DMotionDriver);
        this.motions_.register('blend2d', blend2DMotionDriver);
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

    /** What foot-plant constraints ask about the ground; a physics plugin wires it. Without one they leave the clip's feet alone. */
    setGroundProbe(probe: GroundProbe | null): void {
        this.groundProbe_ = probe;
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
    useAssetControllers(source: (ref: string, entity?: Entity) => AnimatorControllerDef | undefined): void {
        this.assetControllers_ = source;
    }

    /** Where a `.esavatar` comes from. Same shape as the controller source, and
     *  optional for the same reason: without one, every path resolves as itself. */
    useAssetAvatars(source: (ref: string, entity?: Entity) => AnimatorAvatar | undefined): void {
        this.assetAvatars_ = source;
    }

    /** This rig's avatar, or null where its clips need no translating. */
    private avatarOf(ref: string | undefined, entity: Entity): AnimatorAvatar | null {
        return ref ? this.assetAvatars_?.(ref, entity) ?? null : null;
    }

    getController(name: string, entity?: Entity): AnimatorControllerDef | undefined {
        // A code-registered name wins, then this realm's asset, then a
        // controller registered by path through the module door.
        return this.controllers.get(name)
            ?? this.assetControllers_?.(name, entity)
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
        // A press again restarts its buffer: it is the latest one that is being remembered.
        this.triggerAges_.get(entity)?.delete(name);
    }

    resetTrigger(entity: Entity, name: string): void {
        this.triggers.get(entity)?.delete(name);
        this.triggerAges_.get(entity)?.delete(name);
    }

    getFloat(entity: Entity, name: string): number {
        return Number(this.params.get(entity)?.get(name) ?? 0);
    }

    getBool(entity: Entity, name: string): boolean {
        return this.params.get(entity)?.get(name) === true;
    }

    /**
     * What one animator was doing as of its last step, for an editor's debugger: the parameters it was set, and per
     * layer the seconds into the current state's motion, one pass's length, and a crossfade under way. Null for an
     * entity no animator has stepped. Which state it is in is the component's to say.
     */
    debugView(entity: Entity): AnimatorDebugView | null {
        const rt = this.runtimes_.get(entity);
        if (!rt) return null;
        const params: Record<string, number | boolean> = {};
        for (const [k, v] of this.params.get(entity) ?? []) params[k] = v;
        const active = rt.inertia?.active;
        return {
            params,
            layers: rt.layers.map((l) => ({
                time: l.time,
                span: l.span,
                fade: l.fadeFrom ? { elapsed: l.fadeElapsed, duration: l.fadeDuration } : undefined,
            })),
            inertia: active ? { elapsed: active.elapsed, duration: active.duration } : undefined,
        };
    }

    /** Drop an entity's parameter/trigger/playback state (wire to world.onDespawn). */
    removeEntity(entity: Entity): void {
        this.params.delete(entity);
        this.triggers.delete(entity);
        this.triggerAges_.delete(entity);
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

    /**
     * `dt` seconds advance the animator's own clock, which is what a sampled
     * motion is evaluated against and what a crossfade progresses on. `events`
     * is where what the clips declared is posted; without one the animator still
     * runs and simply says nothing, which is what a bare App is.
     */
    update(world: World, dt: number = 0, events?: AnimatorEventSink): void {
        // Last update's windows are what this one's are told apart from; an entity
        // this update does not step (disabled, removed, gone) has none afterwards.
        const before = this.windowsBefore_;
        this.windowsBefore_ = this.windows_;
        this.windows_ = before;
        for (const list of this.windows_.values()) list.length = 0;
        this.windows_.clear();
        const entities = world.getEntitiesWithComponents([Animator]);
        if (entities.length === 0) return;
        const storage = poseStorageFor(world);
        const mark = storage.begin();
        try {
            this.updateEntities(world, entities, storage, dt, events);
        } finally {
            storage.end(mark);
        }
    }

    private updateEntities(
        world: World, entities: readonly Entity[], storage: PoseStorage, dt: number, events?: AnimatorEventSink,
    ): void {
        for (const entity of entities) {
            const a = world.get(entity, Animator) as AnimatorData;
            if (!a.enabled) continue;

            const def = this.getController(a.controller, entity);
            if (!def || animatorScopes(def).every((s) => s.states.length === 0)) continue;

            const actorKey = storage.keyFor(entity, world);
            if (!actorKey) continue;
            const count = animatorLayerCount(def);
            const params = resolveParams(def, this.params.get(entity) ?? EMPTY_PARAMS);
            const rig = this.avatarOf(a.avatar, entity);
            const clips = this.avatarOf(def.avatar, entity);
            const named = avatarResolver(world, rig);
            // A rig carried as a child: every path a clip names is under it, the root's own included.
            const rigRoot = this.rigRootOf(world, entity, a);
            const joints: JointResolver = rigRoot === entity
                ? named : (root, path) => named(root === entity ? rigRoot : root, path);
            const travel = travelRatio(clips, rig);
            const ctx = this.motions_.context(world, entity, params, joints);
            const rt = this.runtimeFor(entity, count, storage);
            rt.composed.reset();

            let wrote = false;
            this.spentTriggers_.length = 0;
            if (count > 1) this.motions_.beginLayerDrives();
            for (let index = 0; index < count; index++) {
                wrote = this.stepLayer(world, entity, a, def, index, ctx, rt, dt, events, travel)
                    || wrote;
            }
            if (count > 1) this.motions_.flushLayerDrives();
            // Consumed after EVERY layer has been asked, not as each fires: one
            // trigger is one event every layer is told about, so an attack both
            // machines answer cannot depend on which was stepped first.
            const triggers = this.triggers.get(entity);
            if (triggers) {
                for (const t of this.spentTriggers_) triggers.delete(t);
                if (triggers.size > 0) this.ageTriggers(entity, def, triggers, dt);
            }
            // Restating the stack for THIS rig comes before the constraints:
            // they measure where joints are, and this is what moves them.
            if (wrote && rig && clips) {
                rebasePose(rt.composed, entity, clips, rig, joints, world);
            }
            // A transition by inertia starts from the pose the last frame ended with, before any constraint bent it:
            // the constraints then fit the carried pose to the ground as they would any other.
            if (wrote) {
                const inertia = rt.inertia ??= { lastDt: 0 };
                const starting = (rt.inertiaRequest ?? 0) > 0;
                if (starting) beginInertia(inertia, rt.composed, rt.inertiaRequest!);
                rt.inertiaRequest = 0;
                applyInertia(inertia, rt.composed, dt, starting);
                recordInertia(inertia, rt.composed, dt);
            }
            // Constraints read the stack's answer and bend it, so they run
            // between composing and writing — on the pose this frame stated,
            // never on the world's record of the last one.
            if (wrote && def.ik?.length) {
                const ground = this.groundFor(rt, dt);
                this.measureStride(world, entity, rt, ground, dt, strideEaseOf(def.ik));
                // Measured in the rig's own space: with the model carried as a child, that is the child's.
                solveAnimatorIK(world, rigRoot, rt.composed, def.ik, params, joints, ground);
            }
            // One write for the whole stack: a layer states values, and what the
            // entity ends up as is the stack's answer, not the topmost writer's.
            if (wrote && storage.entities[entity] === actorKey) rt.composed.applyEvaluatedTo(world);
        }
    }

    /**
     * Run one layer: its own clock, its own transitions, its own pose — laid over
     * what the layers under it already put in `rt.composed`. Answers whether it
     * left anything there, a layer driving a sprite sheet having written the
     * entity directly instead.
     */
    private stepLayer(
        world: World, entity: Entity, a: AnimatorData, def: AnimatorControllerDef,
        index: number, ctx: MotionContext, rt: AnimatorRuntime, dt: number,
        events: AnimatorEventSink | undefined, travel: number,
    ): boolean {
        const scope = animatorLayer(def, index);
        if (!scope || scope.states.length === 0) return false;

        // Seed / repair the active state path. The path descends into a
        // sub-machine's initial state when the entry point is a container.
        let fromPath = layerState(a, index);
        let resolved = resolveStatePath(scope, fromPath);
        if (!resolved) {
            fromPath = enterStatePath(scope, scope.initialState).join(STATE_PATH_SEP);
            resolved = resolveStatePath(scope, fromPath);
            if (!resolved) return false;
        }
        const leaf = resolved.states[resolved.states.length - 1];

        const params = ctx.params;
        const triggerSet = this.triggers.get(entity);
        const lrt = rt.layers[index]!;
        // Advance BEFORE asking whether the motion ran out: judging the clip
        // on the previous frame's clock holds every exit-time transition one
        // frame past the clip it was waiting for.
        const leafMotion = motionOf(leaf);
        // A motion whose length moves while it plays (a blend whose weights shift) is played by PHASE: the clock is
        // restated in the new length before it advances, so how far through its cycle the motion is stays where it
        // was. Read at the old length, the same seconds would be another point of the cycle, and the legs would jump.
        const length = leafMotion !== null ? ctx.duration(leafMotion) : 0;
        if (lrt.span > 0 && length > 0 && length !== lrt.span) {
            const k = length / lrt.span;
            lrt.time *= k;
            lrt.prevTime *= k;
        }
        lrt.span = length;
        this.advance(lrt, dt * stateTimeScale(leaf, params));
        if (leaf.distanceParameter && leafMotion !== null && fromPath === layerState(a, index)) {
            const left = Number(params[leaf.distanceParameter] ?? 0);
            if (left > (leaf.distanceFloor ?? DISTANCE_MATCH_FLOOR)) {
                const at = this.timeWithTravelLeft(world, entity, ctx, leafMotion, left);
                if (at !== null) {
                    // The first frame goes straight to its place: the run-up a stop clip begins with is not this
                    // character's. After it the clip is held to at most a few times its own pace, because near the end
                    // of its travel a root that has nearly stopped puts a sliver of distance a long way apart in time,
                    // and the feet would jump across it.
                    const first = lrt.prevTime <= 0;
                    const most = first ? Infinity : lrt.prevTime + dt * (leaf.distanceMaxPace ?? DISTANCE_MATCH_MAX_PACE);
                    lrt.time = Math.min(Math.max(lrt.prevTime, at), most);
                }
            }
        }
        // A newly seeded layer has yet to play its initial motion. A previous
        // controller or standalone player may have finished that very clip.
        const clipFinished = fromPath === layerState(a, index) && leafMotion !== null
            && this.motionEnded(ctx, leafMotion, lrt.time);

        // The windows the state being left holds over the stretch its clock just
        // covered: a press buffered before the combo window opens is taken the
        // frame it does, and the window being shorter than a frame does not lose it.
        const open = this.openNames_;
        open.clear();
        if (leafMotion) {
            const held = this.windowScratch_;
            held.length = 0;
            ctx.windows(leafMotion, { from: lrt.prevTime, to: lrt.time, inclusiveStart: lrt.entered }, held);
            for (const w of held) open.add(w.name);
        }
        const { nextPath, consumedTriggers, fadeDuration, blend } = evaluateResolvedAnimatorPath(
            resolved, params, triggerSet ?? EMPTY_TRIGGERS, clipFinished, open,
        );
        for (const t of consumedTriggers) this.spentTriggers_.push(t);

        const target = nextPath ?? fromPath;
        // Also true on the frame a layer is SEEDED, its recorded state being
        // empty and the entry point what it is about to start playing.
        const stateChanged = target !== layerState(a, index);
        if (stateChanged) {
            setLayerState(a, index, target);
            world.insert(entity, Animator, a);
        }
        const targetLeaf = nextPath ? leafStateOf(scope, target) : leaf;
        if (!targetLeaf) return false;
        // Drive the active leaf every frame: a blend's selection can change as
        // its parameter crosses a threshold without any state change. A driver
        // is a no-op in steady state, which is what keeps that cheap.
        const motion = targetLeaf === leaf ? leafMotion : motionOf(targetLeaf);

        if (stateChanged) {
            // By inertia on the base layer: the state is cut to, and the stack's pose is carried into it after it is
            // composed. A layer above composes over the base and is faded as it always was.
            const byInertia = index === 0 && nextPath !== null && fadeDuration > 0
                && (blend ?? def.transitionBlend) === 'inertialize';
            this.beginState(lrt, leafMotion, leaf.rootMotion === true, motion, byInertia ? 0 : fadeDuration);
            if (byInertia) rt.inertiaRequest = fadeDuration;
        }
        // Where the character GOES has one author. A layer states how it is
        // posed; taking displacement from more than one would have two answers
        // to a question the character controller asks once.
        const drivesRoot = index === 0 && targetLeaf.rootMotion === true;
        // A layer at zero says nothing, a motion that WRITES the entity included:
        // a sprite sheet switched by a silent layer is that layer speaking. Its
        // machine still runs and still posts events — heard, not shown.
        const weight = index === 0 ? 1 : (def.layers![index - 1]!.weight ?? 1);
        const posed = motion !== null && weight > 0
            && this.poseLayer(world, ctx, lrt, motion, drivesRoot, stateChanged);

        if (posed) this.compose(world, ctx, def, index, rt, posed, motion!);

        // What the state's own clock covered this frame. Empty on the frame it
        // was entered, and closed there rather than half-open: an event
        // authored at the very start of a clip happens on that frame or never.
        const span: MotionSpan = {
            from: lrt.prevTime, to: lrt.time, inclusiveStart: lrt.entered,
        };
        if (motion) {
            this.emitEvents(ctx, entity, motion, span, events);
            this.gatherWindows(ctx, entity, index, motion, span, stateChanged);
        }
        if (index === 0) {
            this.publishRootMotion(world, entity, ctx, motion, span, drivesRoot, travel);
            rt.motionSpeed = this.travelSpeed(world, entity, ctx, motion, span, dt, travel, rt);
        }
        return posed !== null;
    }

    /**
     * Put `pose` into the stack. The base layer states it outright; a layer over
     * it leans the stack toward what it says, or adds what it says beyond its own
     * rest pose — neither of which commutes, which is the whole difference
     * between this and the pose mixer a crossfade uses.
     */
    private compose(
        world: World, ctx: MotionContext, def: AnimatorControllerDef, index: number,
        rt: AnimatorRuntime, pose: Pose, motion: AnimatorMotion,
    ): void {
        if (index === 0) {
            overlayPose(rt.composed, pose, 1, world, null);
            return;
        }
        const layer = def.layers![index - 1]!;
        const weight = layer.weight ?? 1;
        const reach = this.reachFor(world, ctx.entity, rt.layers[index]!, layer.mask, ctx.resolveJoint);
        if (layer.blend !== 'additive') {
            overlayPose(rt.composed, pose, weight, world, reach);
            return;
        }
        rt.rest.reset();
        ctx.extractRootMotion = false;
        // The clip's own first frame is its rest: an additive clip says "from
        // where this motion starts", so nothing else has to be authored for it.
        if (ctx.sample(motion, 0, rt.rest)) {
            addPoseOver(rt.composed, pose, rt.rest, weight, world, reach);
        }
    }

    /**
     * Post what the ACTIVE motion crossed. A motion being faded out states
     * nothing: its clock is still running, so an attack cancelled into a dodge
     * would go on landing its hit, and "how much of it is still on screen" is not
     * an answer to whether it happened.
     */
    private emitEvents(
        ctx: MotionContext, entity: Entity,
        motion: AnimatorMotion, span: MotionSpan, events?: AnimatorEventSink,
    ): void {
        const crossed = this.eventScratch_;
        crossed.length = 0;
        ctx.events(motion, span, crossed);
        for (const e of crossed) {
            events?.send({ entity, name: e.name, value: e.value, text: e.text });
        }
    }

    /**
     * Record the windows the ACTIVE motion held open, by the same rule as its events:
     * a motion being faded out holds none, so an attack cancelled into a dodge stops
     * reaching at once. Each opening gets an id, kept while it stays open and new when
     * it opens again, so two attacks back to back are two even where no frame passes
     * between them - the state changing is an opening of its own.
     */
    private gatherWindows(
        ctx: MotionContext, entity: Entity, layer: number,
        motion: AnimatorMotion, span: MotionSpan, entered: boolean,
    ): void {
        const found = this.windowScratch_;
        found.length = 0;
        ctx.windows(motion, span, found);
        if (found.length === 0) return;
        let list = this.windows_.get(entity);
        if (!list) {
            list = [];
            this.windows_.set(entity, list);
        }
        const earlier = entered ? undefined : this.windowsBefore_.get(entity);
        for (const w of found) {
            const kept = earlier?.find((o) => o.layer === layer && o.name === w.name && o.start === w.start);
            list.push({
                id: kept?.id ?? this.nextWindowId_++,
                layer, name: w.name, value: w.value, text: w.text, start: w.start,
            });
        }
    }

    /**
     * The windows `entity`'s active motions held open in the last update, every
     * layer's. Empty when none is, or the entity was not animated.
     *
     * @experimental
     */
    windowsOf(entity: Entity): readonly AnimatorWindow[] {
        return this.windows_.get(entity) ?? NO_WINDOWS;
    }

    /** The open window named `name` on `entity`, or null. @experimental */
    openWindow(entity: Entity, name: string): AnimatorWindow | null {
        const list = this.windows_.get(entity);
        if (!list) return null;
        for (const w of list) if (w.name === name) return w;
        return null;
    }

    /**
     * State what the animation asks to move, for gameplay to hand on. World space,
     * because a consumer wants "move me this way" rather than a vector in a frame
     * it has to reconstruct; and paired with the seconds it covers, because the
     * consumer usually steps on a different clock than this one.
     */
    private publishRootMotion(
        world: World, entity: Entity, ctx: MotionContext,
        motion: AnimatorMotion | null, span: MotionSpan, drivesRoot: boolean, travel: number,
    ): void {
        if (!world.has(entity, AnimatorRootMotion)) return;
        const out = this.rootScratch_;
        const active = drivesRoot
            && (world.get(entity, AnimatorRootMotion) as AnimatorRootMotionData).enabled;
        // A state that declares root motion whose clip states none asks to move
        // nowhere — which is still the animation driving, not the stick.
        const stated = active && motion !== null && ctx.rootDelta(motion, span, out);
        const local = stated ? out.position : ZERO_VEC;
        const turn = stated ? out.rotation : IDENTITY_QUAT;
        // A root track is stated in the frame of the entity it is the root of: that entity's turn and its size both
        // apply, so a model imported at a scale, or made larger in a scene, covers ground in proportion. With the
        // rig carried as a child the track is the child's, and the character's own frame applies after it.
        let moved: Vec3 = local;
        const rigRoot = this.rigRootOf(world, entity, world.get(entity, Animator) as AnimatorData);
        if (stated) {
            if (rigRoot !== entity) moved = inFrameOf(world, rigRoot, moved);
            moved = inFrameOf(world, entity, moved);
        }

        world.update(entity, AnimatorRootMotion, (data: AnimatorRootMotionData) => {
            data.active = active;
            // Scaled, not the turn beside it: a taller rig covers more ground per
            // step and turns by the same angle.
            data.deltaPosition.x = moved.x * travel;
            data.deltaPosition.y = moved.y * travel;
            data.deltaPosition.z = moved.z * travel;
            data.deltaRotation.w = turn.w;
            data.deltaRotation.x = turn.x;
            data.deltaRotation.y = turn.y;
            data.deltaRotation.z = turn.z;
            data.deltaTime = active ? span.to - span.from : 0;
        });
    }

    /**
     * How fast the base layer's motion travels, world units a second: its root track over this frame's span, read in
     * the frame of the rig it is the root of and of the character carrying it. 0 for a motion that states none. Read
     * whether or not anything moves the character by it: a stride warp compares it with how fast the character went.
     */
    private travelSpeed(
        world: World, entity: Entity, ctx: MotionContext, motion: AnimatorMotion | null, span: MotionSpan,
        dt: number, travel: number, rt: AnimatorRuntime,
    ): number {
        if (motion === null || dt <= 0) return 0;
        const out = this.speedScratch_;
        if (!ctx.rootDelta(motion, span, out)) return 0;
        let moved: Vec3 = out.position;
        const rigRoot = this.rigRootOf(world, entity, world.get(entity, Animator) as AnimatorData);
        if (rigRoot !== entity) moved = inFrameOf(world, rigRoot, moved);
        moved = inFrameOf(world, entity, moved);
        const ground = Math.hypot(moved.x, moved.z);
        // Which way the motion goes, in the world: what an orientation warp turns the legs from.
        if (ground > 1e-9) rt.motionDirection = { x: moved.x / ground, z: moved.z / ground };
        return ground * travel / dt;
    }

    /**
     * What a stride warp needs: how the speed the character went compares with the speed its motion travels, and which
     * way over the ground it went. Measured from where the character was last frame, so it is what happened whoever
     * moved it, and eased over a tenth of a second so one jolted frame does not throw the legs.
     */
    private measureStride(
        world: World, entity: Entity, rt: AnimatorRuntime, ground: GroundContext, dt: number, ease: number,
    ): void {
        if (!world.has(entity, Transform) || dt <= 0) return;
        const t = world.get(entity, Transform) as TransformData;
        const at = world.has(entity, Parent) ? t.worldPosition : t.position;
        const last = rt.lastAt;
        if (!last) { rt.lastAt = { x: at.x, z: at.z }; rt.sinceMoved = 0; return; }
        // A character moved on the fixed step does not move on every frame of a display faster than the step: its speed
        // is what it covered since it last moved, not this frame's nothing and the next frame's double.
        const since = (rt.sinceMoved ?? 0) + dt;
        const dx = at.x - last.x, dz = at.z - last.z;
        let vx: number, vz: number;
        if (dx * dx + dz * dz > 1e-12) {
            vx = dx / since; vz = dz / since;
            rt.lastAt = { x: at.x, z: at.z };
            rt.sinceMoved = 0;
            rt.lastVelocity = { x: vx, z: vz };
        } else if (since < STILL_AFTER) {
            rt.sinceMoved = since;
            vx = rt.lastVelocity?.x ?? 0; vz = rt.lastVelocity?.z ?? 0;
        } else {
            rt.sinceMoved = since;
            vx = 0; vz = 0;
        }
        const went = Math.hypot(vx, vz);
        const goes = rt.motionSpeed ?? 0;
        // A motion that travels nowhere has no stride to fit. One that does while the character comes to a halt has its
        // strides drawn in all the way down, and not let back out to the clip's on the last frame it was moving: that
        // throws the feet out and back in as it stops.
        const wanted = goes > 1e-3 ? went / goes : 1;
        const was = ground.stride?.ratio ?? 1;
        const k = ease > 0 ? 1 - Math.exp(-dt / ease) : 1;
        // How far the way it went is turned from the way its motion goes, about up: what an orientation warp turns the
        // legs by. Nothing while either stands still.
        const from = rt.motionDirection;
        let turned = 0;
        if (from && goes > 1e-3 && went > 1e-3) {
            turned = Math.atan2(from.z * vx - from.x * vz, from.x * vx + from.z * vz);
        }
        const wasTurned = ground.stride?.angle ?? 0;
        ground.stride = {
            ratio: was + (wanted - was) * k,
            direction: went > 1e-3 ? { x: vx / went, y: 0, z: vz / went } : ground.stride?.direction ?? { x: 0, y: 0, z: 1 },
            angle: wasTurned + (turned - wasTurned) * k,
        };
    }

    /**
     * The time in `motion` at which its root track has `left` world units still to travel before its end, or null for
     * a motion that travels nowhere. The travel left only falls as the motion plays, so halving the clip finds it.
     */
    private timeWithTravelLeft(
        world: World, entity: Entity, ctx: MotionContext, motion: AnimatorMotion, left: number,
    ): number | null {
        const end = ctx.duration(motion);
        if (!(end > 0)) return null;
        const rigRoot = this.rigRootOf(world, entity, world.get(entity, Animator) as AnimatorData);
        const out = this.speedScratch_;
        const travelFrom = (t: number): number => {
            if (!ctx.rootDelta(motion, { from: t, to: end, inclusiveStart: false }, out)) return -1;
            let moved: Vec3 = out.position;
            if (rigRoot !== entity) moved = inFrameOf(world, rigRoot, moved);
            moved = inFrameOf(world, entity, moved);
            return Math.hypot(moved.x, moved.z);
        };
        const whole = travelFrom(0);
        if (whole <= 0) return null;
        if (left >= whole) return 0;
        let lo = 0, hi = end;
        for (let i = 0; i < 24; i++) {
            const mid = 0.5 * (lo + hi);
            if (travelFrom(mid) > left) lo = mid; else hi = mid;
        }
        return 0.5 * (lo + hi);
    }

    /** The entity a clip's paths start from: the rig the animator names, or the animator's own entity. */
    private rigRootOf(world: World, entity: Entity, data: AnimatorData): Entity {
        const rig = data.rig;
        return rig && world.has(rig, Transform) ? rig : entity;
    }

    /**
     * Enter a state: the clock restarts, and the motion being left keeps running
     * as the thing to fade out of. Only when BOTH can be sampled - a switched
     * motion has no partial state to hold, so a fade over one would be a pause.
     */
    private beginState(
        rt: LayerRuntime,
        leaving: AnimatorMotion | null, leavingDrivesRoot: boolean,
        entering: AnimatorMotion | null, fadeDuration: number,
    ): void {
        const blendable = fadeDuration > 0 && leaving !== null && entering !== null
            && this.canSample(leaving) && this.canSample(entering);
        if (blendable) {
            rt.fadeFrom = leaving;
            rt.fadeFromRoot = leavingDrivesRoot;
            rt.fadeFromTime = rt.time;
            rt.fadeElapsed = 0;
            rt.fadeDuration = fadeDuration;
        } else {
            rt.fadeFrom = null;
        }
        rt.time = 0;
        rt.prevTime = 0;
        rt.span = 0;
        rt.entered = true;
    }

    /** Advance the state's clock, and the fade's if one is running. */
    private advance(rt: LayerRuntime, dt: number): void {
        rt.prevTime = rt.time;
        rt.entered = false;
        rt.time += dt;
        if (rt.fadeFrom === null) return;
        rt.fadeFromTime += dt;
        rt.fadeElapsed += dt;
        if (rt.fadeElapsed >= rt.fadeDuration) rt.fadeFrom = null;
    }

    /** This layer's mask against this rig, or null where it writes all of it. */
    private reachFor(
        world: World, entity: Entity, rt: LayerRuntime, mask: AnimatorMask | undefined,
        resolveJoint: JointResolver,
    ): MaskReach | null {
        if (!mask) return null;
        const reach = rt.reach ?? (rt.reach = new MaskReach());
        reach.resolve(world, entity, mask, resolveJoint);
        return reach;
    }

    /**
     * What this layer's motion says, as a pose for the stack to compose — two
     * composed here already when a fade is running, mixing being the operation
     * that does not care which was sampled first. Null for a motion that can only
     * be driven, a sprite sheet writing the entity itself and joining no stack.
     */
    private poseLayer(
        world: World, ctx: MotionContext, rt: LayerRuntime,
        motion: AnimatorMotion, drivesRoot: boolean, enter: boolean,
    ): Pose | null {
        if (rt.fadeFrom !== null) {
            rt.poseFrom.reset();
            rt.poseTo.reset();
            ctx.extractRootMotion = rt.fadeFromRoot;
            const from = ctx.sample(rt.fadeFrom, rt.fadeFromTime, rt.poseFrom);
            ctx.extractRootMotion = drivesRoot;
            const to = ctx.sample(motion, rt.time, rt.poseTo);
            if (from && to) {
                const t = Math.min(rt.fadeElapsed / rt.fadeDuration, 1);
                rt.mixed.reset();
                rt.fade[0].pose = rt.poseFrom; rt.fade[0].weight = 1 - t;
                rt.fade[1].pose = rt.poseTo; rt.fade[1].weight = t;
                mixPoses(rt.fade, rt.mixed, world, 2);
                return rt.mixed;
            }
            rt.fadeFrom = null;
        }

        rt.poseTo.reset();
        ctx.extractRootMotion = drivesRoot;
        if (ctx.sample(motion, rt.time, rt.poseTo)) return rt.poseTo;
        ctx.drive(motion, enter);
        return null;
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

    /**
     * This entity's clocks, grown to the controller it is now running. Grown and
     * not rebuilt: a controller swapped for one with more layers keeps the base
     * layer mid-clip, which is what the entity is visibly doing.
     */
    private groundFor(rt: AnimatorRuntime, dt: number): GroundContext {
        const ground = rt.ground ??= { probe: null, dt: 0, memory: new Map() };
        ground.probe = this.groundProbe_;
        ground.dt = dt;
        return ground;
    }

    private runtimeFor(entity: Entity, layers: number, storage: PoseStorage): AnimatorRuntime {
        let rt = this.runtimes_.get(entity);
        if (!rt) {
            rt = { layers: [], composed: new Pose(storage), rest: new Pose(storage) };
            this.runtimes_.set(entity, rt);
        }
        while (rt.layers.length < layers) {
            rt.layers.push({
                time: 0, prevTime: 0, span: 0, entered: true,
                fadeFrom: null, fadeFromRoot: false,
                fadeFromTime: 0, fadeElapsed: 0, fadeDuration: 0,
                poseFrom: new Pose(storage), poseTo: new Pose(storage), mixed: new Pose(storage),
                fade: [{ pose: null!, weight: 0 }, { pose: null!, weight: 0 }],
            });
        }
        return rt;
    }

    /**
     * Age the triggers still set after every layer was asked, and drop a buffered
     * one past its buffer. After the layers, so a trigger is always asked at least
     * once: a buffer of 0 is "this frame only", not "never".
     */
    private ageTriggers(entity: Entity, def: AnimatorControllerDef, triggers: Set<string>, dt: number): void {
        let ages = this.triggerAges_.get(entity);
        for (const name of triggers) {
            const buffer = def.parameters.find((p) => p.name === name && p.type === 'trigger')?.buffer;
            if (buffer === undefined || !(buffer >= 0)) continue;
            if (!ages) {
                ages = new Map();
                this.triggerAges_.set(entity, ages);
            }
            const age = (ages.get(name) ?? 0) + dt;
            if (age >= buffer) {
                triggers.delete(name);
                ages.delete(name);
            } else {
                ages.set(name, age);
            }
        }
    }

    /** What this entity's layers used up this frame, spent once they have all
     *  been asked. */
    private readonly spentTriggers_: string[] = [];

    /** Reused across entities and frames: a steady animation states no events,
     *  and an array per animated entity per frame would be the only allocation. */
    private readonly eventScratch_: MotionEvent[] = [];
    private readonly windowScratch_: MotionWindow[] = [];
    /** The window names a layer's leaf holds this frame, for its `window` conditions. */
    private readonly openNames_ = new Set<string>();
    /** Seconds each still-set trigger has waited, for the ones whose parameter has a buffer. */
    private readonly triggerAges_ = new Map<Entity, Map<string, number>>();
    /** This update's open windows by entity, and the last update's, swapped each update. */
    private windows_ = new Map<Entity, AnimatorWindow[]>();
    private windowsBefore_ = new Map<Entity, AnimatorWindow[]>();
    private nextWindowId_ = 1;
    private readonly speedScratch_: RootMotionDelta = {
        position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 },
    };
    private readonly rootScratch_: RootMotionDelta = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
    };
}

const ZERO_VEC = { x: 0, y: 0, z: 0 };
/** Seconds a stride or orientation warp's measure eases over, where none says. */
const STRIDE_EASE = 0.1;
/** Seconds without moving after which a character is taken to be standing, not between two fixed steps. */
const STILL_AFTER = 0.1;

/** The ease the controller's warps ask for: the first that states one. */
function strideEaseOf(ik: readonly AnimatorIK[] | undefined): number {
    for (const c of ik ?? []) {
        if ((c.kind === 'stride-warp' || c.kind === 'orientation-warp') && typeof c.ease === 'number') return Math.max(0, c.ease);
    }
    return STRIDE_EASE;
}
/** Defaults for a state's `distanceFloor` and `distanceMaxPace`. */
const DISTANCE_MATCH_FLOOR = 2;
const DISTANCE_MATCH_MAX_PACE = 2.5;
const IDENTITY_QUAT = { w: 1, x: 0, y: 0, z: 0 };

/** One entity's playback state: transient, so it lives here and not on the
 *  component, which is what a scene saves and an inspector shows. */
interface AnimatorRuntime {
    /** Where each planted foot had settled, for easing onto a new height. */
    ground?: GroundContext;
    /** How fast the base layer's motion travels, world units a second, as of this frame. */
    motionSpeed?: number;
    /** What a transition by inertia carries from frame to frame. */
    inertia?: InertiaState;
    /** Seconds a transition by inertia the base layer began this frame runs; 0 when none did. */
    inertiaRequest?: number;
    /** Which way it travels over the ground, in the world; the last way it did while it stands. */
    motionDirection?: { x: number; z: number };
    /** Where the character stood when it last moved, over the ground, the seconds since, and how fast it went then. */
    lastAt?: { x: number; z: number };
    sinceMoved?: number;
    lastVelocity?: { x: number; z: number };
    /** One per layer, the base layer at 0. */
    layers: LayerRuntime[];
    /** What the whole stack came to, written to the world once. */
    composed: Pose;
    /** An additive layer's own resting pose, which is what its clip departs from. */
    rest: Pose;
}

/** One layer's clock and the poses it composes from. */
interface LayerRuntime {
    /** Seconds the current state's motion has been playing. */
    time: number;
    /** What {@link time} was before this frame's advance — the other end of the
     *  window an event has to fall inside to have happened. */
    prevTime: number;
    /** Whether this frame is the one the state was entered on. */
    entered: boolean;
    /** How long one pass of the current state's motion was when {@link time} was last advanced; 0 before it first is. */
    span: number;
    /** The motion being faded out, or null when nothing is. */
    fadeFrom: AnimatorMotion | null;
    /** Whether the state being faded out was itself driving the character, so its
     *  pose is sampled the way it was while it was the active one. */
    fadeFromRoot: boolean;
    fadeFromTime: number;
    fadeElapsed: number;
    fadeDuration: number;
    poseFrom: Pose;
    poseTo: Pose;
    mixed: Pose;
    /** The two-slot list a crossfade mixes from. Owned rather than borrowed: a
     *  layer fades once per frame and never inside itself, which is exactly the
     *  case the pools exist for and this is not. */
    fade: [WeightedPose, WeightedPose];
    /** This layer's mask, resolved against the rig it is running on. */
    reach?: MaskReach;
}

/** One animator's playback as {@link AnimatorControllerAPI.debugView} reads it. */
export interface AnimatorDebugView {
    /** The parameters set on it; one never set holds the controller's default. */
    params: Record<string, number | boolean>;
    /** One per layer, the base layer first. */
    layers: {
        /** Seconds the current state's motion has played. */
        time: number;
        /** Seconds one pass of it lasts; 0 before it is known. */
        span: number;
        /** A crossfade into the current state still under way. */
        fade?: { elapsed: number; duration: number };
    }[];
    /** A transition by inertia on the base layer still under way. */
    inertia?: { elapsed: number; duration: number };
}

const EMPTY_PARAMS: ReadonlyMap<string, number | boolean> = new Map();
const EMPTY_TRIGGERS: ReadonlySet<string> = new Set();

/**
 * Per-App animator resource (controller registry + per-entity parameters),
 * published by `AnimationPlugin`. Read as `app.getResource(AnimatorController)`.
 */
export const AnimatorController = defineResource<AnimatorControllerAPI>(null!, 'AnimatorController');
