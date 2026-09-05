// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineMotion.ts
 * @brief   The `timeline` motion kind: an animator state driving an `.estimeline`.
 *
 * @details This is what lets one animator graph animate a skinned model. A
 *          skeletal clip IS a timeline — property tracks writing each joint
 *          entity's Transform — so the driver only points the entity's
 *          TimelinePlayer at a clip and reads back whether it ended. Sampling,
 *          and therefore the single path from joint Transform to MeshSkin, stays
 *          TimelinePlugin's: the animator adds no second owner of a bone pose.
 */

import type { MotionDriver, AnimatorClipMotion, MotionContext } from '../animation/motion';
import { TimelinePlayer, type TimelinePlayerData } from './TimelinePlayerComponent';
import type { TimelineAPI } from './TimelineControl';

export const TIMELINE_MOTION = 'timeline';

/** Which wrap mode a motion asks for; empty leaves the clip's own standing. */
function wrapModeFor(loop: boolean | undefined): string {
    return loop === undefined ? '' : loop ? 'loop' : 'once';
}

/**
 * The driver, over the app's own {@link TimelineAPI} — the clock a clip runs on
 * is per App, so this is built per App rather than being a module-level value.
 */
export function createTimelineMotionDriver(timeline: TimelineAPI): MotionDriver<AnimatorClipMotion> {
    return {
        apply({ world, entity }: MotionContext, motion, enter) {
            if (!world.has(entity, TimelinePlayer)) return;
            const current = world.get(entity, TimelinePlayer) as TimelinePlayerData;
            if (current.timeline === motion.clip && !enter) return;

            world.update(entity, TimelinePlayer, (p: TimelinePlayerData) => {
                p.timeline = motion.clip;
                p.speed = motion.speed ?? 1.0;
                p.wrapMode = wrapModeFor(motion.loop);
                p.playing = true;
                p.finished = false;
            });
            // The clock lives beside the component, not in it, and a clip that
            // replaces another must start at its own beginning rather than
            // wherever the previous one had got to.
            const state = timeline.getState(entity);
            if (state) {
                state.time = 0;
                state.prevTime = 0;
                state.spineClipIndices = {};
            }
        },

        isFinished({ world, entity }: MotionContext, motion) {
            if (!world.has(entity, TimelinePlayer)) return false;
            const p = world.get(entity, TimelinePlayer) as TimelinePlayerData;
            // Playing THIS clip and latched finished. A looping clip never
            // latches, so an exit-time transition out of one never fires — which
            // is what it means for the clip to have no end.
            return p.timeline === motion.clip && p.finished;
        },
    };
}
