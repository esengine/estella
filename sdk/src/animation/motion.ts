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
import type { Pose } from './pose';

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
    };
}

// =============================================================================
// 1D blend — a motion in its own right, so it composes with every other kind
// =============================================================================

/**
 * The stop a 1D blend selects for `value`: the greatest threshold at or below it,
 * clamped up to the first when the parameter sits under them all. Pure.
 */
export function selectBlendStop(
    blend: AnimatorBlend1DMotion, value: number,
): AnimatorBlendStop | null {
    let atOrBelow: AnimatorBlendStop | null = null;
    let lowest: AnimatorBlendStop | null = null;
    for (const stop of blend.thresholds) {
        if (lowest === null || stop.value < lowest.value) lowest = stop;
        if (stop.value <= value && (atOrBelow === null || stop.value > atOrBelow.value)) {
            atOrBelow = stop;
        }
    }
    return atOrBelow ?? lowest;
}

/** The motion a blend is currently selecting, or null when it has no stops. */
function blendSelection(
    ctx: MotionContext, blend: AnimatorBlend1DMotion,
): AnimatorMotion | null {
    return selectBlendStop(blend, Number(ctx.params[blend.parameter] ?? 0))?.motion ?? null;
}

/**
 * Selection, not weighted mixing: a 1D blend picks the stop its parameter names
 * and plays it whole. Crossfading between neighbouring stops is the pose mixer's
 * to add, and lands here without the graph or any other driver changing.
 */
export const blend1DMotionDriver: MotionDriver<AnimatorBlend1DMotion> = {
    apply(ctx, blend, enter) {
        const selected = blendSelection(ctx, blend);
        if (selected) ctx.drive(selected, enter);
    },
    sample(ctx, blend, time, pose) {
        const selected = blendSelection(ctx, blend);
        return selected !== null && ctx.sample(selected, time, pose);
    },
    duration(ctx, blend) {
        const selected = blendSelection(ctx, blend);
        return selected ? ctx.duration(selected) : 0;
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
