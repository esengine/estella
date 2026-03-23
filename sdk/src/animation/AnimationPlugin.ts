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
import { initTweenAPI, shutdownTweenAPI, Tween } from './Tween';
import { spriteAnimatorSystemUpdate, removeAnimEventListeners } from './SpriteAnimator';
import { tweenCompositionManager } from './TweenGroup';
import { playModeOnly } from '../env';
import { SystemLabel } from '../systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        initTweenAPI(module, registry);
        const world = app.world;

        world.onDespawn((entity: Entity) => {
            Tween.cancelAll(entity);
            removeAnimEventListeners(entity);
        });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                Tween.update(time.delta);
                tweenCompositionManager.update();
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

    cleanup(): void {
        shutdownTweenAPI();
        tweenCompositionManager.clear();
    }
}

export const animationPlugin = new AnimationPlugin();
