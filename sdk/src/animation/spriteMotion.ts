// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spriteMotion.ts
 * @brief   The `sprite` motion kind: an animator state driving a sprite clip.
 *
 * @details Playback itself stays SpriteAnimationAPI's — this only points the
 *          entity's SpriteAnimator at a clip and reads back whether it ended, so
 *          there is still exactly one thing advancing sprite frames.
 */

import type { MotionDriver, AnimatorClipMotion } from './motion';
import { SpriteAnimator, type SpriteAnimatorData } from './SpriteAnimator';

export const SPRITE_MOTION = 'sprite';

export const spriteMotionDriver: MotionDriver<AnimatorClipMotion> = {
    apply({ world, entity }, motion, enter) {
        if (!world.has(entity, SpriteAnimator)) return;
        const current = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
        // Steady state is a no-op: rewriting the clip every frame would hold it
        // on frame 0 forever.
        if (current.clip === motion.clip && !enter) return;

        world.update(entity, SpriteAnimator, (sp: SpriteAnimatorData) => {
            sp.clip = motion.clip;
            sp.speed = motion.speed ?? 1.0;
            sp.loop = motion.loop ?? true;
            sp.currentFrame = 0;
            sp.frameTimer = 0;
            sp.playing = true;
            sp.finished = false;
            sp.enabled = true;
        });
    },

    isFinished({ world, entity }, motion) {
        if (!world.has(entity, SpriteAnimator)) return false;
        const sp = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
        // Playing THIS clip and stopped — not merely stopped, which is also true
        // on the frame before the clip has been applied at all.
        return sp.clip === motion.clip && sp.clip !== '' && !sp.playing;
    },
};
