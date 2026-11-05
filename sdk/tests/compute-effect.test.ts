// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
vi.mock('../src/render/material', () => ({
    Material: {
        createShader: vi.fn().mockReturnValue(42),
        compileShader: vi.fn().mockReturnValue(42),
        releaseShader: vi.fn(),
    },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    PostProcessAPI, PostProcessStack, initPostProcessAPI, shutdownPostProcessAPI, getEffectDef, registerEffect, getAllEffectDefs,
} from '../src/postprocess';
import { syncStackToWasm } from '../src/postprocess/PostProcessAPI';
import type { ESEngineModule } from '../src/wasm';
import { registerBasicEffectSources } from '../src/postprocess/sources/basic';
import { registerAtmosphereEffectSources } from '../src/postprocess/sources/atmosphere';
import { registerLightingEffectSources } from '../src/postprocess/sources/lighting';

// The effects' shaders are installed by group: a package that uses them imports the group; these tests use them all.
registerBasicEffectSources();
registerAtmosphereEffectSources();
registerLightingEffectSources();

function mockCore(withCompute: boolean) {
    const mock: Record<string, unknown> = {
        postprocess_init: vi.fn().mockReturnValue(true),
        postprocess_shutdown: vi.fn(),
        postprocess_resize: vi.fn(),
        postprocess_addPass: vi.fn().mockReturnValue(0),
        postprocess_clearPasses: vi.fn(),
        postprocess_setPassScale: vi.fn(),
        postprocess_setPassContinuesEffect: vi.fn(),
        postprocess_setPassTexture: vi.fn(),
        postprocess_setUniformFloat: vi.fn(),
        postprocess_setUniformVec4: vi.fn(),
        postprocess_isInitialized: vi.fn().mockReturnValue(true),
    };
    if (withCompute) mock.postprocess_addComputePass = vi.fn().mockReturnValue(0);
    return mock;
}

describe('compute effects', () => {
    let pp: PostProcessAPI;

    beforeEach(() => {
        pp = new PostProcessAPI();
    });

    afterEach(() => {
        shutdownPostProcessAPI();
    });

    it('registers Sharpen as a compute effect with no draw shader', () => {
        const def = getEffectDef('sharpen');
        expect(def).toBeDefined();
        expect(def!.factory).toBeUndefined();
        expect(def!.compute?.source).toContain('@compute');
        expect(def!.compute!.source).toContain('textureStore');
        // The params block is the uniforms in their listed order, so the shader's struct has to start with them.
        expect(def!.uniforms.map((u) => u.name)).toEqual(['u_intensity', 'u_limit']);
        expect(def!.compute!.source).toMatch(/struct Params \{ intensity : f32, limit : f32/);
    });

    it('keeps every effect either a draw, a compute shader, a native pass or a stage of the last pass, never none', () => {
        for (const def of getAllEffectDefs()) {
            const kinds = (def.factory ? 1 : 0) + (def.compute ? 1 : 0) + (def.native ? 1 : 0) + (def.multiPass ? 1 : 0) + (def.stage ? 1 : 0);
            expect(kinds, `${def.type} must say how it runs`).toBeGreaterThanOrEqual(1);
        }
    });

    it('pushes a compute pass with its source, its param names in order and its workgroup', () => {
        const mock = mockCore(true);
        initPostProcessAPI(mock as unknown as ESEngineModule);
        const stack = new PostProcessStack(pp.state);
        stack.addComputePass('sharpen', { source: 'WGSL', params: ['a', 'b'], workgroupSize: [16, 4] });
        stack.setUniform('sharpen', 'a', 0.5);
        syncStackToWasm(stack, true);
        expect(mock.postprocess_addComputePass).toHaveBeenCalledWith('sharpen', 'WGSL', 'a,b', 16, 4);
        expect(mock.postprocess_addPass).not.toHaveBeenCalled();
        expect(mock.postprocess_setUniformFloat).toHaveBeenCalledWith('sharpen', 'a', 0.5);
    });

    it('leaves a compute pass out on a core that has no compute stage', () => {
        const mock = mockCore(false);
        initPostProcessAPI(mock as unknown as ESEngineModule);
        const stack = new PostProcessStack(pp.state);
        stack.addComputePass('sharpen', { source: 'WGSL', params: [], workgroupSize: [8, 8] });
        stack.addPass('blur', 7);
        expect(() => syncStackToWasm(stack, true)).not.toThrow();
        // The draw pass beside it is untouched, and nothing was asked to compute.
        expect(mock.postprocess_addPass).toHaveBeenCalledWith('blur', 7);
        expect((mock.postprocess_setUniformFloat as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('lets a project register its own compute effect', () => {
        registerEffect({
            type: 'testCompute',
            label: 'Test',
            compute: { source: '@compute @workgroup_size(8, 8) fn main() {}', workgroupSize: [8, 8] },
            uniforms: [{ name: 'u_amount', label: 'Amount', min: 0, max: 1, step: 0.1, defaultValue: 0.5 }],
        });
        expect(getEffectDef('testCompute')!.compute!.workgroupSize).toEqual([8, 8]);
    });
});

describe('native effects', () => {
    it('registers Voxel GI as an effect the engine implements itself', () => {
        const def = getEffectDef('voxelGI');
        expect(def).toBeDefined();
        expect(def!.native).toBe('voxelGI');
        expect(def!.factory).toBeUndefined();
        expect(def!.compute).toBeUndefined();
        // The native side reads these by name, with these defaults when one is not set.
        expect(def!.uniforms.map((u) => u.name)).toEqual([
            'u_intensity', 'u_rays', 'u_voxelSize', 'u_range', 'u_maxBounce', 'u_decay', 'u_bias', 'u_divisor', 'u_blend', 'u_debug',
            'u_sunAlbedo', 'u_bounceFeedback',
        ]);
        const defaults = Object.fromEntries(def!.uniforms.map((u) => [u.name, u.defaultValue]));
        expect(defaults.u_rays).toBe(8);
        expect(defaults.u_divisor).toBe(2);
        // VoxelGIParams' own defaults (VoxelGI.hpp): the sun's off-screen light on, and every bounce fed back.
        expect(defaults.u_sunAlbedo).toBe(0.6);
        expect(defaults.u_bounceFeedback).toBe(1);
    });

    it('pushes a native pass by its kind, and leaves it out on a core that cannot', () => {
        const pp = new PostProcessAPI();
        const core = mockCore(true);
        const withNative = Object.assign(core, { postprocess_addNativePass: vi.fn().mockReturnValue(0) });
        initPostProcessAPI(withNative as unknown as ESEngineModule);
        const stack = new PostProcessStack(pp.state);
        stack.addNativePass('voxelGI', 'voxelGI');
        stack.setUniform('voxelGI', 'u_rays', 12);
        syncStackToWasm(stack, true);
        expect(withNative.postprocess_addNativePass).toHaveBeenCalledWith('voxelGI', 'voxelGI');
        expect(withNative.postprocess_addPass).not.toHaveBeenCalled();
        expect(withNative.postprocess_setUniformFloat).toHaveBeenCalledWith('voxelGI', 'u_rays', 12);
        shutdownPostProcessAPI();

        const without = mockCore(true);
        initPostProcessAPI(without as unknown as ESEngineModule);
        const other = new PostProcessStack(pp.state);
        other.addNativePass('voxelGI', 'voxelGI');
        expect(() => syncStackToWasm(other, true)).not.toThrow();
        expect(without.postprocess_addPass).not.toHaveBeenCalled();
        shutdownPostProcessAPI();
    });
});
