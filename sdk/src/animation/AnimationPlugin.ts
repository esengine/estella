// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { SpriteAnimation, SpriteAnimationApi } from './SpriteAnimator';
import { playModeOnly } from '../env';
import { SystemLabel } from '../systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        const tween = new TweenAPI(module, registry);
        app.insertResource(Tween, tween);
        const anim = new SpriteAnimationApi();
        app.insertResource(SpriteAnimation, anim);
        const world = app.world;

        world.onDespawn((entity: Entity) => {
            tween.cancelAll(entity);
            anim.removeEntityListeners(entity);
        });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Tween)],
            (time: TimeData, tweenAPI: TweenAPI) => {
                tweenAPI.update(time.delta);
            },
            { name: 'TweenSystem' }
        ), { runIf: playModeOnly });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(SpriteAnimation)],
            (time: TimeData, animApi: SpriteAnimationApi) => {
                animApi.update(world, time.delta);
            },
            { name: 'SpriteAnimatorSystem' }
        ), { runAfter: [SystemLabel.Tween], runIf: playModeOnly });
    }
}

export const animationPlugin = new AnimationPlugin();
