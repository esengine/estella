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
import { spriteAnimatorSystemUpdate, removeAnimEventListeners } from './SpriteAnimator';
import { playModeOnly } from '../env';
import { SystemLabel } from '../systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        const tween = new TweenAPI(module, registry);
        app.insertResource(Tween, tween);
        const world = app.world;

        world.onDespawn((entity: Entity) => {
            tween.cancelAll(entity);
            removeAnimEventListeners(entity);
        });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Tween)],
            (time: TimeData, tweenAPI: TweenAPI) => {
                tweenAPI.update(time.delta);
            },
            { name: 'TweenSystem' }
        ), { runIf: playModeOnly });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                spriteAnimatorSystemUpdate(world, time.delta);
            },
            { name: 'SpriteAnimatorSystem' }
        ), { runAfter: [SystemLabel.Tween], runIf: playModeOnly });
    }
}

export const animationPlugin = new AnimationPlugin();
