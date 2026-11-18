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
import { qualityPassScale } from '../src/postprocess/qualityFilter';
import { getAllEffectDefs } from '../src/postprocess/effects';
import { QualityController, defaultQualityProfile, parseQualityConfig, resolveQualityProfile } from '../src/render/quality';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import { registerLightingEffectSources } from '../src/postprocess/sources/lighting';
import type { ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

registerBasicEffectSources();
registerLightingEffectSources();

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

describe('the effect resolution of a quality level', () => {
    it('is highest at the high level and never higher than the effects as authored', () => {
        const [low, medium, high] = (['low', 'medium', 'high'] as const).map((l) => defaultQualityProfile(l).effectResolution);
        expect(high).toBe(1);
        expect(low).toBeLessThan(medium!);
        expect(medium).toBeLessThan(high!);
    });

    it('takes a project override, held between an eighth and one, and ignores what is not a number', () => {
        expect(resolveQualityProfile('high', { effectResolution: 0.5 }).effectResolution).toBe(0.5);
        expect(resolveQualityProfile('high', { effectResolution: 0.01 }).effectResolution).toBe(0.125);
        expect(resolveQualityProfile('low', { effectResolution: 4 }).effectResolution).toBe(1);
        expect(resolveQualityProfile('medium', { effectResolution: 'half' as unknown as number }).effectResolution)
            .toBe(defaultQualityProfile('medium').effectResolution);
        const config = parseQualityConfig({ mode: 'low', profiles: { low: { effectResolution: 0.5 } } });
        expect(new QualityController(config).profile.effectResolution).toBe(0.5);
    });

    it('is a player preference over the level, kept through a change of level and dropped with null', () => {
        const q = new QualityController({ mode: 'high', profiles: { low: { effectResolution: 0.5 } } });
        q.setPreferences({ effectResolution: 0.25 });
        expect(q.profile.effectResolution).toBe(0.25);
        q.setMode('low');
        expect(q.profile.effectResolution).toBe(0.25);
        q.setPreferences(null);
        expect(q.profile.effectResolution).toBe(0.5);
    });
});

describe('the size a pass is drawn at', () => {
    it('multiplies a pass that can be drawn smaller, down to its floor and never past its authored size', () => {
        const reducible = subPasses().filter((p) => p.minScale !== undefined);
        expect(reducible.map((p) => p.name)).toEqual(expect.arrayContaining(['ssao_ao', 'gtao_ao', 'fog_volume', 'ssgi_gather', 'lensflare_flare']));
        for (const pass of reducible) {
            const scale = pass.scale ?? 1;
            expect(pass.minScale!, pass.name).toBeLessThanOrEqual(scale);
            for (const effectResolution of [0.125, 0.25, 0.5, 1]) {
                const s = qualityPassScale(resolveQualityProfile('high', { effectResolution }), { scale, minScale: pass.minScale });
                expect(s, `${pass.name} ${effectResolution}`).toBe(Math.max(pass.minScale!, scale * effectResolution));
            }
            expect(qualityPassScale(resolveQualityProfile('high', { effectResolution: 0.125 }), { scale, minScale: pass.minScale })).toBe(pass.minScale);
        }
    });

    it('leaves every pass without a floor at its own size, whatever the level, and every pass alone without a level', () => {
        const fixed = subPasses().filter((p) => p.minScale === undefined);
        expect(fixed.map((p) => p.name)).toEqual(expect.arrayContaining(['ssao_composite', 'bloom_prefilter', 'bloom_up_0', 'bloom_down_1', 'sky_clouds', 'ae_measure', 'fog_composite']));
        const smallest = resolveQualityProfile('low', { effectResolution: 0.125 });
        for (const pass of fixed) expect(qualityPassScale(smallest, { scale: pass.scale ?? 1 }), pass.name).toBe(pass.scale ?? 1);
        for (const pass of subPasses()) expect(qualityPassScale(null, { scale: pass.scale ?? 1, minScale: pass.minScale })).toBe(pass.scale ?? 1);
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

    it('draws the occlusion term at the level\'s size and the full-screen passes at full size', () => {
        api.setQualityFilter(resolveQualityProfile('high', { effectResolution: 0.5, skipEffects: [] }));
        frame(api, ['ssao', 'bloom', 'fxaa']);
        const s = scales();
        expect(s.ssao_ao).toBe(0.25);
        expect(s.ssao_blur_y).toBe(0.25);
        expect(s.bloom_prefilter).toBe(0.5);
        expect(s.bloom_down_1).toBe(0.25);
        expect(s.bloom_down_5).toBe(0.015625);
        expect(s.ssao_composite).toBeUndefined();
        expect(s.fxaa).toBeUndefined();
    });

    it('tells the engine the new size on the next frame once the level changes, with the stack itself unchanged', () => {
        api.setQualityFilter(resolveQualityProfile('high', { skipEffects: [] }));
        frame(api, ['ssao']);
        expect(scales().ssao_ao).toBe(0.5);
        mock.postprocess_setPassScale.mockClear();
        api.setQualityFilter(resolveQualityProfile('high', { effectResolution: 0.25, skipEffects: [] }));
        frame(api, ['ssao']);
        expect(scales().ssao_ao).toBe(Math.max(0.5 * 0.25, subPasses().find((p) => p.name === 'ssao_ao')!.minScale!));
        mock.postprocess_setPassScale.mockClear();
        api.setQualityFilter(null);
        frame(api, ['ssao']);
        expect(scales().ssao_ao).toBe(0.5);
    });
});
