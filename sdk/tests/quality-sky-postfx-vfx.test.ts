// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
vi.mock('../src/render/material', () => {
    let next = 100;
    return {
        Material: {
            createShader: vi.fn(() => ++next),
            compileShader: vi.fn(() => ++next),
            releaseShader: vi.fn(),
        },
    };
});

import { describe, it, expect, vi } from 'vitest';
import { Material } from '../src/render/material';
import { PostProcessAPI, initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess';
import { postProcessVolumeSystem } from '../src/postprocess/volumeSystem';
import { qualityPassAllowed, qualityPassUniforms } from '../src/postprocess/qualityFilter';
import { effectSourcesOf } from '../src/postprocess/effectSources';
import { defaultQualityProfile, resolveQualityProfile, type QualityProfile } from '../src/render/quality';
import { QUALITY_SETTINGS, qualityMaterialConstants, type QualityNumberSetting } from '../src/render/qualitySettings/index';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import { registerLightingEffectSources } from '../src/postprocess/sources/lighting';
import { registerAtmosphereEffectSources } from '../src/postprocess/sources/atmosphere';
import { MODEL } from '../src/render/builtinShaders';
import { ParticleAPI } from '../src/particle/ParticleAPI';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

registerBasicEffectSources();
registerLightingEffectSources();
registerAtmosphereEffectSources();

const LEVELS = ['low', 'medium', 'high'] as const;

const STEPS: Record<string, { levels: [number, number, number]; effect: string; uniform: string; passes: string[] }> = {
    fogVolumeSteps: { levels: [8, 16, 24], effect: 'heightFog', uniform: 'u_fogSteps', passes: ['fog_volume', 'fog_composite'] },
    fogCloudSamples: { levels: [2, 3, 4], effect: 'heightFog', uniform: 'u_fogCloudSamples', passes: ['fog_volume', 'fog_composite'] },
    cloudSteps: { levels: [12, 14, 16], effect: 'skyAtmosphere', uniform: 'u_cloudSteps', passes: ['sky_clouds', 'sky_composite'] },
    cloudUpperSteps: { levels: [3, 4, 6], effect: 'skyAtmosphere', uniform: 'u_cloud2Steps', passes: ['sky_clouds', 'sky_composite'] },
    cloudShadowSamples: { levels: [3, 4, 6], effect: 'skyAtmosphere', uniform: 'u_cloudShadowSamples', passes: ['sky_clouds', 'sky_composite'] },
    skyScatterSteps: { levels: [8, 12, 16], effect: 'skyAtmosphere', uniform: 'u_scatterSteps', passes: ['sky_clouds', 'sky_composite'] },
    skyLightDepthSteps: { levels: [3, 3, 4], effect: 'skyAtmosphere', uniform: 'u_lightDepthSteps', passes: ['sky_clouds', 'sky_composite'] },
    dofSamples: { levels: [16, 32, 64], effect: 'depthOfField', uniform: 'u_dofTaps', passes: ['dof_focus', 'dof_coc', 'dof_gather'] },
    lightShaftSamples: { levels: [16, 24, 40], effect: 'lightShafts', uniform: 'u_shaftSamples', passes: ['lightShafts'] },
    motionBlurSamples: { levels: [6, 10, 16], effect: 'motionBlur', uniform: 'u_motionTaps', passes: ['motionBlur'] },
    subsurfaceSamples: { levels: [3, 4, 6], effect: 'subsurface', uniform: 'u_sssTaps', passes: ['sss_x', 'sss_y'] },
};

const number = (key: string) => QUALITY_SETTINGS.find((s) => s.key === key) as QualityNumberSetting;

function compiled(make: () => unknown): string {
    const spy = Material.compileShader as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();
    make();
    return String(spy.mock.calls.at(-1)![0]);
}

describe('the step and sample counts of the sky, fog and the lens effects', () => {
    it('are the counts the shaders were written with at high, and fewer at medium and low', () => {
        for (const [key, s] of Object.entries(STEPS)) {
            expect(LEVELS.map((l) => defaultQualityProfile(l)[key as keyof QualityProfile]), key).toEqual(s.levels);
            expect(number(key).max, key).toBe(s.levels[2]);
            expect(number(key).uniform, key).toEqual({ effects: [s.effect], name: s.uniform });
        }
    });

    it('are held between one and the count the shader is compiled for', () => {
        for (const key of Object.keys(STEPS)) {
            expect(resolveQualityProfile('high', { [key]: 1000 } as never)[key as keyof QualityProfile], key).toBe(number(key).max);
            expect(resolveQualityProfile('low', { [key]: 0 } as never)[key as keyof QualityProfile], key).toBe(1);
            expect(resolveQualityProfile('low', { [key]: 2.6 } as never)[key as keyof QualityProfile], key).toBe(3);
        }
    });

    it('reach every pass of their effect by name, and only its passes', () => {
        const profile = defaultQualityProfile('low');
        for (const [key, s] of Object.entries(STEPS)) {
            for (const pass of s.passes) expect(qualityPassUniforms(profile, pass), `${key} ${pass}`).toContainEqual([s.uniform, s.levels[0]]);
        }
        expect(qualityPassUniforms(profile, 'bloom_up_0').map(([n]) => n)).not.toEqual(expect.arrayContaining(Object.values(STEPS).map((s) => s.uniform)));
    });

    it('are read by each shader through a loop compiled for the most steps that stops at the level\'s count, defaulting to the most', () => {
        const fx = effectSourcesOf<Record<string, (...a: unknown[]) => unknown>>();
        const shaders: [string, string, string[]][] = [
            ['createSkyClouds', 'skyAtmosphere', ['u_cloudSteps', 'u_cloud2Steps', 'u_scatterSteps', 'u_lightDepthSteps']],
            ['createSkyAtmosphere', 'skyAtmosphere', ['u_cloudSteps', 'u_cloudShadowSamples', 'u_scatterSteps', 'u_lightDepthSteps']],
            ['createSkyCloudsBake', 'skyAtmosphere', ['u_cloudSteps', 'u_scatterSteps']],
            ['createHeightFogVolume', 'heightFog', ['u_fogSteps', 'u_fogCloudSamples']],
            ['createHeightFog', 'heightFog', ['u_fogSteps']],
            ['createDofGather', 'depthOfField', ['u_dofTaps']],
            ['createLightShafts', 'lightShafts', ['u_shaftSamples']],
            ['createMotionBlur', 'motionBlur', ['u_motionTaps']],
        ];
        for (const [factory, , uniforms] of shaders) {
            const source = compiled(() => fx[factory]!());
            for (const uniform of uniforms) {
                const setting = QUALITY_SETTINGS.find((s) => s.type === 'number' && s.uniform?.name === uniform) as QualityNumberSetting;
                expect(source, `${factory} ${uniform}`).toContain(`#pragma param ${uniform} float default(${setting.defaults.high}) range(1,${setting.max})`);
                expect(source, `${factory} ${uniform}`).toMatch(new RegExp(`floor\\(${uniform}\\)`));
            }
            expect(source, factory).toMatch(/if \(float\(i\) >= \w+( \|\| trans < 0\.02)?\) break;/);
        }
        const sss = compiled(() => fx.createSubsurface!(0));
        expect(sss).toContain('#pragma param u_sssTaps float default(6) range(1,6)');
        expect(sss).toContain('for (int i = 1; i <= 6; ++i)');
    });
});

describe('the bloom pyramid', () => {
    const at = (bloomLevels: number) => resolveQualityProfile('high', { bloomLevels, skipEffects: [] } as never);
    const DOWN = ['bloom_down_1', 'bloom_down_2', 'bloom_down_3', 'bloom_down_4', 'bloom_down_5'];
    const UP = ['bloom_up_0', 'bloom_up_1', 'bloom_up_2', 'bloom_up_3', 'bloom_up_4'];

    it('is five levels at high, four at medium and three at low', () => {
        expect(LEVELS.map((l) => defaultQualityProfile(l).bloomLevels)).toEqual([3, 4, 5]);
    });

    it('loses its smallest levels first, down and up together, and keeps the prefilter and the composite', () => {
        for (let levels = 1; levels <= 5; levels++) {
            const profile = at(levels);
            expect(DOWN.map((p) => qualityPassAllowed(profile, p)), `${levels}`).toEqual(DOWN.map((_, i) => i < levels));
            expect(UP.map((p) => qualityPassAllowed(profile, p)), `${levels}`).toEqual(UP.map((_, i) => i < levels));
            expect(qualityPassAllowed(profile, 'bloom_prefilter')).toBe(true);
            expect(qualityPassAllowed(profile, 'bloom_composite')).toBe(true);
        }
        for (const pass of [...DOWN, ...UP]) expect(qualityPassAllowed(null, pass)).toBe(true);
    });

    it('sends the engine a chain whose first step up reads the last step down there is, and still counts as running', () => {
        const mock = {
            postprocess_init: vi.fn().mockReturnValue(true), postprocess_shutdown: vi.fn(), postprocess_resize: vi.fn(),
            postprocess_isInitialized: vi.fn().mockReturnValue(true), postprocess_clearPasses: vi.fn(),
            postprocess_addPass: vi.fn().mockReturnValue(0), postprocess_setPassScale: vi.fn(), postprocess_setPassContinuesEffect: vi.fn(),
            postprocess_setPassTexture: vi.fn(), postprocess_setUniformFloat: vi.fn(), postprocess_setUniformVec4: vi.fn(),
            postprocess_setBypass: vi.fn(), renderer_getPendingShaders: vi.fn(() => 0),
        };
        initPostProcessAPI(mock as unknown as ESEngineModule);
        try {
            const api = new PostProcessAPI();
            api.setQualityFilter(at(3));
            const camera = 7 as Entity;
            const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: [{ type: 'bloom', enabled: true, uniforms: {} }] }, { position: { x: 0, y: 0, z: 0 } }];
            const cam = [camera, { isActive: true, clearFlags: 3, projectionType: 0 }, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } }];
            (postProcessVolumeSystem as unknown as { _fn: (...a: unknown[]) => void })._fn(api, [volume], [cam]);
            api._applyForCamera(camera);
            api._resetAfterCamera();
            expect(mock.postprocess_addPass.mock.calls.map((c) => c[0])).toEqual([
                'bloom_prefilter', 'bloom_down_1', 'bloom_down_2', 'bloom_down_3', 'bloom_up_2', 'bloom_up_1', 'bloom_up_0', 'bloom_composite',
            ]);
            expect(api.effectAllowed('bloom')).toBe(true);
        } finally {
            shutdownPostProcessAPI();
        }
    });
});

describe('the refraction blur of a material', () => {
    it('is eight samples at high, six at medium and four at low, in the material constants\' first slot', () => {
        expect(LEVELS.map((l) => defaultQualityProfile(l).refractionSamples)).toEqual([4, 6, 8]);
        expect(LEVELS.map((l) => qualityMaterialConstants(defaultQualityProfile(l))[0])).toEqual([4, 6, 8]);
        expect(number('refractionSamples').max).toBe(8);
        expect(resolveQualityProfile('high', { refractionSamples: 50 } as never).refractionSamples).toBe(8);
    });

    it('gives each material slot to one setting at most', () => {
        const slots = QUALITY_SETTINGS.flatMap((s) => (s.type === 'number' && s.materialSlot !== undefined ? [s.materialSlot] : []));
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('is read by the Model shader from the engine\'s quality constants, all eight taps where nothing is set', () => {
        expect(MODEL).toContain('const int REFRACTION_TAPS_MAX = 8;');
        expect(MODEL).toContain('float taps = u_quality.x > 0.0 ? clamp(floor(u_quality.x), 1.0, float(REFRACTION_TAPS_MAX)) : float(REFRACTION_TAPS_MAX);');
        expect(MODEL).toContain('seen = behind / (taps + 1.0)');
    });
});

describe('the particle collision budget', () => {
    function engine() {
        const raw = { particle_collisionSetBudget: vi.fn(), particle_update: vi.fn(), particle_collisionQueryCount: () => 0 };
        return { raw, api: new ParticleAPI(raw as unknown as EngineApi, {} as CppRegistry) };
    }

    it('is 4096 queries and 1024 events at high, half at medium and a quarter of the queries at low', () => {
        expect(LEVELS.map((l) => defaultQualityProfile(l).particleCollisionQueries)).toEqual([1024, 2048, 4096]);
        expect(LEVELS.map((l) => defaultQualityProfile(l).particleCollisionEvents)).toEqual([256, 512, 1024]);
    });

    it('runs at the level\'s caps, at the old ones with no level, and at what the game set whatever the level', () => {
        const { raw, api } = engine();
        api.update(0.1);
        expect(raw.particle_collisionSetBudget).toHaveBeenLastCalledWith(4096, 1024, false);
        api.setLevelCollisionBudget({ queries: 1024, events: 256 });
        api.update(0.1);
        expect(raw.particle_collisionSetBudget).toHaveBeenLastCalledWith(1024, 256, false);
        api.setCollisionBudget({ events: 2000 });
        api.update(0.1);
        expect(raw.particle_collisionSetBudget).toHaveBeenLastCalledWith(1024, 2000, false);
        expect(api.collisionBudget).toEqual({ queries: 1024, events: 2000 });
        api.setLevelCollisionBudget({ queries: 999999, events: 1 });
        expect(api.collisionBudget).toEqual({ queries: 65536, events: 2000 });
        api.setLevelCollisionBudget(null);
        expect(api.collisionBudget).toEqual({ queries: 4096, events: 2000 });
    });
});

describe('the GPU particles\' depth grid', () => {
    it('is 640 texels across at high, 480 at medium and 320 at low, held between 64 and 640', () => {
        expect(LEVELS.map((l) => defaultQualityProfile(l).particleDepthGrid)).toEqual([320, 480, 640]);
        expect(resolveQualityProfile('high', { particleDepthGrid: 4096 } as never).particleDepthGrid).toBe(640);
        expect(resolveQualityProfile('high', { particleDepthGrid: 1 } as never).particleDepthGrid).toBe(64);
    });
});
