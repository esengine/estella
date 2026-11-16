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
import { PostProcessAPI, PostProcessStack, initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess';
import { postProcessVolumeSystem } from '../src/postprocess/volumeSystem';
import { resolveQualityProfile } from '../src/render/quality';
import { Material } from '../src/render/material';
import { withWgslTwin } from '../src/shaders/wgsl/twin';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import type { ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

registerBasicEffectSources();

const CAMERA = 7 as Entity;

function core(pending: { count: number }) {
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
        renderer_getPendingShaders: vi.fn(() => pending.count),
    };
}

type Effect = { type: string; enabled?: boolean; uniforms?: Record<string, number>; colors?: Record<string, { r: number; g: number; b: number; a: number }> };

const LOOK: Effect[] = [
    { type: 'colorGrade', uniforms: { u_exposure: -0.15, u_contrast: 1.1, u_saturation: 1.08 }, colors: { u_lift: { r: 0.1, g: 0, b: 0.2, a: 1 } } },
    { type: 'sharpen', uniforms: { u_intensity: 0.3, u_limit: 0.25 } },
    { type: 'filmGrain', uniforms: { u_intensity: 0.06, u_size: 1.4, u_response: 0.8 } },
    { type: 'vignette', uniforms: { u_intensity: 0.4, u_softness: 0.6 } },
];

function frame(api: PostProcessAPI, effects: Effect[], weight = 1): void {
    const volume = [1, { isGlobal: true, priority: 0, weight, effects: effects.map((e) => ({ enabled: true, uniforms: {}, ...e })) },
        { position: { x: 0, y: 0, z: 0 } }];
    const camera = [CAMERA, { isActive: true, clearFlags: 3, projectionType: 0 }, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } }];
    (postProcessVolumeSystem as unknown as { _fn: (...a: unknown[]) => void })._fn(api, [volume], [camera]);
    api._applyForCamera(CAMERA);
}

const added = (mock: ReturnType<typeof core>): string[] => mock.postprocess_addPass.mock.calls.map((c) => c[0] as string);
const floats = (mock: ReturnType<typeof core>, pass: string): Record<string, number> =>
    Object.fromEntries(mock.postprocess_setUniformFloat.mock.calls.filter((c) => c[0] === pass).map((c) => [c[1], c[2]]));

describe('adjacent effects drawn as one pass', () => {
    let mock: ReturnType<typeof core>;
    let pending: { count: number };
    let api: PostProcessAPI;

    beforeEach(() => {
        pending = { count: 0 };
        mock = core(pending);
        initPostProcessAPI(mock as unknown as ESEngineModule);
        api = new PostProcessAPI();
    });

    afterEach(() => {
        shutdownPostProcessAPI();
    });

    it('draws a colour grade, sharpen, film grain and vignette that are side by side and on as one pass, each with its own params', () => {
        frame(api, LOOK);
        expect(added(mock)).toEqual(['colorGrade+sharpen_fs+filmGrain+vignette']);
        expect(floats(mock, 'colorGrade+sharpen_fs+filmGrain+vignette')).toMatchObject({
            u_colorGrade_exposure: -0.15, u_colorGrade_contrast: 1.1, u_colorGrade_saturation: 1.08,
            u_sharpen_intensity: 0.3, u_sharpen_limit: 0.25,
            u_filmGrain_intensity: 0.06, u_filmGrain_size: 1.4, u_filmGrain_response: 0.8,
            u_vignette_intensity: 0.4, u_vignette_softness: 0.6,
        });
        expect(mock.postprocess_setUniformVec4).toHaveBeenCalledWith('colorGrade+sharpen_fs+filmGrain+vignette', 'u_colorGrade_lift', 0.1, 0, 0.2, 1);
    });

    it('hands the pass the values a volume of part weight resolves to', () => {
        frame(api, LOOK, 0.5);
        const values = floats(mock, 'colorGrade+sharpen_fs+filmGrain+vignette');
        expect(values.u_vignette_intensity).toBeCloseTo(0.2);
        expect(values.u_colorGrade_contrast).toBeCloseTo(1.05);
    });

    it('leaves out what the quality level skips and draws the rest as one pass', () => {
        api.setQualityFilter(resolveQualityProfile('low', { skipEffects: ['filmGrain'] }));
        frame(api, LOOK);
        expect(added(mock)).toEqual(['colorGrade+sharpen_fs+vignette']);
        expect(Object.keys(floats(mock, 'colorGrade+sharpen_fs+vignette')).some((k) => k.startsWith('u_filmGrain_'))).toBe(false);
    });

    it('leaves out an effect the volume turns off', () => {
        frame(api, LOOK.map((e) => (e.type === 'sharpen' ? { ...e, enabled: false } : e)));
        expect(added(mock)).toEqual(['colorGrade+filmGrain+vignette']);
    });

    it('draws effects with another pass between them as passes of their own', () => {
        frame(api, [LOOK[0]!, { type: 'fxaa' }, LOOK[3]!]);
        expect(added(mock)).toEqual(['colorGrade', 'fxaa', 'vignette']);
    });

    it('draws the effects as their own passes while the shader that combines them is compiling', () => {
        pending.count = 2;
        frame(api, LOOK);
        expect(added(mock)).toEqual(['colorGrade', 'sharpen_fs', 'filmGrain', 'vignette']);
        mock.postprocess_addPass.mockClear();
        pending.count = 0;
        frame(api, LOOK);
        expect(added(mock)).toEqual(['colorGrade+sharpen_fs+filmGrain+vignette']);
    });

    it('draws each effect as its own pass when fusion is off', () => {
        api.fusePasses = false;
        frame(api, LOOK);
        expect(added(mock)).toEqual(['colorGrade', 'sharpen_fs', 'filmGrain', 'vignette']);
    });

    it('does not read a sharpen through the passes before it when they read a picture drawn smaller', async () => {
        const { PassFusion } = await import('../src/postprocess/passFusion');
        const fusion = new PassFusion(new Map(), () => 0);
        const stack = new PostProcessStack(api.state);
        stack.addPass('half', 1 as never, 0.5);
        for (const [name, effect] of [['colorGrade', 'colorGrade'], ['sharpen_fs', 'sharpen'], ['vignette', 'vignette']]) {
            stack.addPass(name!, 2 as never).setEffect(name!, effect!);
        }
        const names = fusion.plan(stack.passes).map((p) => p.name);
        expect(names).toEqual(['half', 'colorGrade', 'sharpen_fs+vignette']);
    });

    it('reads each of sharpen\'s neighbours through the colour grade before it, and grades nothing twice', async () => {
        const { fusedShaderSource } = await import('../src/postprocess/effectStage');
        frame(api, LOOK);
        const sources = (Material.compileShader as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
        const fused = sources.find((s) => s.includes('esSharpen') && s.includes('esVignette'))!;
        expect(fused).toBeDefined();
        const tap = fused.slice(fused.indexOf('vec4 esTap('), fused.indexOf('vec4 esSharpen('));
        expect(tap).toContain('texelFetch(u_texture, q, 0)');
        expect(tap).toContain('c = esColorGrade(c, uv);');
        const main = fused.slice(fused.indexOf('void main()'));
        expect(main).toContain('vec4 c = esSharpen(p, size);');
        expect(main.indexOf('esFilmGrain(c, v_texCoord)')).toBeLessThan(main.indexOf('esVignette(c, v_texCoord)'));
        expect(main).not.toContain('esColorGrade');
        expect(fused).not.toMatch(/\bu_intensity\b/);
        expect(fused).toContain('#pragma param u_sharpen_intensity float default(0.5)');
        expect(fused).toContain('#pragma param u_colorGrade_lift color default(0,0,0,1)');
        expect(withWgslTwin(fused)).toContain('fn fs_main(');
        expect(fusedShaderSource).toBeTypeOf('function');
    });
});
