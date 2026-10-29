// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationPlugin.ts
 * @brief   Animation plugin registering Tween and SpriteAnimator systems
 */

import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { EventWriter, type EventWriterInstance } from '../ecs/event';
import { AnimatorEvent, type AnimatorEventPayload } from './animatorEvent';
import { Time, type TimeData } from '../ecs/resource';
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { log } from '../util/logger';
import type { AnimCore } from './Tween';
import { Tween, TweenAPI } from './Tween';
import { SpriteAnimation, SpriteAnimationAPI, type SpriteAnimClip } from './SpriteAnimator';
import { AnimatorController, AnimatorControllerAPI, type AnimatorControllerDef } from './Animator';
import type { AnimatorAvatar } from './animatorAvatar';
import { appRegistryAsset } from '../asset/registryLookup';
import { playModeOnly } from '../ecs/env';
import { installCoverFade } from '../render/coverFade';
import { installRainShelter } from '../render/rainShelter';
import { installSight } from '../render/sight';
import { SystemLabel } from '../ecs/systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';
    private readonly despawnCleanups_ = new WeakMap<App, () => void>();
    private latestDespawnCleanup_: (() => void) | null = null;

    build(app: App): void {
        this.cleanup(app);
        // Whichever core is present (see ecs/engineApi.ts). Sprite animation and the
        // animator graph are pure TypeScript, but tweens live in the engine, so a core
        // that compiles no tween system gets the rest of the plugin and says so.
        const engine = engineApi(app);
        const registry = app.world.getCppRegistry() as CppRegistry;
        if (engine && typeof engine.anim_createTween !== 'function') {
            log.warn('animation', 'this engine core has no tween system — Tween.to() will not animate');
        }
        const tween = new TweenAPI(engine ?? {}, registry);
        app.insertResource(Tween, tween);
        const anim = new SpriteAnimationAPI();
        app.insertResource(SpriteAnimation, anim);
        const animator = new AnimatorControllerAPI();
        app.insertResource(AnimatorController, animator);
        const world = app.world;

        const offDespawn = world.onDespawn((entity: Entity) => {
            tween.cancelAll(entity);
            anim.removeEntityListeners(entity);
            animator.removeEntity(entity);
        });
        // A roof or a crown with a CoverFade thins out over what stands under it; with none in the scene the system finds nothing and returns.
        const offCoverFade = installCoverFade(app);
        const offRainShelter = installRainShelter(app);
        const offSight = installSight(app);
        const release = (): void => { offDespawn(); offCoverFade(); offRainShelter(); offSight(); };
        this.despawnCleanups_.set(app, release);
        this.latestDespawnCleanup_ = release;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Tween)],
            (time: TimeData, tweenAPI: TweenAPI) => {
                tweenAPI.update(time.delta);
            },
            { name: 'TweenSystem' }
        ), { runIf: playModeOnly });

        // A `.esanim` / `.esanimator` comes from THIS app's realm, whose slots
        // answer to the authored ref as well as the resolved path. A code
        // registration still wins over one.
        anim.useAssetClips((ref) => appRegistryAsset<SpriteAnimClip>(app, 'anim-clip', ref));
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

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(SpriteAnimation)],
            (time: TimeData, animApi: SpriteAnimationAPI) => {
                animApi.update(world, time.delta);
            },
            { name: 'SpriteAnimatorSystem' }
        ), { runAfter: [SystemLabel.Tween, SystemLabel.Animator], runIf: playModeOnly });
    }

    cleanup(app?: App): void {
        const release = app ? this.despawnCleanups_.get(app) : this.latestDespawnCleanup_;
        if (!release) return;
        if (app) this.despawnCleanups_.delete(app);
        if (release === this.latestDespawnCleanup_) this.latestDespawnCleanup_ = null;
        release();
    }
}

export const animationPlugin = new AnimationPlugin();
