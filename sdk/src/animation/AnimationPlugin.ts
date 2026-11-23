// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationPlugin.ts
 * @brief   Animation plugin registering Tween and SpriteAnimator systems
 *
 * The animator graph and grip poses are SkeletalAnimationPlugin's.
 */

import type { App, Plugin } from '../app/app';
import { PluginInstallations } from '../app/pluginInstallations';
import { disposeAll } from '../util/disposeAll';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Time, type TimeData } from '../ecs/resource';
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { log } from '../util/logger';
import { Tween, TweenAPI } from './Tween';
import { SpriteAnimation, SpriteAnimationAPI, type SpriteAnimClip } from './SpriteAnimator';
import { appRegistryAsset } from '../asset/registryLookup';
import { playModeOnly } from '../ecs/env';
import { installCoverFade } from '../render/coverFade';
import { installRainShelter } from '../render/rainShelter';
import { installSight } from '../render/sight';
import { installFogOfWar } from '../render/fogOfWar';
import { installSwayPush } from '../render/swayPush';
import { installWindField } from '../render/windField';
import { installFootsteps } from '../render/footsteps';
import { SystemLabel } from '../ecs/systemLabels';

export class AnimationPlugin implements Plugin {
    name = 'animation';
    private readonly cleanups_ = new PluginInstallations<Array<() => void>>();

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
        const world = app.world;

        const cleanups: Array<() => void> = [];
        this.cleanups_.set(app, cleanups);
        cleanups.push(world.onDespawn((entity: Entity) => {
            tween.cancelAll(entity);
            anim.removeEntityListeners(entity);
        }));
        // A roof or a crown with a CoverFade thins out over what stands under it; with none in the scene the system finds nothing and returns.
        cleanups.push(installCoverFade(app));
        cleanups.push(installRainShelter(app));
        cleanups.push(installSight(app));
        // After the sight system, whose walls it casts rays against.
        cleanups.push(installFogOfWar(app));
        cleanups.push(installSwayPush(app));
        cleanups.push(installWindField(app));
        cleanups.push(installFootsteps(app));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Tween)],
            (time: TimeData, tweenAPI: TweenAPI) => {
                tweenAPI.update(time.delta);
            },
            { name: 'TweenSystem' }
        ), { runIf: playModeOnly });

        // A `.esanim` comes from THIS app's realm, whose slots answer to the
        // authored ref as well as the resolved path. A code registration still
        // wins over one.
        anim.useAssetClips((ref) => appRegistryAsset<SpriteAnimClip>(app, 'anim-clip', ref));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(SpriteAnimation)],
            (time: TimeData, animApi: SpriteAnimationAPI) => {
                animApi.update(world, time.delta);
            },
            { name: 'SpriteAnimatorSystem' }
        ), { runAfter: [SystemLabel.Tween, SystemLabel.Animator], runIf: playModeOnly });
    }

    cleanup(app?: App): void {
        const cleanups = this.cleanups_.take(app);
        if (cleanups) disposeAll(cleanups, release => release());
    }
}

export const animationPlugin = new AnimationPlugin();
