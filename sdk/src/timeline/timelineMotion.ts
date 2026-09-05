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

import type { MotionDriver, AnimatorClipMotion, MotionContext } from '../animation/motion';
import type { Pose } from '../animation/pose';
import { getComponent } from '../ecs/component';
import { applyWrapMode, sampleTimelineIntoPose, type SampleDeps } from './TimelineEvaluator';
import { resolveChildEntity } from './TimelineRuntime';
import { WrapMode, type TimelineAsset } from './TimelineTypes';
import type { TimelineAPI } from './TimelineControl';

export const TIMELINE_MOTION = 'timeline';

/** How the motion wants the clip wrapped; unstated leaves the clip's own. */
function wrapOf(motion: AnimatorClipMotion, asset: TimelineAsset): WrapMode {
    if (motion.loop === undefined) return asset.wrapMode;
    return motion.loop ? WrapMode.Loop : WrapMode.Once;
}

const speedOf = (motion: AnimatorClipMotion): number => Math.max(motion.speed ?? 1, 1e-4);

/**
 * The driver, over the app's own {@link TimelineAPI}: which clip a name resolves
 * to is per App, so this is built per App rather than being a module value.
 */
export function createTimelineMotionDriver(timeline: TimelineAPI): MotionDriver<AnimatorClipMotion> {
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
            sampleTimelineIntoPose(asset, local.time, ctx.entity, deps, pose);
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
