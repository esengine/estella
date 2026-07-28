// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationPlugin.ts
 * @brief   Animation plugin registering Tween and SpriteAnimator systems
 */

import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Time, type TimeData } from '../ecs/resource';
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { log } from '../util/logger';
import type { AnimCore } from './Tween';
import { Tween, TweenAPI } from './Tween';
import { SpriteAnimation, SpriteAnimationAPI } from './SpriteAnimator';
import { AnimatorController, AnimatorControllerAPI } from './Animator';
import { Assets } from '../asset/AssetPlugin';
import { resolveAssetKey } from '../asset/resolveAssetKey';
import { playModeOnly } from '../util/env';
import { SystemLabel } from '../ecs/systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
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

        // Resolve a `.esanimator` controller ref to the load path its loader keyed
        // the store with (an `estella://…` URL in the play realm), matching the FSM
        // plugin — without it, an Animator referencing a controller BY PATH resolves
        // to nothing at runtime and silently never seeds a state.
        const resolveKey = (ref: string): string =>
            resolveAssetKey(app.hasResource(Assets) ? app.getResource(Assets) : null, ref);

        // The state machine runs before the sprite animator so a transition's
        // clip switch applies the same frame it fires.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(AnimatorController)],
            (ctrl: AnimatorControllerAPI) => {
                ctrl.update(world, resolveKey);
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
