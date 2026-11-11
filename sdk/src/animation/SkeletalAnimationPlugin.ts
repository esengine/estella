// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SkeletalAnimationPlugin.ts
 * @brief   The animator graph (states, blends, IK, avatars, root motion) and grip poses.
 *
 * Split from AnimationPlugin because a game with no skeleton to drive — a 2D one,
 * a UI one — carried ~65KB of it all the same: tweens and sprite clips are the
 * part every package uses, this is the part a rigged character does. It installs
 * where the content uses it (see `skeletalAnimationSupport.ts`); the full entry
 * installs it beside everything else.
 *
 * Builds right after `animation` (PLUGIN_BUILD_ORDER) because spine, 3D physics,
 * the timeline and gameplay all look for the AnimatorController resource this
 * inserts and degrade without it.
 */

import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { EventWriter, type EventWriterInstance } from '../ecs/event';
import { AnimatorEvent, type AnimatorEventPayload } from './animatorEvent';
import type { Entity } from '../types';
import { AnimatorController, AnimatorControllerAPI, type AnimatorControllerDef } from './Animator';
import type { AnimatorAvatar } from './animatorAvatar';
import { appRegistryAsset } from '../asset/registryLookup';
import { playModeOnly } from '../ecs/env';
import { SystemLabel } from '../ecs/systemLabels';
import { installGripPose } from './gripPose';
import { installGripHold } from './gripHold';

export class SkeletalAnimationPlugin implements Plugin {
    name = 'skeletalAnimation';
    private readonly despawnCleanups_ = new WeakMap<App, () => void>();
    private latestDespawnCleanup_: (() => void) | null = null;

    build(app: App): void {
        this.cleanup(app);
        const animator = new AnimatorControllerAPI();
        app.insertResource(AnimatorController, animator);
        const world = app.world;

        const offDespawn = world.onDespawn((entity: Entity) => {
            animator.removeEntity(entity);
        });
        this.despawnCleanups_.set(app, offDespawn);
        this.latestDespawnCleanup_ = offDespawn;

        // A `.esanimator` / `.esavatar` comes from THIS app's realm, whose slots
        // answer to the authored ref as well as the resolved path. A code
        // registration still wins over one.
        animator.useAssetAvatars((ref) => appRegistryAsset<AnimatorAvatar>(app, 'avatar', ref));
        animator.useAssetControllers(
            (ref) => appRegistryAsset<AnimatorControllerDef>(app, 'animatorcontroller', ref),
        );

        // The state machine runs before the sprite animator so a transition's
        // clip switch applies the same frame it fires.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(AnimatorController), EventWriter(AnimatorEvent)],
            (
                time: TimeData, ctrl: AnimatorControllerAPI,
                events: EventWriterInstance<AnimatorEventPayload>,
            ) => {
                ctrl.update(world, time.delta, events);
            },
            { name: 'AnimatorSystem' }
        ), { runAfter: [SystemLabel.Tween], runIf: playModeOnly });

        // The hold first: it hands the fingers it does not pose itself to the grip pose after it.
        installGripHold(app);
        installGripPose(app);
    }

    cleanup(app?: App): void {
        const release = app ? this.despawnCleanups_.get(app) : this.latestDespawnCleanup_;
        if (!release) return;
        if (app) this.despawnCleanups_.delete(app);
        if (release === this.latestDespawnCleanup_) this.latestDespawnCleanup_ = null;
        release();
    }
}

export const skeletalAnimationPlugin = new SkeletalAnimationPlugin();
