// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineMotion.ts
 * @brief   The `timeline` motion kind: an animator state driving an `.estimeline`.
 *
 * @details This is what lets one animator graph animate a skinned model. A
 *          skeletal clip IS a timeline - property tracks writing each joint
 *          entity's Transform - so this driver samples the same asset with the
 *          same evaluator, and what it produces is a pose rather than a write.
 *          The path from joint Transform to MeshSkin is unchanged: the animator
 *          adds no second owner of a bone pose.
 *
 *          It does not touch TimelinePlayer. That component carries a clip's own
 *          clock for standalone playback, and one clock cannot serve two clips
 *          at once - which crossfade needs. The animator keeps the time and
 *          hands it in; TimelinePlayer stays what a timeline plays on when no
 *          animator is involved.
 */

import type {
    MotionDriver, AnimatorClipMotion, MotionContext, MotionSpan, MotionEvent, RootMotionDelta,
} from '../animation/motion';
import type { Pose } from '../animation/pose';
import { getComponent } from '../ecs/component';
import {
    applyWrapMode, sampleTimelineIntoPose, isRootPlacementChannel,
    sampleRootPlacement, createRootPlacement, type SampleDeps, type SampleOptions,
} from './TimelineEvaluator';
import { playheadRuns, collectCustomEvents } from './timelineEvents';
import { resolveChildEntity } from './TimelineRuntime';
import { WrapMode, type TimelineAsset } from './TimelineTypes';
import { q } from '../math/quat';
import type { TimelineAPI } from './TimelineControl';

export const TIMELINE_MOTION = 'timeline';

/** How the motion wants the clip wrapped; unstated leaves the clip's own. */
function wrapOf(motion: AnimatorClipMotion, asset: TimelineAsset): WrapMode {
    if (motion.loop === undefined) return asset.wrapMode;
    return motion.loop ? WrapMode.Loop : WrapMode.Once;
}

const speedOf = (motion: AnimatorClipMotion): number => Math.max(motion.speed ?? 1, 1e-4);

/**
 * What the pose must not state while the animator is taking the root track as
 * displacement. Not a filter the animator passes in: which channels those are is
 * the evaluator's own answer, and the extractor reads the same one.
 */
const WITHOUT_ROOT: SampleOptions = { skipChannel: isRootPlacementChannel };

/**
 * The driver, over the app's own {@link TimelineAPI}: which clip a name resolves
 * to is per App, so this is built per App rather than being a module value.
 */
export function createTimelineMotionDriver(timeline: TimelineAPI): MotionDriver<AnimatorClipMotion> {
    // Two placements, reused: extraction runs per animated entity per frame, and
    // one of these per call is an allocation the steady state does not need.
    const before = createRootPlacement();
    const after = createRootPlacement();

    /** The span in the CLIP's own time, split where its wrap makes it discontinuous. */
    const runsOf = (asset: TimelineAsset, motion: AnimatorClipMotion, span: MotionSpan) => {
        const speed = speedOf(motion);
        return playheadRuns(
            span.from * speed, span.to * speed,
            asset.duration, wrapOf(motion, asset), span.inclusiveStart,
        );
    };

    // One deps record, re-aimed per call. The sampler asks it for the world and
    // the child resolver; both are the same for every entity in a frame except
    // the world reference, which the context supplies.
    const deps: SampleDeps = {
        world: null!,
        getComponent,
        resolveChild: (root, childPath) => resolveChildEntity(deps.world as never, root, childPath),
    };

    return {
        sample(ctx: MotionContext, motion: AnimatorClipMotion, time: number, pose: Pose): boolean {
            const asset = timeline.getAsset(motion.clip);
            if (!asset) return false;
            const local = applyWrapMode(time * speedOf(motion), asset.duration, wrapOf(motion, asset));
            deps.world = ctx.world;
            sampleTimelineIntoPose(
                asset, local.time, ctx.entity, deps, pose,
                ctx.extractRootMotion ? WITHOUT_ROOT : undefined,
            );
            return true;
        },

        events(
            ctx: MotionContext, motion: AnimatorClipMotion, span: MotionSpan, out: MotionEvent[],
        ): void {
            const asset = timeline.getAsset(motion.clip);
            if (!asset) return;
            collectCustomEvents(asset, runsOf(asset, motion, span), out);
        },

        /**
         * The clip's own displacement over the span, summed run by run: a lap
         * boundary is a jump in clip time and a difference across it would read
         * as the character teleporting back to where the clip starts.
         */
        rootMotion(
            _ctx: MotionContext, motion: AnimatorClipMotion,
            span: MotionSpan, out: RootMotionDelta,
        ): boolean {
            const asset = timeline.getAsset(motion.clip);
            if (!asset || !sampleRootPlacement(asset, 0, before)) return false;

            out.position.x = 0; out.position.y = 0; out.position.z = 0;
            let turn = { w: 1, x: 0, y: 0, z: 0 };
            for (const run of runsOf(asset, motion, span)) {
                sampleRootPlacement(asset, run.from, before);
                sampleRootPlacement(asset, run.to, after);
                out.position.x += after.position.x - before.position.x;
                out.position.y += after.position.y - before.position.y;
                out.position.z += after.position.z - before.position.z;
                turn = q.mul(q.mul(after.rotation, q.conjugate(before.rotation)), turn);
            }
            out.rotation.w = turn.w; out.rotation.x = turn.x;
            out.rotation.y = turn.y; out.rotation.z = turn.z;
            return true;
        },

        /** In the animator's own seconds, which is why the speed divides out. */
        duration(_ctx: MotionContext, motion: AnimatorClipMotion): number {
            return (timeline.getAsset(motion.clip)?.duration ?? 0) / speedOf(motion);
        },

        loops(_ctx: MotionContext, motion: AnimatorClipMotion): boolean {
            const asset = timeline.getAsset(motion.clip);
            return asset ? wrapOf(motion, asset) !== WrapMode.Once : false;
        },
    };
}
