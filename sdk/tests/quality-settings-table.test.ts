// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { QualityController, defaultQualityProfile, parseQualityConfig, resolveQualityProfile, type QualityLevel } from '../src/render/quality';
import {
    QUALITY_SETTINGS, QUALITY_SETTING_GROUPS, parseQualitySetting, qualityEffectUniforms, qualityEngineValues, qualityMaterialConstants, qualitySettingRequirementsMet,
    type QualitySetting,
} from '../src/render/qualitySettings/index';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { qualityPassAllowed } from '../src/postprocess/qualityFilter';
import { effectPassNames, effectQualityGroup, getAllEffectDefs } from '../src/postprocess/effects';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import { registerLightingEffectSources } from '../src/postprocess/sources/lighting';

registerBasicEffectSources();
registerLightingEffectSources();

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const settings = QUALITY_SETTINGS as readonly QualitySetting[];

const OLD_LOW = {
    renderScale: 0.6, minRenderScale: 0.4, msaaSamples: 8, antialiasing: 'temporal',
    shadowAtlasSize: 2048, shadowCellSize: 512, shadowCascades: 3, shadowDistance: 120,
    detailScale: 0.3, particleLimit: 777,
    planarReflectionScale: 0.375, planarReflectionMaxSize: 640, planarReflectionUpdatesPerSecond: 15,
    depthPrepass: true, stillSky: false, postProcess: false, ssao: false,
    waterWaves: 6, waterRippleCells: 48, waterDisplacement: true, waterMirror: true, waterCaustics: true,
    skipEffects: ['bloom'], shelterMaskSize: 300, shadowSoftSamples: 5, lighting: 'full', dynamicGIReduced: false,
    drawCallBudget: 999, textureStreaming: false, textureStreamingBudget: 64,
};

describe('the table of per-level settings', () => {
    it('has one entry a key, each in one of the twelve groups, and every group holds at least one', () => {
        const keys = settings.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(QUALITY_SETTING_GROUPS.map((g) => g.id)).toEqual([
            'resolution', 'viewDistance', 'lights', 'shadows', 'globalIllumination', 'reflections',
            'sky', 'postProcessing', 'effects', 'terrain', 'water', 'textures',
        ]);
        for (const group of QUALITY_SETTING_GROUPS) {
            expect(settings.some((s) => s.group === group.id), group.id).toBe(true);
            expect(group.label.en && group.label.zh, group.id).toBeTruthy();
        }
    });

    it('declares defaults its own parser keeps, at every level', () => {
        for (const s of settings) {
            for (const level of LEVELS) {
                expect(parseQualitySetting(s, s.defaults[level], '__fallback__'), `${s.key} ${level}`).toBe(s.defaults[level]);
            }
            expect(s.label.en && s.label.zh && s.description.en && s.description.zh, s.key).toBeTruthy();
            if (s.type === 'enum') for (const o of s.options) expect(s.optionLabels[o], `${s.key} ${o}`).toBeDefined();
            for (const key of Object.keys(s.requires ?? {})) expect(settings.some((t) => t.key === key), `${s.key} requires ${key}`).toBe(true);
        }
    });

    it('is what a level is made of: every default profile reads its values from the table', () => {
        for (const level of LEVELS) {
            const profile = defaultQualityProfile(level) as unknown as Record<string, unknown>;
            for (const s of settings) expect(profile[s.key], `${s.key} ${level}`).toBe(s.defaults[level]);
        }
    });

    it('parses each kind: a switch only from a boolean, a choice only from its options, a name only from its names', () => {
        const byKey = (key: string) => settings.find((s) => s.key === key)!;
        expect(parseQualitySetting(byKey('waterMirror'), 1, false)).toBe(false);
        expect(parseQualitySetting(byKey('waterMirror'), true, false)).toBe(true);
        expect(parseQualitySetting(byKey('shadowAtlasSize'), 3000, 1024)).toBe(1024);
        expect(parseQualitySetting(byKey('shadowAtlasSize'), 4096, 1024)).toBe(4096);
        expect(parseQualitySetting(byKey('msaaSamples'), 3, 1)).toBe(1);
        expect(parseQualitySetting(byKey('antialiasing'), 'fxaa', 'msaa')).toBe('msaa');
        expect(parseQualitySetting(byKey('lighting'), 'direct', 'full')).toBe('direct');
        expect(parseQualitySetting(byKey('waterWaves'), 5.6, 3)).toBe(6);
        expect(parseQualitySetting(byKey('waterWaves'), 40, 3)).toBe(8);
    });

    it('says when a setting acts at a level: MSAA only where the level smooths with it, effect sizes only with post-processing on', () => {
        const byKey = (key: string) => settings.find((s) => s.key === key)!;
        expect(qualitySettingRequirementsMet(byKey('msaaSamples'), defaultQualityProfile('medium'))).toBe(false);
        expect(qualitySettingRequirementsMet(byKey('msaaSamples'), defaultQualityProfile('high'))).toBe(true);
        expect(qualitySettingRequirementsMet(byKey('aoResolution'), resolveQualityProfile('low', { postProcess: false }))).toBe(false);
        expect(qualitySettingRequirementsMet(byKey('renderScale'), {})).toBe(true);
    });
});

describe('a project written before the table', () => {
    it('keeps every value it set, at the level it set it', () => {
        const config = parseQualityConfig(JSON.parse(JSON.stringify({ mode: 'low', profiles: { low: OLD_LOW } })));
        const profile = new QualityController(config).profile as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(OLD_LOW)) {
            if (key === 'ssao' || key === 'skipEffects') continue;
            expect(profile[key], key).toEqual(value);
        }
        expect(profile.skipEffects).toEqual(['bloom', 'ssao', 'gtao']);
        expect('ssao' in profile).toBe(false);
        expect(resolveQualityProfile('medium', config.profiles?.medium)).toEqual(defaultQualityProfile('medium'));
    });

    it('keeps the cross-field rules: a floor under the render scale, a cell no more than half the atlas', () => {
        const profile = resolveQualityProfile('high', { renderScale: 0.5, minRenderScale: 0.9, shadowAtlasSize: 512, shadowCellSize: 1024 });
        expect(profile.minRenderScale).toBe(0.5);
        expect(profile.shadowCellSize).toBe(256);
        expect(resolveQualityProfile('low', { renderScale: 0.4 }).minRenderScale).toBe(0.4);
    });
});

describe('ambient occlusion', () => {
    const allowed = (profile: ReturnType<typeof resolveQualityProfile>, type: string) =>
        effectPassNames(type).every((pass) => qualityPassAllowed(profile, pass));

    it('has one author, the list of effects a level leaves out, and no switch of its own', () => {
        expect('ssao' in defaultQualityProfile('low')).toBe(false);
        expect(defaultQualityProfile('low').skipEffects).toEqual(expect.arrayContaining(['ssao', 'gtao']));
        expect(allowed(defaultQualityProfile('low'), 'ssao')).toBe(false);
        expect(allowed(defaultQualityProfile('high'), 'gtao')).toBe(true);
        expect(allowed(resolveQualityProfile('high', { skipEffects: ['gtao'] }), 'gtao')).toBe(false);
        expect(allowed(resolveQualityProfile('high', { skipEffects: ['gtao'] }), 'ssao')).toBe(true);
    });

    it('reads the old switch into the list: off leaves both estimators out, on lets SSAO back in', () => {
        const off = resolveQualityProfile('high', { ssao: false } as never);
        expect(allowed(off, 'ssao')).toBe(false);
        expect(allowed(off, 'gtao')).toBe(false);
        const on = resolveQualityProfile('low', { ssao: true } as never);
        expect(allowed(on, 'ssao')).toBe(true);
        expect(allowed(on, 'gtao')).toBe(false);
    });
});

describe('where an effect is listed among a level\'s settings', () => {
    it('puts each effect in the group it belongs to and the rest under post-processing', () => {
        expect(effectQualityGroup('ssr')).toBe('reflections');
        for (const type of ['ssao', 'gtao', 'ssgi', 'voxelGI', 'dynamicGI']) expect(effectQualityGroup(type), type).toBe('globalIllumination');
        for (const type of ['heightFog', 'distanceFog', 'skyAtmosphere']) expect(effectQualityGroup(type), type).toBe('sky');
        for (const type of ['bloom', 'taa', 'depthOfField', 'lensFlare']) expect(effectQualityGroup(type), type).toBe('postProcessing');
        const groups = new Set(QUALITY_SETTING_GROUPS.map((g) => g.id));
        for (const def of getAllEffectDefs()) expect(groups.has(effectQualityGroup(def.type)), def.type).toBe(true);
    });

    it('names every built-in effect in Chinese too', () => {
        for (const def of getAllEffectDefs()) expect(def.labelZh, def.type).toBeTruthy();
    });
});

describe('the values the engine reads by name', () => {
    const ENGINE_CAPS: Record<string, number> = { loopLights: 16, tiledLights: 96, shadowTiles: 16 };

    it('are named once each, held at the engine\'s old constant at high, and never past the size the engine compiled for', () => {
        const named = settings.filter((s) => s.type !== 'enum' && s.engine !== undefined);
        expect(new Set(named.map((s) => s.engine)).size).toBe(named.length);
        expect(Object.fromEntries(named.map((s) => [s.engine, s.defaults.high]))).toEqual(ENGINE_CAPS);
        for (const s of named) {
            if (s.type !== 'number') continue;
            expect(s.max, s.key).toBe(ENGINE_CAPS[s.engine!]);
            expect(s.defaults.low <= s.defaults.medium && s.defaults.medium <= s.defaults.high, s.key).toBe(true);
            expect(parseQualitySetting(s, s.max + 100, 0), s.key).toBe(s.max);
            expect(parseQualitySetting(s, s.min - 100, 0), s.key).toBe(s.min);
        }
    });

    it('are the level\'s values, and the high ones with no level at all', () => {
        expect(Object.fromEntries(qualityEngineValues(defaultQualityProfile('low')))).toEqual({ loopLights: 8, tiledLights: 32, shadowTiles: 8 });
        expect(Object.fromEntries(qualityEngineValues(null))).toEqual(ENGINE_CAPS);
    });

    it('marks the soft-shadow and tiled-light values as acting only with full lighting', () => {
        const byKey = (key: string) => settings.find((s) => s.key === key)!;
        for (const key of ['tiledLights', 'shadowBlockerSamples', 'shadowFilterSamples', 'shadowSearchRadius']) {
            expect(qualitySettingRequirementsMet(byKey(key), defaultQualityProfile('low')), key).toBe(false);
            expect(qualitySettingRequirementsMet(byKey(key), defaultQualityProfile('high')), key).toBe(true);
        }
        expect(qualitySettingRequirementsMet(byKey('loopLights'), defaultQualityProfile('low'))).toBe(true);
    });

    it('sends the contact shadow march its steps, bounded by the loop the shader compiles', () => {
        expect(qualityEffectUniforms(defaultQualityProfile('low'), 'contactShadows')).toEqual([['u_contactShadowSteps', 8]]);
        expect(qualityEffectUniforms(defaultQualityProfile('high'), 'contactShadows')).toEqual([['u_contactShadowSteps', 20]]);
        const source = readFileSync(resolve(__dirname, '../src/postprocess/sources/lighting.ts'), 'utf8');
        expect(source).toContain("CONTACT_SHADOW_STEPS_MAX = ${qualityUniformMax('contactShadowSteps')}");
        expect(source).toContain("${qualityUniformParam('contactShadowSteps')}");
    });

    it('gives the soft 3D shadow its three numbers in the material slots, 0 being the engine\'s own with no level', () => {
        expect(qualityMaterialConstants(defaultQualityProfile('low')).slice(1)).toEqual([8, 8, 12]);
        expect(qualityMaterialConstants(defaultQualityProfile('medium')).slice(1)).toEqual([8, 16, 16]);
        expect(qualityMaterialConstants(defaultQualityProfile('high')).slice(1)).toEqual([16, 32, 24]);
        const slots = settings.flatMap((s) => (s.type === 'number' || s.type === 'choice') && s.materialSlot !== undefined ? [s.materialSlot] : []);
        expect(new Set(slots).size).toBe(slots.length);
    });
});
