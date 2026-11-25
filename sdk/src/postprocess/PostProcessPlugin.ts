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
import { noteCloudBakeFrame } from './cloudBake';
import { noteSkyStillFrame, stillSkyKey } from './skyStill';
import { probeCaptureSystem } from './probeCapture';
import { dynamicGISystem } from '../gi/dynamicGISystem';
import { rainDropsSystem } from './rainDrops';

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

function sunsOf(lights: Iterable<[Entity, LightData, TransformData]>): string {
    let key = '';
    for (const [, light, transform] of lights) {
        if (!light.enabled || light.type !== LightType.Directional) continue;
        const q = transform.worldRotation;
        key += `${q.x},${q.y},${q.z},${q.w},${light.color.r},${light.color.g},${light.color.b},${light.intensity},${light.followEnvironmentSun};`;
    }
    return key;
}

/** The Sky Atmosphere as the scene's environment, after the volumes have resolved it for the view being drawn. */
function skyEnvironmentSystem(app: App, sky: SkyEnvironment) {
    return defineSystem(
        [Query(Light, Transform)],
        (lights: Iterable<[Entity, LightData, TransformData]>) => {
            noteCloudBakeFrame(sunFromLights(lights));
            noteSkyStillFrame();
            if (!app.hasResource(PostProcess)) return;
            const view = app.hasResource(EditorView) ? app.getResource(EditorView) : null;
            const lighting = resolvedLightingSky(app.getResource(PostProcess), !!view?.active);
            if (!lighting) { sky.update(app.wasmModule, null, 0); return; }
            if (lighting.type !== 'skyAtmosphere') {
                sky.updateCaptured(app.wasmModule, lighting.type, performance.now() / 1000, stillSkyKey(lighting.type, lighting.effect, sunsOf(lights)));
                return;
            }
            const effect = lighting.effect;
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

    private readonly releaseGI_ = new WeakMap<App, () => void>();

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
            { srgb: false, filterMode: 'linear', wrapMode: pixels.wrap === 'repeat' ? 'repeat' : 'clamp' }));
        // The weather first: the volumes read what it has decided.
        app.addSystemToSchedule(Schedule.PostUpdate, weatherSystem);
        app.addSystemToSchedule(Schedule.PostUpdate, postProcessVolumeSystem);
        app.addSystemToSchedule(Schedule.PostUpdate, editorViewVolumeSystem(app));
        // After the volumes: the 3D rain's drops fall in the world, as the rain they resolved says.
        app.addSystemToSchedule(Schedule.PostUpdate, rainDropsSystem(app));
        // After the volumes: it lights the scene with the sky they resolved.
        const sky = new SkyEnvironment(() => ({
            interval: api.levelValues.skyEnvironmentInterval,
            faceSize: api.levelValues.environmentMapSize,
            cloudSteps: api.levelValues.skyEnvironmentCloudSteps,
        }));
        this.skies_.set(app, sky);
        app.addSystemToSchedule(Schedule.PostUpdate, skyEnvironmentSystem(app, sky));
        app.addSystemToSchedule(Schedule.PostUpdate, probeCaptureSystem(() => app.wasmModule, () => sky.panorama, () => ({
            captureFace: api.levelValues.probeCaptureSize,
            reflectionFace: api.levelValues.environmentMapSize,
        })));
        const gi = dynamicGISystem(app);
        this.releaseGI_.set(app, gi.dispose);
        app.addSystemToSchedule(Schedule.PostUpdate, gi.system);
    }

    cleanup(app?: App): void {
        resetWeatherSystem();
        if (app) {
            this.releaseGI_.get(app)?.();
            this.releaseGI_.delete(app);
            this.skies_.get(app)?.release(app.wasmModule);
            this.skies_.delete(app);
        }
        if (app?.hasResource(PostProcess)) {
            cleanupVolumeSystem(app.getResource(PostProcess));
        }
    }
}

export const postProcessPlugin = new PostProcessPlugin();
