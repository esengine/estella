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

export type AnimatorMotion = AnimatorClipMotion | AnimatorBlend1DMotion;

export function isBlend1D(m: AnimatorMotion): m is AnimatorBlend1DMotion {
    return m.kind === 'blend1d';
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
    /** Scratch poses lent to composite motions. A pool and not one buffer per
     *  driver: nesting decides how many are live at once, and only the stack
     *  knows that. */
    private readonly posePool_: Pose[] = [];

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
    context(world: World, entity: Entity, params: MotionParams): MotionContext {
        const ctx = this.ctx_;
        ctx.world = world;
        ctx.entity = entity;
        ctx.params = params;
        ctx.extractRootMotion = false;
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
const MIX: [WeightedPose, WeightedPose] = [
    { pose: null!, weight: 0 }, { pose: null!, weight: 0 },
];

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

            MIX[0].pose = from; MIX[0].weight = 1 - t;
            MIX[1].pose = to; MIX[1].weight = t;
            mixPoses(MIX, pose, ctx.world);
            return true;
        } finally {
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
    rootMotion(ctx, blend, span, out) {
        const selected = blendSelection(ctx, blend);
        return selected !== null && ctx.rootDelta(selected, span, out);
    },
};
