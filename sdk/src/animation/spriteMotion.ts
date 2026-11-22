// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spriteMotion.ts
 * @brief   The `sprite` motion kind: an animator state driving a sprite clip.
 *
 * @details The graph selects the clip. Both standalone and graph-driven
 *          sprites advance in SpriteAnimationAPI, including their frame events.
 */

import type { MotionDriver, AnimatorClipMotion } from './motion';
import { SpriteAnimator, SpriteMotionPlayback } from './SpriteAnimator';

export const SPRITE_MOTION = 'sprite';

export const spriteMotionDriver: MotionDriver<AnimatorClipMotion> = {
    lastLayerOnly: true,

    apply({ world, entity }, motion, enter) {
        const authored = world.has(entity, SpriteAnimator);

        if (!world.has(entity, SpriteMotionPlayback)) {
            world.insert(entity, SpriteMotionPlayback, { ...SpriteMotionPlayback._default });
        }
        world.update(entity, SpriteMotionPlayback, request => {
            const player = authored ? world.get(entity, SpriteAnimator) : request.player;
            const speed = motion.speed ?? 1;
            const loopOverride = motion.loop ?? null;
            const settingsChanged = request.speed !== speed || request.loopOverride !== loopOverride;
            request.requested = true;
            request.speed = speed;
            request.loopOverride = loopOverride;
            if (authored) request.player = null;

            const restart = enter || !player || player.clip !== motion.clip;
            if (!restart && !settingsChanged) return;
            const settings = { speed, loop: motion.loop ?? true };
            // Selecting the same clip in consecutive states also restarts its
            // first frame and event. Keep an authored player's identity for readers.
            const changes = restart ? { ...SpriteAnimator._default, ...settings, clip: motion.clip } : settings;
            if (restart) request.restart = true;
            if (authored) world.update(entity, SpriteAnimator, draft => Object.assign(draft, changes));
            else request.player = Object.assign(player ?? SpriteAnimator.create(), changes);
        });
    },

    isFinished({ world, entity }, motion) {
        if (!world.has(entity, SpriteMotionPlayback)) return false;
        const player = world.has(entity, SpriteAnimator)
            ? world.get(entity, SpriteAnimator) : world.get(entity, SpriteMotionPlayback).player;
        return !!player && player.clip === motion.clip && player.clip !== '' && player.finished && !player.playing;
    },
};
