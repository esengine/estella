// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { Schedule } from '../ecs/system';
import { Assets } from '../asset/AssetPlugin';
import { PostProcess, PostProcessAPI } from './PostProcessAPI';
import { postProcessVolumeSystem, editorViewVolumeSystem, cleanupVolumeSystem, setVolumeTextureResolver, setBuiltinTextureMaker, PostProcessVolumeConfigResource } from './volumeSystem';
import { createTextureFromPixels } from '../runtime/runtimeAssets';
import { TextureContent } from '../wasm';
import { weatherSystem, resetWeatherSystem } from './weatherSystem';
import { defineSystem } from '../ecs/system';
import { Query } from '../ecs/query';
import { Light, Transform, type LightData, type TransformData } from '../ecs/component';
import { LightType } from '../wasm/wasm.generated';
import { EditorView } from '../camera/EditorView';
import { linearColorSpace } from '../ecs/env';
import type { Entity } from '../types';
import { resolvedLightingSky } from './volumeSystem';
import { SkyEnvironment, skyParamsOf, skySunOf } from './skyEnvironment';

/** Toward the sun from the first directional light that shines: the way the sky's shader finds it (the light's aim reversed). */
function sunFromLights(lights: Iterable<[Entity, LightData, TransformData]>): [number, number, number] | null {
    for (const [, light, transform] of lights) {
        if (!light.enabled || light.intensity <= 0 || light.type !== LightType.Directional) continue;
        const q = transform.worldRotation;
        // The aim is the rotation's -Z: q * (0, 0, -1) * q^-1, written out.
        const ax = -(2 * (q.x * q.z + q.w * q.y));
        const ay = -(2 * (q.y * q.z - q.w * q.x));
        const az = -(1 - 2 * (q.x * q.x + q.y * q.y));
        const n = Math.hypot(ax, ay, az) || 1;
        return [-ax / n, -ay / n, -az / n];
    }
    return null;
}

/** The Sky Atmosphere as the scene's environment, after the volumes have resolved it for the view being drawn. */
function skyEnvironmentSystem(app: App, sky: SkyEnvironment) {
    return defineSystem(
        [Query(Light, Transform)],
        (lights: Iterable<[Entity, LightData, TransformData]>) => {
            if (!app.hasResource(PostProcess)) return;
            const view = app.hasResource(EditorView) ? app.getResource(EditorView) : null;
            const effect = resolvedLightingSky(app.getResource(PostProcess), !!view?.active);
            if (!effect) { sky.update(app.wasmModule, null, 0); return; }
            const params = skyParamsOf(effect);
            sky.update(app.wasmModule, { sun: skySunOf(params, sunFromLights(lights)), params, linear: linearColorSpace() },
                       performance.now() / 1000);
        },
        { name: 'SkyEnvironmentSystem', runWhenPaused: true },
    );
}

export class PostProcessPlugin implements Plugin {
    name = 'postProcess';
    readonly profileDomain = 'render';
    /** Each App's own: the plugin is one object, and an editor holds several apps (the edit world, a game playing). */
    private readonly skies_ = new WeakMap<App, SkyEnvironment>();

    build(app: App): void {
        // Per-App post-process API, injected into the render pipeline as an
        // optional stage (the pipeline has no hard dependency on it).
        const api = new PostProcessAPI();
        app.insertResource(PostProcess, api);
        app.pipeline?.setPostProcess(api);

        app.insertResource(PostProcessVolumeConfigResource, { enabled: true });
        // Effect texture params (LUTs, masks) resolve through this App's Assets;
        // PostProcessVolume's discoverAssets preloads the refs, so this is a
        // cache lookup by the time a volume applies.
        setVolumeTextureResolver((ref) =>
            app.hasResource(Assets) ? (app.getResource(Assets).getTexture(ref)?.handle ?? 0) : 0);
        // Textures an effect brings itself (AgX's table): uploaded as data, linear, clamped, with this App's module.
        setBuiltinTextureMaker((pixels) => createTextureFromPixels(app.wasmModule, pixels, TextureContent.Retained, false,
            { srgb: false, filterMode: 'linear', wrapMode: 'clamp' }));
        // The weather first: the volumes read what it has decided.
        app.addSystemToSchedule(Schedule.PostUpdate, weatherSystem);
        app.addSystemToSchedule(Schedule.PostUpdate, postProcessVolumeSystem);
        app.addSystemToSchedule(Schedule.PostUpdate, editorViewVolumeSystem(app));
        // After the volumes: it lights the scene with the sky they resolved.
        const sky = new SkyEnvironment();
        this.skies_.set(app, sky);
        app.addSystemToSchedule(Schedule.PostUpdate, skyEnvironmentSystem(app, sky));
    }

    cleanup(app?: App): void {
        resetWeatherSystem();
        if (app) {
            this.skies_.get(app)?.release(app.wasmModule);
            this.skies_.delete(app);
        }
        if (app?.hasResource(PostProcess)) {
            cleanupVolumeSystem(app.getResource(PostProcess));
        }
    }
}

export const postProcessPlugin = new PostProcessPlugin();
