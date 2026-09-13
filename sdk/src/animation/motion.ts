// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    motion.ts
 * @brief   What an animator state plays, and the seam that knows how to play it.
 *
 * @details The state machine owns states, time and transitions; a MOTION owns
 *          "this stretch of animation, sampled onto this entity". Keeping the two
 *          apart is what lets one graph drive a sprite sheet on one entity and a
 *          skeletal `.estimeline` on another without the graph naming either —
 *          the alternative grows a branch per animation technology in the three
 *          places the animator touches a motion (enter, per-frame, has-it-ended).
 *
 *          A motion is DATA (`kind` + its own fields); a {@link MotionDriver} is
 *          the code for one kind, registered per App. So a new kind of animation
 *          is a registration, and this file never learns about it. Drivers for
 *          kinds the engine ships in a separate module (timeline, spine) are
 *          registered by THAT module's plugin, which is also what keeps the
 *          animation core from importing it.
 */

import type { Entity, Quat, Vec3 } from '../types';
import type { World } from '../ecs/world';
import { Pose } from './pose';
import { mixPoses, type WeightedPose } from './poseMix';
import { resolveChildEntity } from '../ecs/childPath';
import type { JointResolver } from './animatorAvatar';
import { accumulateQuat, leanQuat, normalizeQuat } from './quatMix';

/** Parameter values a graph exposes to its motions (floats and bools). */
export type MotionParams = Readonly<Record<string, number | boolean>>;

/** A single authored clip, played by whichever driver owns `kind`. */
export interface AnimatorClipMotion {
    /** Which driver plays this. `sprite` and `timeline` ship with the engine. */
    kind: string;
    /** What to play: a registered clip name, or an asset ref the driver resolves. */
    clip: string;
    speed?: number;
    loop?: boolean;
}

/** One stop on a 1D blend: at or above `value`, play `motion`. */
export interface AnimatorBlendStop {
    value: number;
    motion: AnimatorMotion;
}

/**
 * Parameter-driven selection among motions. A blend is itself a motion, so a stop
 * may hold another blend or any other kind — the nesting is what makes a
 * locomotion tree expressible without the graph gaining a second vocabulary.
 */
export interface AnimatorBlend1DMotion {
    kind: 'blend1d';
    /** Float parameter that drives the selection. */
    parameter: string;
    thresholds: AnimatorBlendStop[];
}

/** One stop of a 2D blend, placed in the plane the two parameters span. */
export interface AnimatorBlendPoint {
    position: { x: number; y: number };
    motion: AnimatorMotion;
}

/**
 * Selection among motions by TWO parameters. What a 1D blend cannot say is any
 * locomotion that turns: forward speed and strafe are one motion here, where
 * stacking two 1D blends would make the character pick a direction and a speed
 * independently and land between the clips that describe neither.
 */
export interface AnimatorBlend2DMotion {
    kind: 'blend2d';
    parameterX: string;
    parameterY: string;
    points: AnimatorBlendPoint[];
}

export type AnimatorMotion =
    | AnimatorClipMotion | AnimatorBlend1DMotion | AnimatorBlend2DMotion;

export function isBlend1D(m: AnimatorMotion): m is AnimatorBlend1DMotion {
    return m.kind === 'blend1d';
}

export function isBlend2D(m: AnimatorMotion): m is AnimatorBlend2DMotion {
    return m.kind === 'blend2d';
}

// =============================================================================
// What a motion says happened, and how far it asks to move
// =============================================================================

/**
 * A window of a motion's own playback, in ANIMATOR seconds. Half-open — an event
 * at `from` belongs to the window before this one — except on the frame a state
 * was entered, where `from` and `to` are both 0 and a closed window is the only
 * one that can contain an event authored at the very start of a clip.
 */
export interface MotionSpan {
    from: number;
    to: number;
    inclusiveStart: boolean;
}

/** Something a clip declares happened at a point in its own time. */
export interface MotionEvent {
    name: string;
    /** The event's numeric payload; 0 when it carries none. */
    value: number;
    /** The event's string payload; empty when it carries none. */
    text: string;
}

/**
 * How far a motion asks to move over a span, in the animated entity's OWN frame.
 * A request, not a result: what the character ends up doing with it is the
 * character controller's answer, and this never reaches a Transform.
 */
export interface RootMotionDelta {
    position: Vec3;
    rotation: Quat;
}

// =============================================================================
// Driver seam
// =============================================================================

/**
 * What a driver is given to act on. `drive`/`finished` re-enter the registry, so
 * a composite motion (a blend) delegates to its chosen child without holding the
 * registry itself — and therefore without caring what kind that child is.
 */
export interface MotionContext {
    world: World;
    entity: Entity;
    params: MotionParams;
    /** Play a nested motion. `enter` restarts it from the top. */
    drive(motion: AnimatorMotion, enter: boolean): void;
    /** Whether a nested motion has run to its end. */
    finished(motion: AnimatorMotion): boolean;
    /** Sample a nested motion into `pose`; false when its kind cannot be sampled. */
    sample(motion: AnimatorMotion, time: number, pose: Pose): boolean;
    /** One pass of a nested motion in seconds; 0 when it does not say. */
    duration(motion: AnimatorMotion): number;
    /** Whether a nested motion repeats, and so never ends on its own. */
    loops(motion: AnimatorMotion): boolean;
    /** Append a nested motion's events over `span` to `out`. */
    events(motion: AnimatorMotion, span: MotionSpan, out: MotionEvent[]): void;
    /** A nested motion's displacement over `span`; false when it states none. */
    rootDelta(motion: AnimatorMotion, span: MotionSpan, out: RootMotionDelta): boolean;
    /**
     * Borrow scratch for composing nested samples; hand it back with
     * {@link releasePose}. Pooled rather than owned by a driver, because a blend
     * nested inside a blend samples while its parent's scratch is still live.
     */
    borrowPose(): Pose;
    releasePose(pose: Pose): void;
    /**
     * Borrow a list to gather weighted poses into. Its entries are reused, so a
     * caller fills a PREFIX and passes the count on rather than truncating it.
     */
    borrowMix(): WeightedPose[];
    releaseMix(mix: WeightedPose[]): void;
    /** Borrow a displacement to combine nested ones into; hand it back. */
    borrowDelta(): RootMotionDelta;
    releaseDelta(delta: RootMotionDelta): void;
    /**
     * The joint `path` names on the rig being animated. A driver goes through
     * here rather than resolving a childPath itself: a rig with an avatar spells
     * its joints its own way, and that translation has to reach every reader of
     * a path or a clip drives half a skeleton.
     */
    resolveJoint: JointResolver;
    /**
     * Whether the animator is taking this motion's root track as DISPLACEMENT.
     * A driver that can state a root pose must then leave the root's position and
     * rotation out of what it samples: the same movement written to the entity and
     * handed to the character controller moves it twice.
     */
    extractRootMotion: boolean;
}

/**
 * How one kind of motion is played. A driver supplies EITHER `sample` — stating
 * values for something else to compose — or `apply`, for a motion that can only
 * be switched to, a sprite sheet having no meaning halfway between two clips.
 * Only a motion that states values without writing them can be blended.
 */
export interface MotionDriver<M extends AnimatorMotion = AnimatorMotion> {
    /**
     * Drive `motion` on the context's entity. Called every frame the state is
     * active, so a driver must be idempotent in steady state; `enter` is true
     * only on the frame the state was entered, and means restart from the top.
     */
    apply?(ctx: MotionContext, motion: M, enter: boolean): void;
    /**
     * Evaluate `motion` at `time` seconds into `pose`, writing no component;
     * wrapping belongs here, only the driver knowing how long its clip runs.
     * Returns whether anything was sampled — a composite whose chosen child
     * cannot be must answer false, or the caller takes silence for a pose.
     */
    sample?(ctx: MotionContext, motion: M, time: number, pose: Pose): boolean;
    /** One pass in seconds. Absent, or 0, means the motion does not say. */
    duration?(ctx: MotionContext, motion: M): number;
    /** Whether the motion repeats. A looping motion never finishes. */
    loops?(ctx: MotionContext, motion: M): boolean;
    /**
     * Append every event `motion` crossed over `span` to `out`, in the order the
     * clip declares them. Wrapping belongs here for the same reason sampling does:
     * only the driver knows how long its clip runs and whether it repeats, and a
     * caller differencing two absolute times cannot tell a loop from a rewind.
     */
    events?(ctx: MotionContext, motion: M, span: MotionSpan, out: MotionEvent[]): void;
    /**
     * How far `motion` asks to move over `span`, into `out`. False when the motion
     * states no root motion — which is not the same as stating none this frame.
     */
    rootMotion?(ctx: MotionContext, motion: M, span: MotionSpan, out: RootMotionDelta): boolean;
    /**
     * Whether the motion has ended — what gates a `hasExitTime` transition. For
     * a driver whose end is no clock the animator keeps (a sprite clip, a spine
     * track); one reporting a `duration` is judged on the animator's own time.
     * Absent answers false: a transition that never fires is the visible failure.
     */
    isFinished?(ctx: MotionContext, motion: M): boolean;
}

/**
 * The drivers one App knows. Per App and not global because a driver reaches
 * live per-App state (the timeline's player flags, spine's manager), which a
 * second App in the same process must not share.
 */
export class MotionRegistry {
    private readonly drivers_ = new Map<string, MotionDriver<never>>();
    /** Scratch lent to composite motions. Pools and not one buffer per driver:
     *  nesting decides how many are live at once, and only the stack knows that. */
    private readonly posePool_: Pose[] = [];
    private readonly mixPool_: WeightedPose[][] = [];
    private readonly deltaPool_: RootMotionDelta[] = [];

    register<M extends AnimatorMotion>(kind: M['kind'], driver: MotionDriver<M>): void {
        this.drivers_.set(kind, driver as MotionDriver<never>);
    }

    unregister(kind: string): void {
        this.drivers_.delete(kind);
    }

    has(kind: string): boolean {
        return this.drivers_.has(kind);
    }

    driverFor(motion: AnimatorMotion): MotionDriver | undefined {
        return this.drivers_.get(motion.kind) as MotionDriver | undefined;
    }

    /**
     * The context for driving `entity` this tick, REUSED across entities: the
     * alternative is an object and three closures per animated entity per frame.
     * A driver must not keep it — it describes only the call it was handed to.
     */
    context(
        world: World, entity: Entity, params: MotionParams, resolveJoint?: JointResolver,
    ): MotionContext {
        const ctx = this.ctx_;
        ctx.world = world;
        ctx.entity = entity;
        ctx.params = params;
        ctx.extractRootMotion = false;
        ctx.resolveJoint = resolveJoint ?? ((root, path) => resolveChildEntity(world, root, path));
        return ctx;
    }

    private readonly ctx_: MotionContext = {
        world: null!,
        entity: 0 as Entity,
        params: {},
        extractRootMotion: false,
        drive: (motion, enter) => { this.driverFor(motion)?.apply?.(this.ctx_, motion, enter); },
        finished: (motion) => this.driverFor(motion)?.isFinished?.(this.ctx_, motion) ?? false,
        sample: (motion, time, pose) =>
            this.driverFor(motion)?.sample?.(this.ctx_, motion, time, pose) ?? false,
        duration: (motion) => this.driverFor(motion)?.duration?.(this.ctx_, motion) ?? 0,
        loops: (motion) => this.driverFor(motion)?.loops?.(this.ctx_, motion) ?? false,
        events: (motion, span, out) => {
            this.driverFor(motion)?.events?.(this.ctx_, motion, span, out);
        },
        rootDelta: (motion, span, out) =>
            this.driverFor(motion)?.rootMotion?.(this.ctx_, motion, span, out) ?? false,
        borrowPose: () => this.posePool_.pop() ?? new Pose(),
        releasePose: (pose) => { this.posePool_.push(pose); },
        borrowMix: () => this.mixPool_.pop() ?? [],
        releaseMix: (mix) => { this.mixPool_.push(mix); },
        borrowDelta: () => this.deltaPool_.pop() ?? {
            position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 },
        },
        releaseDelta: (delta) => { this.deltaPool_.push(delta); },
        resolveJoint: (root, path) => resolveChildEntity(this.ctx_.world, root, path),
    };
}

// =============================================================================
// 1D blend — a motion in its own right, so it composes with every other kind
// =============================================================================

/**
 * Where a parameter sits among a blend's stops. `upper` is null wherever one stop
 * answers for the whole blend.
 *
 * REUSED — destructure it before anything re-enters this module: a nested blend
 * resolves into the same object while its parent's answer is still being read.
 */
export interface Blend1DPair {
    lower: AnimatorBlendStop | null;
    upper: AnimatorBlendStop | null;
    /** 0 at `lower`, 1 at `upper`; 0 whenever `upper` is null. */
    t: number;
}

const PAIR: Blend1DPair = { lower: null, upper: null, t: 0 };

/**
 * Divide `value` between the two stops it falls between. Under every threshold
 * the lowest stop answers whole, which is what makes a speed parameter resting
 * at zero play idle rather than nothing.
 */
export function blend1DPair(
    blend: AnimatorBlend1DMotion, value: number,
): Readonly<Blend1DPair> {
    let lower: AnimatorBlendStop | null = null;
    let upper: AnimatorBlendStop | null = null;
    let lowest: AnimatorBlendStop | null = null;
    for (const stop of blend.thresholds) {
        if (lowest === null || stop.value < lowest.value) lowest = stop;
        if (stop.value <= value && (lower === null || stop.value > lower.value)) lower = stop;
        if (stop.value > value && (upper === null || stop.value < upper.value)) upper = stop;
    }
    if (lower === null) { lower = lowest; upper = null; }
    const span = lower !== null && upper !== null ? upper.value - lower.value : 0;
    PAIR.lower = lower;
    PAIR.upper = span > 0 ? upper : null;
    PAIR.t = span > 0 ? (value - lower!.value) / span : 0;
    return PAIR;
}

/**
 * The stop a 1D blend selects for `value`: the greatest threshold at or below it,
 * clamped up to the lowest when the parameter sits under them all. This is what a
 * motion that can only be SWITCHED to gets — a sprite sheet has no meaning
 * halfway between two clips — while one that states values is mixed instead.
 */
export function selectBlendStop(
    blend: AnimatorBlend1DMotion, value: number,
): AnimatorBlendStop | null {
    return blend1DPair(blend, value).lower;
}

/** The motion a blend is currently selecting, or null when it has no stops. */
function blendSelection(
    ctx: MotionContext, blend: AnimatorBlend1DMotion,
): AnimatorMotion | null {
    return selectBlendStop(blend, Number(ctx.params[blend.parameter] ?? 0))?.motion ?? null;
}

/** The parameter this blend reads, which is a float even when nothing set it. */
function blendValue(ctx: MotionContext, blend: AnimatorBlend1DMotion): number {
    return Number(ctx.params[blend.parameter] ?? 0);
}

/**
 * Filled only once every nested sample has returned, so a blend inside a blend
 * cannot find its parent's operands here. Reused for the same reason {@link PAIR}
 * is: mixing is the steady state of an animated entity, not an event.
 */
/** Grow `mix` to hold `count` weighted poses, keeping the entries already in it. */
function mixCapacity(mix: WeightedPose[], count: number): void {
    while (mix.length < count) mix.push({ pose: null!, weight: 0 });
}

/**
 * A blend states values, so it MIXES: at 0.5 between walk and run the character
 * is half of each, rather than walking until run's threshold is crossed. A
 * motion that can only be switched to still picks ({@link selectBlendStop}) —
 * `apply` is the seam for exactly those, and the two answers differ only there.
 */
export const blend1DMotionDriver: MotionDriver<AnimatorBlend1DMotion> = {
    apply(ctx, blend, enter) {
        const selected = blendSelection(ctx, blend);
        if (selected) ctx.drive(selected, enter);
    },
    /**
     * The stops are sampled at the same PHASE, not the same second: a 2s idle and
     * a 0.6s run share a clock only once each is measured against its own length,
     * and without that the faster clip's feet slide. Mixing then goes through the
     * pose mixer a crossfade uses — the weights differ, the operation does not.
     */
    sample(ctx, blend, time, pose) {
        const { lower, upper, t } = blend1DPair(blend, blendValue(ctx, blend));
        if (!lower) return false;
        if (!upper) return ctx.sample(lower.motion, time, pose);

        const da = ctx.duration(lower.motion);
        const db = ctx.duration(upper.motion);
        const whole = da > 0 && db > 0 ? da + (db - da) * t : 0;
        const ta = whole > 0 ? time * (da / whole) : time;
        const tb = whole > 0 ? time * (db / whole) : time;

        const from = ctx.borrowPose();
        const to = ctx.borrowPose();
        const mix = ctx.borrowMix();
        try {
            from.reset();
            to.reset();
            const sampledFrom = ctx.sample(lower.motion, ta, from);
            const sampledTo = ctx.sample(upper.motion, tb, to);
            // One end that cannot be sampled leaves the other whole rather than
            // half: a pose is the only thing there is to show, and half of it
            // against the world's own values would read as the blend sinking.
            if (!sampledTo) return sampledFrom && ctx.sample(lower.motion, ta, pose);
            if (!sampledFrom) return ctx.sample(upper.motion, tb, pose);

            mixCapacity(mix, 2);
            mix[0]!.pose = from; mix[0]!.weight = 1 - t;
            mix[1]!.pose = to; mix[1]!.weight = t;
            mixPoses(mix, pose, ctx.world, 2);
            return true;
        } finally {
            ctx.releaseMix(mix);
            ctx.releasePose(to);
            ctx.releasePose(from);
        }
    },
    duration(ctx, blend) {
        const { lower, upper, t } = blend1DPair(blend, blendValue(ctx, blend));
        if (!lower) return 0;
        const da = ctx.duration(lower.motion);
        if (!upper) return da;
        const db = ctx.duration(upper.motion);
        // A stop that does not state its length cannot be averaged with one that
        // does — the answer would be shorter than the clip actually playing — so
        // the selected stop answers, which is what a sprite blend always got.
        return da > 0 && db > 0 ? da + (db - da) * t : da;
    },
    loops(ctx, blend) {
        const selected = blendSelection(ctx, blend);
        return selected ? ctx.loops(selected) : false;
    },
    isFinished(ctx, blend) {
        const selected = blendSelection(ctx, blend);
        return selected ? ctx.finished(selected) : false;
    },
    events(ctx, blend, span, out) {
        const selected = blendSelection(ctx, blend);
        if (selected) ctx.events(selected, span, out);
    },
    /**
     * Weighted like the pose. Picking makes a character crossing run's threshold
     * jump its speed in one frame, the one thing a locomotion tree prevents. A
     * stop stating no displacement does not push the character, so the other end
     * keeps only its share rather than answering whole.
     */
    rootMotion(ctx, blend, span, out) {
        const { lower, upper, t } = blend1DPair(blend, blendValue(ctx, blend));
        if (!lower) return false;
        if (!upper) return ctx.rootDelta(lower.motion, span, out);

        const other = ctx.borrowDelta();
        try {
            const from = ctx.rootDelta(lower.motion, span, out);
            const to = ctx.rootDelta(upper.motion, span, other);
            if (from && to) { leanDelta(out, other, t); return true; }
            if (from) { scaleDelta(out, 1 - t); return true; }
            if (to) { copyDelta(out, other); scaleDelta(out, t); return true; }
            return false;
        } finally {
            ctx.releaseDelta(other);
        }
    },
};

/** Displacement arithmetic. A rotation is not scaled linearly, so a share of one
 *  is the identity leaned toward it — the same rule the layer stack uses. */
function scaleDelta(out: RootMotionDelta, weight: number): void {
    out.position.x *= weight; out.position.y *= weight; out.position.z *= weight;
    IDENTITY_TURN.w = 1; IDENTITY_TURN.x = 0; IDENTITY_TURN.y = 0; IDENTITY_TURN.z = 0;
    leanQuat(IDENTITY_TURN, out.rotation, weight);
    out.rotation.w = IDENTITY_TURN.w; out.rotation.x = IDENTITY_TURN.x;
    out.rotation.y = IDENTITY_TURN.y; out.rotation.z = IDENTITY_TURN.z;
}

function copyDelta(out: RootMotionDelta, src: RootMotionDelta): void {
    out.position.x = src.position.x; out.position.y = src.position.y; out.position.z = src.position.z;
    out.rotation.w = src.rotation.w; out.rotation.x = src.rotation.x;
    out.rotation.y = src.rotation.y; out.rotation.z = src.rotation.z;
}

function zeroDelta(out: RootMotionDelta): void {
    out.position.x = 0; out.position.y = 0; out.position.z = 0;
    out.rotation.w = 0; out.rotation.x = 0; out.rotation.y = 0; out.rotation.z = 0;
}

/** Move `out` a `weight` share of the way to `src`. */
function leanDelta(out: RootMotionDelta, src: RootMotionDelta, weight: number): void {
    out.position.x += (src.position.x - out.position.x) * weight;
    out.position.y += (src.position.y - out.position.y) * weight;
    out.position.z += (src.position.z - out.position.z) * weight;
    leanQuat(out.rotation, src.rotation, weight);
}

/** Accumulate `src * weight` into a zeroed `out`; the caller normalizes at the end. */
function addDelta(out: RootMotionDelta, src: RootMotionDelta, weight: number): void {
    out.position.x += src.position.x * weight;
    out.position.y += src.position.y * weight;
    out.position.z += src.position.z * weight;
    accumulateQuat(out.rotation, HEMISPHERE, src.rotation, weight);
}

const IDENTITY_TURN = { w: 1, x: 0, y: 0, z: 0 };
/** Every contribution aligns to the identity, which is the rotation a motion
 *  stating no turn already has — so the reference is never absent. */
const HEMISPHERE = { w: 1, x: 0, y: 0, z: 0 };

// =============================================================================
// 2D blend — the same mixing, over a plane instead of a line
// =============================================================================

/**
 * Gradient-band weights, normalized to sum to one: each point keeps what the
 * neighbour nearest to pushing it out leaves it. That puts a sample standing on a
 * clip entirely on that clip, and holds one outside the hull by its nearest edge
 * rather than letting it fall to nothing. Only `weight` is written.
 */
export function blend2DWeights(
    blend: AnimatorBlend2DMotion, x: number, y: number, out: { weight: number }[],
): void {
    const points = blend.points;
    let total = 0;
    for (let i = 0; i < points.length; i++) {
        const pi = points[i]!.position;
        let weight = 1;
        for (let j = 0; j < points.length && weight > 0; j++) {
            if (j === i) continue;
            const ijx = points[j]!.position.x - pi.x;
            const ijy = points[j]!.position.y - pi.y;
            const span = ijx * ijx + ijy * ijy;
            if (span <= 0) continue;
            const along = ((x - pi.x) * ijx + (y - pi.y) * ijy) / span;
            if (1 - along < weight) weight = 1 - along;
        }
        out[i]!.weight = weight > 0 ? weight : 0;
        total += out[i]!.weight;
    }
    // Two points at the same place, or none: nothing said where the sample is,
    // so the first point answers rather than the pose collapsing to the world.
    if (total <= 0) {
        if (points.length > 0) out[0]!.weight = 1;
        return;
    }
    for (let i = 0; i < points.length; i++) out[i]!.weight /= total;
}

/** Read into on every call and consumed before anything re-enters — this module
 *  never calls out while it holds a claim on this. */
const DOMINANT: { weight: number }[] = [];

/** The point carrying the most weight: what a motion that can only be SWITCHED
 *  to gets, and who speaks for the blend's events and its end. */
export function dominantBlendPoint(
    blend: AnimatorBlend2DMotion, x: number, y: number,
): AnimatorBlendPoint | null {
    const points = blend.points;
    if (points.length === 0) return null;
    while (DOMINANT.length < points.length) DOMINANT.push({ weight: 0 });
    blend2DWeights(blend, x, y, DOMINANT);
    let best = 0;
    for (let i = 1; i < points.length; i++) {
        if (DOMINANT[i]!.weight > DOMINANT[best]!.weight) best = i;
    }
    return points[best]!;
}

/** Where this blend sits in its plane, both parameters being floats even when
 *  nothing set them. */
function blend2DAt(ctx: MotionContext, blend: AnimatorBlend2DMotion): { x: number; y: number } {
    AT.x = Number(ctx.params[blend.parameterX] ?? 0);
    AT.y = Number(ctx.params[blend.parameterY] ?? 0);
    return AT;
}

const AT = { x: 0, y: 0 };

function dominantOf(
    ctx: MotionContext, blend: AnimatorBlend2DMotion,
): AnimatorMotion | null {
    const { x, y } = blend2DAt(ctx, blend);
    return dominantBlendPoint(blend, x, y)?.motion ?? null;
}

/**
 * The same operation the 1D blend performs, with the weights coming from a plane
 * rather than a line — which is why this shares the pose mixer and the phase
 * synchronisation rather than restating either.
 */
export const blend2DMotionDriver: MotionDriver<AnimatorBlend2DMotion> = {
    apply(ctx, blend, enter) {
        const dominant = dominantOf(ctx, blend);
        if (dominant) ctx.drive(dominant, enter);
    },
    sample(ctx, blend, time, pose) {
        const points = blend.points;
        if (points.length === 0) return false;
        if (points.length === 1) return ctx.sample(points[0]!.motion, time, pose);

        const mix = ctx.borrowMix();
        let sampled = 0;
        try {
            mixCapacity(mix, points.length);
            const { x, y } = blend2DAt(ctx, blend);
            blend2DWeights(blend, x, y, mix);

            // The blend's own length is its points' lengths under those weights,
            // and each point is then read at its own share of it — the 1D blend's
            // phase rule, which stops the shorter clips racing.
            let whole = 0;
            for (let i = 0; i < points.length; i++) {
                if (mix[i]!.weight <= 0) continue;
                const span = ctx.duration(points[i]!.motion);
                if (span <= 0) { whole = 0; break; }
                whole += mix[i]!.weight * span;
            }

            // Compacting into the prefix is safe because the entry being written
            // is never past the one being read.
            for (let i = 0; i < points.length; i++) {
                const weight = mix[i]!.weight;
                if (weight <= 0) continue;
                const motion = points[i]!.motion;
                const at = whole > 0 ? time * (ctx.duration(motion) / whole) : time;
                const scratch = ctx.borrowPose();
                scratch.reset();
                if (!ctx.sample(motion, at, scratch)) { ctx.releasePose(scratch); continue; }
                mix[sampled]!.pose = scratch;
                mix[sampled]!.weight = weight;
                sampled++;
            }

            if (sampled === 0) return false;
            if (sampled === 1) {
                // Its weight is whatever the points that could not be sampled
                // left it; as the only thing there is to show it arrives whole.
                mix[0]!.weight = 1;
            }
            mixPoses(mix, pose, ctx.world, sampled);
            return true;
        } finally {
            for (let i = 0; i < sampled; i++) ctx.releasePose(mix[i]!.pose);
            ctx.releaseMix(mix);
        }
    },
    duration(ctx, blend) {
        const points = blend.points;
        if (points.length === 0) return 0;
        const mix = ctx.borrowMix();
        try {
            mixCapacity(mix, points.length);
            const { x, y } = blend2DAt(ctx, blend);
            blend2DWeights(blend, x, y, mix);
            let whole = 0;
            for (let i = 0; i < points.length; i++) {
                if (mix[i]!.weight <= 0) continue;
                const span = ctx.duration(points[i]!.motion);
                // A point that does not state its length cannot be averaged with
                // one that does, so the dominant point answers alone.
                if (span <= 0) return ctx.duration(dominantOf(ctx, blend) ?? points[0]!.motion);
                whole += mix[i]!.weight * span;
            }
            return whole;
        } finally {
            ctx.releaseMix(mix);
        }
    },
    loops(ctx, blend) {
        const dominant = dominantOf(ctx, blend);
        return dominant ? ctx.loops(dominant) : false;
    },
    isFinished(ctx, blend) {
        const dominant = dominantOf(ctx, blend);
        return dominant ? ctx.finished(dominant) : false;
    },
    events(ctx, blend, span, out) {
        const dominant = dominantOf(ctx, blend);
        if (dominant) ctx.events(dominant, span, out);
    },
    rootMotion(ctx, blend, span, out) {
        const points = blend.points;
        if (points.length === 0) return false;
        const mix = ctx.borrowMix();
        const part = ctx.borrowDelta();
        try {
            mixCapacity(mix, points.length);
            const { x, y } = blend2DAt(ctx, blend);
            blend2DWeights(blend, x, y, mix);
            zeroDelta(out);
            let stated = false;
            for (let i = 0; i < points.length; i++) {
                const weight = mix[i]!.weight;
                if (weight <= 0) continue;
                if (!ctx.rootDelta(points[i]!.motion, span, part)) continue;
                addDelta(out, part, weight);
                stated = true;
            }
            if (stated) normalizeQuat(out.rotation);
            return stated;
        } finally {
            ctx.releaseDelta(part);
            ctx.releaseMix(mix);
        }
    },
};
