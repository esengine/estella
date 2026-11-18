// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
const sources = vi.hoisted(() => [] as string[]);
vi.mock('../src/render/material', () => {
    let next = 100;
    return {
        Material: {
            createShader: vi.fn(() => ++next),
            compileShader: vi.fn((source: string) => { sources.push(source); return ++next; }),
            releaseShader: vi.fn(),
        },
    };
});
vi.mock('../src/runtime/runtimeAssets', () => ({ createTextureFromPixels: vi.fn(() => 9) }));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostProcessAPI, initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess';
import { postProcessVolumeSystem } from '../src/postprocess/volumeSystem';
import { qualityPassUniforms } from '../src/postprocess/qualityFilter';
import { lightingEffects, registerLightingEffectSources } from '../src/postprocess/sources/lighting';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import { gtaoPasses } from '../src/postprocess/gtao';
import { voxelGIFallback } from '../src/postprocess/voxelGIFallback';
import { FULL_SKY_BAKE, SKY_CLOUD_STEPS, SKY_FACE_SIZE, SkyEnvironment, skyPanorama, type SkyEnvironmentInput } from '../src/postprocess/skyEnvironment';
import { PROBE_CAPTURE_FACE, FULL_PROBE_CAPTURE } from '../src/postprocess/probeCapture';
import { getEffectDef } from '../src/postprocess/effects';
import { defaultQualityProfile, resolveQualityProfile } from '../src/render/quality';
import { QUALITY_SETTINGS, parseQualitySetting, qualitySetting, type QualityNumberSetting, type QualitySetting } from '../src/render/qualitySettings/index';
import type { ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

registerBasicEffectSources();
registerLightingEffectSources();

const shaderOf = (make: () => unknown): string => {
    sources.length = 0;
    make();
    return sources.join('\n');
};

const LOOPS: Array<{ key: string; make: () => unknown; max: string; uniform: string }> = [
    { key: 'ssrSteps', make: () => lightingEffects.createSsr(), max: 'SSR_STEPS_MAX', uniform: 'u_ssrSteps' },
    { key: 'ssrRefine', make: () => lightingEffects.createSsr(), max: 'SSR_REFINE_MAX', uniform: 'u_ssrRefine' },
    { key: 'ssgiRays', make: () => lightingEffects.createSsgiGather(), max: 'SSGI_RAYS_MAX', uniform: 'u_ssgiRays' },
    { key: 'ssgiSteps', make: () => lightingEffects.createSsgiGather(), max: 'SSGI_STEPS_MAX', uniform: 'u_ssgiSteps' },
    { key: 'ssaoSamples', make: () => lightingEffects.createSsaoAo(), max: 'SSAO_SAMPLES_MAX', uniform: 'u_aoSamples' },
    { key: 'aoBlurRadius', make: () => lightingEffects.createSsaoBlur(0), max: 'AO_BLUR_RADIUS_MAX', uniform: 'u_aoBlurRadius' },
    { key: 'gtaoSlices', make: () => gtaoPasses.createGtaoAo(), max: 'GTAO_SLICES_MAX', uniform: 'u_gtaoSlices' },
    { key: 'gtaoSteps', make: () => gtaoPasses.createGtaoAo(), max: 'GTAO_STEPS_MAX', uniform: 'u_gtaoSteps' },
    { key: 'voxelGIBounceRays', make: () => voxelGIFallback.createVoxels(), max: 'VOXEL_BOUNCE_RAYS_MAX', uniform: 'u_bounceRays' },
];

const setting = (key: string) => qualitySetting(key) as QualitySetting;
const number = (key: string) => qualitySetting(key) as QualityNumberSetting;

describe('the loop counts a level sets in the GI and reflection shaders', () => {
    it('stop at the shader\'s compile-time bound, which is the setting\'s most, and default to it where no level is sent', () => {
        for (const loop of LOOPS) {
            const src = shaderOf(loop.make);
            const bound = Number(new RegExp(`#define ${loop.max} (\\d+)`).exec(src)?.[1]);
            const fallback = Number(new RegExp(`#pragma param ${loop.uniform} float default\\(([\\d.]+)\\)`).exec(src)?.[1]);
            expect(bound, loop.key).toBe(number(loop.key).max);
            expect(fallback, loop.key).toBe(number(loop.key).defaults.high);
            expect(number(loop.key).uniform?.name, loop.key).toBe(loop.uniform);
            expect(src, loop.key).toMatch(new RegExp(`for \\(int \\w+ = [^;]+; \\w+ <=? ${loop.max};`));
        }
    });

    it('keeps the high level what was written into the shaders and engine before', () => {
        const high = defaultQualityProfile('high') as unknown as Record<string, unknown>;
        expect([high.ssrSteps, high.ssrRefine, high.ssaoSamples, high.gtaoSlices, high.gtaoSteps]).toEqual([48, 6, 12, 3, 6]);
        expect([high.ssgiRays, high.ssgiSteps, high.ssgiDenoiseKernel, high.aoBlurRadius, high.voxelGIBounceRays]).toEqual([8, 6, 5, 3, 2]);
        expect([high.dynamicGIProbeRows, high.dynamicGIFieldSize, high.dynamicGIFieldBuildMs, high.voxelGIGridSize, high.voxelGISunSamples]).toEqual([90, 128, 3, 128, 256]);
        expect([high.skyEnvironmentInterval, high.skyEnvironmentCloudSteps, high.environmentMapSize, high.probeCaptureSize]).toEqual([1, 16, 32, 32]);
        expect(FULL_SKY_BAKE).toEqual({ interval: 1, faceSize: SKY_FACE_SIZE, cloudSteps: SKY_CLOUD_STEPS });
        expect(FULL_PROBE_CAPTURE).toEqual({ captureFace: PROBE_CAPTURE_FACE, reflectionFace: SKY_FACE_SIZE });
    });

    it('holds a project\'s value inside the bounds the shaders and engine can take', () => {
        expect(parseQualitySetting(setting('ssrSteps'), 400, 48)).toBe(48);
        expect(parseQualitySetting(setting('ssrSteps'), 0, 48)).toBe(4);
        expect(parseQualitySetting(setting('ssaoSamples'), 7.6, 12)).toBe(8);
        expect(parseQualitySetting(setting('voxelGIGridSize'), 96, 128)).toBe(128);
        expect(parseQualitySetting(setting('dynamicGIFieldSize'), 96, 128)).toBe(128);
        expect(parseQualitySetting(setting('ssgiDenoiseKernel'), 4, 5)).toBe(5);
        expect(parseQualitySetting(setting('dynamicGIProbeRows'), 500, 90)).toBe(90);
        for (const key of ['voxelGIGridSize', 'dynamicGIFieldSize']) {
            const s = setting(key);
            if (s.type !== 'choice') throw new Error(key);
            for (const size of s.options) expect(size & (size - 1), `${key} ${size}`).toBe(0);
        }
    });

    it('is named by every effect it acts on, each of which exists', () => {
        for (const s of QUALITY_SETTINGS) {
            if (s.group !== 'globalIllumination' && s.group !== 'reflections') continue;
            const uniform = (s as { uniform?: { effects: readonly string[] } }).uniform;
            for (const effect of uniform?.effects ?? []) expect(getEffectDef(effect), `${s.key} ${effect}`).toBeDefined();
        }
    });
});

describe('a level\'s GI and reflection counts reach the passes', () => {
    const CAMERA = 7 as Entity;
    const profile = (level: 'low' | 'medium' | 'high', over: Record<string, unknown> = {}) =>
        resolveQualityProfile(level, { skipEffects: [], ...over } as never);

    it('names every pass of an effect, the WebGL2 fallback and the engine\'s own pass alike', () => {
        const low = profile('low');
        const get = (pass: string) => Object.fromEntries(qualityPassUniforms(low, pass));
        expect(get('ssr')).toMatchObject({ u_ssrSteps: 16, u_ssrRefine: 4 });
        expect(get('ssao_ao')).toMatchObject({ u_aoSamples: 6, u_aoBlurRadius: 2 });
        expect(get('gtao_blur_y')).toMatchObject({ u_gtaoSlices: 1, u_gtaoSteps: 4, u_aoBlurRadius: 2 });
        expect(get('ssgi_gather')).toMatchObject({ u_ssgiRays: 4, u_ssgiSteps: 4, u_ssgiKernel: 3 });
        expect(get('gi_voxels')).toMatchObject({ u_bounceRays: 1, u_gridSize: 64, u_sunSamples: 64 });
        expect(get('voxelGI')).toMatchObject({ u_gridSize: 64, u_sunSamples: 64 });
        expect(get('dynamicGI')).toMatchObject({ u_probeRows: 30 });
        expect(get('ssao_ao').u_ssrSteps).toBeUndefined();
        expect(qualityPassUniforms(null, 'ssr')).toEqual([]);
    });

    function core() {
        return {
            postprocess_init: vi.fn().mockReturnValue(true),
            postprocess_shutdown: vi.fn(),
            postprocess_resize: vi.fn(),
            postprocess_isInitialized: vi.fn().mockReturnValue(true),
            postprocess_clearPasses: vi.fn(),
            postprocess_addPass: vi.fn().mockReturnValue(0),
            postprocess_addNativePass: vi.fn(),
            postprocess_setPassScale: vi.fn(),
            postprocess_setPassContinuesEffect: vi.fn(),
            postprocess_setPassTexture: vi.fn(),
            postprocess_setUniformFloat: vi.fn(),
            postprocess_setUniformVec4: vi.fn(),
            postprocess_setBypass: vi.fn(),
            renderer_getPendingShaders: vi.fn(() => 0),
        };
    }
    let mock: ReturnType<typeof core>;
    let api: PostProcessAPI;
    beforeEach(() => { mock = core(); initPostProcessAPI(mock as unknown as ESEngineModule); api = new PostProcessAPI(); api.fusePasses = false; });
    afterEach(() => shutdownPostProcessAPI());

    const frame = (types: string[]): Record<string, Record<string, number>> => {
        mock.postprocess_setUniformFloat.mockClear();
        const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: types.map((type) => ({ type, enabled: true, uniforms: {} })) }, { position: { x: 0, y: 0, z: 0 } }];
        const camera = [CAMERA, { isActive: true, clearFlags: 3, projectionType: 0 }, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } }];
        (postProcessVolumeSystem as unknown as { _fn: (...a: unknown[]) => void })._fn(api, [volume], [camera]);
        api._applyForCamera(CAMERA);
        api._resetAfterCamera();
        const out: Record<string, Record<string, number>> = {};
        for (const [pass, name, value] of mock.postprocess_setUniformFloat.mock.calls) (out[pass] ??= {})[name] = value;
        return out;
    };

    it('tells the engine each level\'s count, changes it with the level and sends none without one', () => {
        api.setQualityFilter(profile('medium'));
        let sent = frame(['ssr', 'ssao', 'dynamicGI']);
        expect(sent.ssr).toMatchObject({ u_ssrSteps: 32, u_ssrRefine: 5 });
        expect(sent.ssao_ao).toMatchObject({ u_aoSamples: 8 });
        expect(sent.dynamicGI).toMatchObject({ u_probeRows: 45 });
        api.setQualityFilter(profile('medium', { ssrSteps: 20, dynamicGIProbeRows: 200 }));
        sent = frame(['ssr', 'ssao', 'dynamicGI']);
        expect(sent.ssr?.u_ssrSteps).toBe(20);
        expect(sent.dynamicGI?.u_probeRows).toBe(90);
        api.setQualityFilter(null);
        sent = frame(['ssr', 'ssao', 'dynamicGI']);
        expect(sent.ssr?.u_ssrSteps).toBeUndefined();
        expect(sent.dynamicGI?.u_probeRows).toBeUndefined();
    });

    it('answers a CPU consumer the level in force, and the high level without one', () => {
        expect(api.levelValues.dynamicGIFieldSize).toBe(128);
        api.setQualityFilter(profile('low'));
        expect(api.levelValues.dynamicGIFieldSize).toBe(64);
        expect(api.levelValues.environmentMapSize).toBe(16);
    });
});

describe('the sky bake at a level', () => {
    const input = (clouds: number): SkyEnvironmentInput => {
        const values: Record<string, number> = {
            u_intensity: 1, u_haze: 1, u_overcast: 0, u_altitude: 0, u_groundAlbedo: 0.3, u_clouds: clouds, u_cloudBase: 2, u_cloudThickness: 1,
            u_cloudBrightness: 1, u_cloudScale: 1, u_cloudSoftness: 0.3, u_cloudSilver: 0.5, u_cloud2Coverage: 0, u_cloudEvolve: 0,
        };
        return { sun: [0, 0.6, 0.8], params: (n) => values[n] ?? 0, linear: true };
    };

    it('marches the clouds in as many steps as the level gives, and the same sky without clouds whatever it gives', () => {
        const full = skyPanorama(input(0.6));
        const fewer = skyPanorama({ ...input(0.6), cloudSteps: 4 });
        expect(fewer.rgb).not.toEqual(full.rgb);
        expect(skyPanorama({ ...input(0.6), cloudSteps: SKY_CLOUD_STEPS }).rgb).toEqual(full.rgb);
        expect(skyPanorama({ ...input(0), cloudSteps: 4 }).rgb).toEqual(skyPanorama(input(0)).rgb);
    });

    it('bakes at the level\'s size and waits the level\'s interval while the sky keeps changing', () => {
        const heap = new ArrayBuffer(1 << 20);
        let next = 1024;
        const c = {
            HEAPU8: new Uint8Array(heap), HEAPF32: new Float32Array(heap),
            _malloc: (n: number) => { const p = next; next += (n + 15) & ~15; return p; }, _free: () => undefined,
            environment_create: vi.fn(() => 5), environment_release: vi.fn(), renderer_setSkyEnvironment: vi.fn(),
        };
        let level = { interval: 4, faceSize: 16, cloudSteps: 8 };
        const sky = new SkyEnvironment(() => level);
        const sun = (t: number): SkyEnvironmentInput => ({ ...input(0.3), sun: [Math.sin(t), 0.6, Math.cos(t)] });
        for (let t = 0; t <= 7.5; t += 0.5) sky.update(c as unknown as ESEngineModule, sun(t), t);
        expect(c.environment_create).toHaveBeenCalledTimes(2);
        expect(c.environment_create.mock.calls.every((call) => (call as unknown[])[2] === 16)).toBe(true);
        expect(sky.panorama?.width).toBe(32);
        level = { interval: 1, faceSize: 32, cloudSteps: 16 };
        c.environment_create.mockClear();
        for (let t = 8; t <= 11.5; t += 0.5) sky.update(c as unknown as ESEngineModule, sun(t), t);
        expect(c.environment_create).toHaveBeenCalledTimes(4);
        expect((c.environment_create.mock.calls[0] as unknown[])[2]).toBe(32);
        expect(sky.panorama?.width).toBe(64);
    });
});
