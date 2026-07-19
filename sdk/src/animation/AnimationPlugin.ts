// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationPlugin.ts
 * @brief   Animation plugin registering Tween and SpriteAnimator systems
 */

import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import type { Entity } from '../types';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { Tween, TweenAPI } from './Tween';
import { SpriteAnimation, SpriteAnimationAPI } from './SpriteAnimator';
import { AnimatorController, AnimatorControllerAPI } from './Animator';
import { playModeOnly } from '../env';
import { SystemLabel } from '../systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        const tween = new TweenAPI(module, registry);
        app.insertResource(Tween, tween);
        const anim = new SpriteAnimationAPI();
        app.insertResource(SpriteAnimation, anim);
        const animator = new AnimatorControllerAPI();
        app.insertResource(AnimatorController, animator);
        const world = app.world;

        this.offDespawn_ = world.onDespawn((entity: Entity) => {
            tween.cancelAll(entity);
            anim.removeEntityListeners(entity);
            animator.removeEntity(entity);
        });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Tween)],
            (time: TimeData, tweenAPI: TweenAPI) => {
                tweenAPI.update(time.delta);
            },
            { name: 'TweenSystem' }
        ), { runIf: playModeOnly });

        // The state machine runs before the sprite animator so a transition's
        // clip switch applies the same frame it fires.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(AnimatorController)],
            (ctrl: AnimatorControllerAPI) => {
                ctrl.update(world);
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

    cleanup(): void {
        // Drop the despawn subscription so a warm re-Play with a reused world
        // doesn't stack a second (stale) closure.
        this.offDespawn_?.();
        this.offDespawn_ = null;
    }
}

export const animationPlugin = new AnimationPlugin();
