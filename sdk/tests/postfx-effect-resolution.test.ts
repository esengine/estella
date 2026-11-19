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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostProcessAPI, initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess';
import { postProcessVolumeSystem } from '../src/postprocess/volumeSystem';
import { qualityPassScale, qualityPassUniforms } from '../src/postprocess/qualityFilter';
import { effectOfPass, getAllEffectDefs, registerEffect } from '../src/postprocess/effects';
import { QualityController, defaultQualityProfile, parseQualityConfig, resolveQualityProfile, type QualityProfile } from '../src/render/quality';
import { QUALITY_SETTINGS, qualityEffectUniforms, type QualitySetting } from '../src/render/qualitySettings/index';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import { registerLightingEffectSources } from '../src/postprocess/sources/lighting';
import { registerAtmosphereEffectSources } from '../src/postprocess/sources/atmosphere';
import type { ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

registerBasicEffectSources();
registerLightingEffectSources();
registerAtmosphereEffectSources();

const CAMERA = 7 as Entity;

function core() {
    return {
        postprocess_init: vi.fn().mockReturnValue(true),
        postprocess_shutdown: vi.fn(),
        postprocess_resize: vi.fn(),
        postprocess_isInitialized: vi.fn().mockReturnValue(true),
        postprocess_clearPasses: vi.fn(),
        postprocess_addPass: vi.fn().mockReturnValue(0),
        postprocess_setPassScale: vi.fn(),
        postprocess_setPassContinuesEffect: vi.fn(),
        postprocess_setPassTexture: vi.fn(),
        postprocess_setUniformFloat: vi.fn(),
        postprocess_setUniformVec4: vi.fn(),
        postprocess_setBypass: vi.fn(),
        renderer_getPendingShaders: vi.fn(() => 0),
    };
}

function frame(api: PostProcessAPI, types: string[]): void {
    const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: types.map((type) => ({ type, enabled: true, uniforms: {} })) },
        { position: { x: 0, y: 0, z: 0 } }];
    const camera = [CAMERA, { isActive: true, clearFlags: 3, projectionType: 0 }, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } }];
    (postProcessVolumeSystem as unknown as { _fn: (...a: unknown[]) => void })._fn(api, [volume], [camera]);
    api._applyForCamera(CAMERA);
    api._resetAfterCamera();
}

const subPasses = () => getAllEffectDefs().flatMap((def) => [...(def.multiPass ?? []), ...(def.fallback ?? [])]);

const RESOLUTIONS = {
    aoResolution: ['ssao', 'gtao'],
    ssgiResolution: ['ssgi'],
    voxelGIResolution: ['voxelGI'],
    fogResolution: ['heightFog'],
    lensFlareResolution: ['lensFlare'],
} as const;
type ResolutionKey = keyof typeof RESOLUTIONS;
const KEYS = Object.keys(RESOLUTIONS) as ResolutionKey[];

const keyOf = (effect: string): ResolutionKey | undefined => KEYS.find((key) => (RESOLUTIONS[key] as readonly string[]).includes(effect));
const at = (values: Partial<Record<ResolutionKey, number>>): QualityProfile => resolveQualityProfile('high', { ...values, skipEffects: [] });
const every = (value: number): Partial<Record<ResolutionKey, number>> => Object.fromEntries(KEYS.map((key) => [key, value]));

describe('the resolution of each effect that is drawn small', () => {
    it('is a setting of its own for each effect, declared once in the table and nowhere for clouds or bloom', () => {
        for (const key of KEYS) {
            const setting = QUALITY_SETTINGS.find((s) => s.key === key) as QualitySetting & { scalesEffects?: readonly string[] };
            expect(setting, key).toBeDefined();
            expect(setting.scalesEffects, key).toEqual(RESOLUTIONS[key]);
        }
        const scaled = QUALITY_SETTINGS.flatMap((s) => ('scalesEffects' in s ? [...s.scalesEffects] : []));
        expect(scaled).not.toContain('bloom');
        expect(scaled).not.toContain('skyAtmosphere');
        expect(QUALITY_SETTINGS.find((s) => s.key === ('effectResolution' as never))).toBeUndefined();
    });

    it('is a quarter, a half and all of the authored size at low, medium and high', () => {
        for (const key of KEYS) {
            expect((['low', 'medium', 'high'] as const).map((l) => defaultQualityProfile(l)[key]), key).toEqual([0.25, 0.5, 1]);
        }
    });

    it('takes a project override, held between an eighth and one, and ignores what is not a number', () => {
        for (const key of KEYS) {
            expect(resolveQualityProfile('high', { [key]: 0.5 })[key], key).toBe(0.5);
            expect(resolveQualityProfile('high', { [key]: 0.01 })[key], key).toBe(0.125);
            expect(resolveQualityProfile('low', { [key]: 4 })[key], key).toBe(1);
            expect(resolveQualityProfile('medium', { [key]: 'half' as unknown as number })[key], key).toBe(0.5);
        }
        const config = parseQualityConfig({ mode: 'low', profiles: { low: { fogResolution: 0.5 } } });
        const profile = new QualityController(config).profile;
        expect(profile.fogResolution).toBe(0.5);
        expect(profile.aoResolution).toBe(0.25);
    });

    it('is a player preference over the level, kept through a change of level and dropped with null', () => {
        const q = new QualityController({ mode: 'high', profiles: { low: { aoResolution: 0.5 } } });
        q.setPreferences({ aoResolution: 0.25, lensFlareResolution: 0.125 });
        expect(q.profile.aoResolution).toBe(0.25);
        expect(q.profile.lensFlareResolution).toBe(0.125);
        expect(q.profile.ssgiResolution).toBe(1);
        q.setMode('low');
        expect(q.profile.aoResolution).toBe(0.25);
        q.setPreferences(null);
        expect(q.profile.aoResolution).toBe(0.5);
        expect(q.profile.lensFlareResolution).toBe(0.25);
    });
});

describe('the size a pass is drawn at', () => {
    it('multiplies a pass that can be drawn smaller by its own effect\'s setting, down to its floor and never past its authored size', () => {
        const reducible = subPasses().filter((p) => p.minScale !== undefined);
        expect(reducible.map((p) => p.name)).toEqual(expect.arrayContaining(['ssao_ao', 'gtao_ao', 'fog_volume', 'ssgi_gather', 'lensflare_flare', 'gi_gather']));
        for (const pass of reducible) {
            const scale = pass.scale ?? 1;
            const key = keyOf(effectOfPass(pass.name)!);
            expect(key, pass.name).toBeDefined();
            expect(pass.minScale!, pass.name).toBeLessThanOrEqual(scale);
            for (const value of [0.125, 0.25, 0.5, 1]) {
                const s = qualityPassScale(at({ [key!]: value }), { name: pass.name, scale, minScale: pass.minScale });
                expect(s, `${pass.name} ${value}`).toBe(Math.max(pass.minScale!, scale * value));
            }
            const others = Object.fromEntries(KEYS.filter((k) => k !== key).map((k) => [k, 0.125]));
            expect(qualityPassScale(at({ ...others, [key!]: 1 }), { name: pass.name, scale, minScale: pass.minScale }), `${pass.name} with the others down`).toBe(scale);
        }
    });

    it('has the floors measured for #232: a quarter of the screen for ambient occlusion and the voxel gather, an eighth for fog, SSGI and lens flare', () => {
        const floor = (name: string) => subPasses().find((p) => p.name === name)!.minScale;
        expect([floor('ssao_ao'), floor('gtao_ao'), floor('gi_gather')]).toEqual([0.25, 0.25, 0.25]);
        expect([floor('fog_volume'), floor('ssgi_gather'), floor('lensflare_flare')]).toEqual([0.125, 0.125, 0.125]);
    });

    it('leaves every pass without a floor at its own size, whatever the level, and every pass alone without a level', () => {
        const fixed = subPasses().filter((p) => p.minScale === undefined);
        expect(fixed.map((p) => p.name)).toEqual(expect.arrayContaining(['ssao_composite', 'bloom_prefilter', 'bloom_up_0', 'bloom_down_1', 'sky_clouds', 'ae_measure', 'fog_composite']));
        const smallest = at(every(0.125));
        for (const pass of fixed) expect(qualityPassScale(smallest, { name: pass.name, scale: pass.scale ?? 1 }), pass.name).toBe(pass.scale ?? 1);
        for (const pass of subPasses()) expect(qualityPassScale(null, { name: pass.name, scale: pass.scale ?? 1, minScale: pass.minScale })).toBe(pass.scale ?? 1);
    });
});

describe('a level value sent to an effect as a uniform', () => {
    it('is sent by name to every pass of the effects a setting names, and to no other', () => {
        registerEffect({
            type: 'testMarch',
            label: 'Test march',
            multiPass: [{ name: 'testmarch_a', factory: () => 1 as never }, { name: 'testmarch_b', factory: () => 1 as never }],
            uniforms: [],
        });
        const setting = {
            key: 'testMarchSteps', type: 'number', defaults: { low: 8, medium: 16, high: 32 }, min: 1, max: 32, step: 1, integer: true,
            group: 'postProcessing', preference: false, label: { en: '', zh: '' }, description: { en: '', zh: '' },
            uniform: { effects: ['testMarch'], name: 'u_levelSteps' },
        };
        const values = { testMarchSteps: 12 };
        expect(qualityEffectUniforms(values, 'testMarch')).toEqual([]);
        (QUALITY_SETTINGS as unknown as object[]).push(setting);
        try {
            expect(qualityEffectUniforms(values, 'testMarch')).toEqual([['u_levelSteps', 12]]);
            const profile = resolveQualityProfile('high', { testMarchSteps: 40.4 } as never);
            expect(qualityPassUniforms(profile, 'testmarch_b')).toEqual([['u_levelSteps', 32]]);
            expect(qualityPassUniforms(profile, 'testmarch_a')).toEqual([['u_levelSteps', 32]]);
            expect(qualityPassUniforms(profile, 'ssao_ao').some(([name]) => name === 'u_levelSteps')).toBe(false);
            expect(qualityPassUniforms(null, 'testmarch_a')).toEqual([]);
        } finally {
            (QUALITY_SETTINGS as unknown as object[]).pop();
        }
    });
});

describe('what the engine is told', () => {
    let mock: ReturnType<typeof core>;
    let api: PostProcessAPI;

    beforeEach(() => {
        mock = core();
        initPostProcessAPI(mock as unknown as ESEngineModule);
        api = new PostProcessAPI();
    });

    afterEach(() => shutdownPostProcessAPI());

    const scales = (): Record<string, number> => Object.fromEntries(mock.postprocess_setPassScale.mock.calls.map((c) => [c[0], c[1]]));

    it('draws each effect at its own setting and the full-screen passes at full size', () => {
        api.setQualityFilter(at({ aoResolution: 0.5, fogResolution: 0.25, lensFlareResolution: 1 }));
        frame(api, ['ssao', 'heightFog', 'lensFlare', 'bloom', 'fxaa']);
        const s = scales();
        expect(s.ssao_ao).toBe(0.25);
        expect(s.ssao_blur_y).toBe(0.25);
        expect(s.fog_volume).toBe(0.125);
        expect(s.lensflare_flare).toBe(0.5);
        expect(s.bloom_prefilter).toBe(0.5);
        expect(s.bloom_down_1).toBe(0.25);
        expect(s.bloom_down_5).toBe(0.015625);
        expect(s.ssao_composite).toBeUndefined();
        expect(s.fog_composite).toBeUndefined();
        expect(s.fxaa).toBeUndefined();
    });

    it('tells the engine the new size on the next frame once the level changes, with the stack itself unchanged', () => {
        api.setQualityFilter(at({}));
        frame(api, ['ssao']);
        expect(scales().ssao_ao).toBe(0.5);
        mock.postprocess_setPassScale.mockClear();
        api.setQualityFilter(at({ aoResolution: 0.25 }));
        frame(api, ['ssao']);
        expect(scales().ssao_ao).toBe(Math.max(0.5 * 0.25, subPasses().find((p) => p.name === 'ssao_ao')!.minScale!));
        mock.postprocess_setPassScale.mockClear();
        api.setQualityFilter(null);
        frame(api, ['ssao']);
        expect(scales().ssao_ao).toBe(0.5);
    });

    it('sends a level value to the effect\'s passes with its uniforms, and says it again when the level changes', () => {
        const setting = {
            key: 'testAoSteps', type: 'number', defaults: { low: 4, medium: 8, high: 16 }, min: 1, max: 16, step: 1, integer: true,
            group: 'globalIllumination', preference: false, label: { en: '', zh: '' }, description: { en: '', zh: '' },
            uniform: { effects: ['ssao'], name: 'u_levelSteps' },
        };
        (QUALITY_SETTINGS as unknown as object[]).push(setting);
        try {
            const sent = () => mock.postprocess_setUniformFloat.mock.calls.filter((c) => c[1] === 'u_levelSteps').map((c) => [c[0], c[2]]);
            api.setQualityFilter(resolveQualityProfile('high', { testAoSteps: 6, skipEffects: [] } as never));
            frame(api, ['ssao', 'bloom']);
            expect(sent()).toEqual(expect.arrayContaining([['ssao_ao', 6], ['ssao_composite', 6]]));
            expect(sent().some(([pass]) => String(pass).startsWith('bloom'))).toBe(false);
            mock.postprocess_setUniformFloat.mockClear();
            api.setQualityFilter(resolveQualityProfile('high', { testAoSteps: 12, skipEffects: [] } as never));
            frame(api, ['ssao', 'bloom']);
            expect(sent()).toEqual(expect.arrayContaining([['ssao_ao', 12]]));
        } finally {
            (QUALITY_SETTINGS as unknown as object[]).pop();
        }
    });
});
