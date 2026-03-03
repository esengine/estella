/**
 * @file    AnimationPlugin.ts
 * @brief   Animation plugin registering Tween and SpriteAnimator systems
 */

import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { initTweenAPI, shutdownTweenAPI, Tween } from './Tween';
import { spriteAnimatorSystemUpdate } from './SpriteAnimator';
import { isEditor, isPlayMode } from '../env';

export class AnimationPlugin implements Plugin {
    name = 'AnimationPlugin';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        initTweenAPI(module, registry);
        const world = app.world;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                if (isEditor() && !isPlayMode()) return;
                Tween.update(time.delta);
            },
            { name: 'TweenSystem' }
        ));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                if (isEditor() && !isPlayMode()) return;
                spriteAnimatorSystemUpdate(world, time.delta);
            },
            { name: 'SpriteAnimatorSystem' }
        ), { runAfter: ['TweenSystem'] });
    }

    cleanup(): void {
        shutdownTweenAPI();
    }
}

export const animationPlugin = new AnimationPlugin();
