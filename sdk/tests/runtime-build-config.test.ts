// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The runtime tuning a project can declare: what the parser keeps, and that the defaults it compares against are the engine's own.
 */
import { describe, it, expect, vi } from 'vitest';
import { RUNTIME_BUILD_DEFAULTS, RuntimeConfig, applyBuildRuntimeConfig, parseRuntimeBuildConfig } from '../src/defaults';
import { packagedRuntimeInit } from '../src/runtime/packagedRuntime';
import { initRuntime } from '../src/runtime/runtimeLoader';
import { EmbeddedBackend } from '../src/asset/Backend';
import { App } from '../src/app/app';
import { createMockModule } from './mocks/wasm';

describe('packagedRuntimeInit', () => {
    it.each([
        { shared: true, carriesVariant: true, expected: 'shared.wasm' },
        { shared: false, carriesVariant: true, expected: 'systems.wasm' },
        { shared: true, carriesVariant: false, expected: 'systems.wasm' },
        { shared: false, carriesVariant: false, expected: 'systems.wasm' },
    ])('selects $expected with shared heap $shared and shared variant $carriesVariant', async test => {
        const app = App.new(), module = createMockModule();
        module.wasmMemory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: test.shared });
        app.connectCpp(module.getRegistry(), module);
        const stop = new Error('reached compiled installation');
        const install = vi.spyOn(app, 'installCompiledSystems').mockRejectedValue(stop);
        const manifest = { engineAbi: 'abi', projectShapes: 'shapes', systems: [] };
        const aot = { module: 'systems.wasm', ...(test.carriesVariant ? { sharedModule: 'shared.wasm' } : {}), manifest };
        try {
            await expect(initRuntime({
                app, module, scenes: [], firstScene: 'Main', ...packagedRuntimeInit({ aot }),
                source: { backend: new EmbeddedBackend({}), decodePixels: async () => { throw new Error('unexpected image'); } },
            })).rejects.toBe(stop);
            expect(install).toHaveBeenCalledWith(test.expected, manifest);
        } finally { app.quit({ keepRenderer: true }); }
    });

    it('hands the declared tuning to initRuntime, which is where every host applies it', () => {
        const runtime = { assetLoadTimeout: 60000 };
        expect(packagedRuntimeInit({ runtime }).runtime).toBe(runtime);
        expect(packagedRuntimeInit({}).runtime).toBeUndefined();
    });

    it('decodes theme colors alongside gameplay and native host settings', () => {
        const settings = {
            physicsEnabled: false, physicsConfig: { fixedTimestep: 0.02 }, physics3dBackend: 'physx' as const,
            physics3dWorld: { unitsPerMeter: 1 }, audioConfig: { maxVoices: 0 }, achievements: [],
            uiTheme: 'light' as const, steamAppId: 42,
            screenFit: { designWidth: 640, designHeight: 360, scaleMode: 0, matchWidthOrHeight: 0 },
            aot: { module: 'aot/systems.wasm', manifest: { engineAbi: 'abi', projectShapes: 'shapes', systems: [] } },
            debugChannel: { url: 'ws://localhost:4000' },
        };
        const config = { ...settings, uiThemeColors: { primary: '#00ff00ff' }, entryScene: 'main' };
        const options = packagedRuntimeInit(config);
        expect(options).toMatchObject({ ...settings, uiThemeOverrides: { colors: { primary: { r: 0, g: 1, b: 0, a: 1 } } } });
        expect(options).not.toHaveProperty('entryScene');
        expect(options).not.toHaveProperty('uiThemeColors');
    });
});

describe('RUNTIME_BUILD_DEFAULTS', () => {
    it('are what the engine starts with, so "differs from the default" means differs from what runs', () => {
        const { sceneTransitionColor, ...numbers } = RUNTIME_BUILD_DEFAULTS;
        expect(sceneTransitionColor).toBe('#000000');
        expect(RuntimeConfig.sceneTransitionColor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
        for (const [key, value] of Object.entries(numbers)) {
            expect((RuntimeConfig as Record<string, unknown>)[key], key).toBe(value);
        }
    });
});

describe('parseRuntimeBuildConfig', () => {
    it('keeps nothing for nothing, and for anything that is not an object', () => {
        expect(parseRuntimeBuildConfig(undefined)).toEqual({});
        expect(parseRuntimeBuildConfig(null)).toEqual({});
        expect(parseRuntimeBuildConfig([1, 2])).toEqual({});
        expect(parseRuntimeBuildConfig('x')).toEqual({});
    });

    it('drops a value equal to the default, since absence is how a default is written', () => {
        expect(parseRuntimeBuildConfig({ ...RUNTIME_BUILD_DEFAULTS })).toEqual({});
    });

    it('holds a number to its range and an integer field to whole numbers', () => {
        expect(parseRuntimeBuildConfig({ maxFixedSteps: 0, assetLoadTimeout: 5, textureCacheBudget: -1 })).toEqual({
            maxFixedSteps: 1, assetLoadTimeout: 1000, textureCacheBudget: 0,
        });
        expect(parseRuntimeBuildConfig({ maxFixedSteps: 12.6 })).toEqual({ maxFixedSteps: 13 });
        expect(parseRuntimeBuildConfig({ maxDeltaTime: 99 })).toEqual({ maxDeltaTime: 5 });
        expect(parseRuntimeBuildConfig({ maxDeltaTime: 0.5 })).toEqual({ maxDeltaTime: 0.5 });
    });

    it('drops a field of the wrong type or a non-finite number', () => {
        expect(parseRuntimeBuildConfig({
            maxDeltaTime: '1', maxFixedSteps: Number.NaN, textCanvasSize: Infinity, defaultFontFamily: 4, sceneTransitionColor: 'red',
        })).toEqual({});
    });

    it('takes a six-digit colour in lower case and refuses one with alpha', () => {
        expect(parseRuntimeBuildConfig({ sceneTransitionColor: '#FFAA00' })).toEqual({ sceneTransitionColor: '#ffaa00' });
        expect(parseRuntimeBuildConfig({ sceneTransitionColor: '#ffaa0080' })).toEqual({});
    });

    it('takes a font family unless it is blank, absurdly long or the engine\'s own', () => {
        expect(parseRuntimeBuildConfig({ defaultFontFamily: 'Noto Sans SC' })).toEqual({ defaultFontFamily: 'Noto Sans SC' });
        expect(parseRuntimeBuildConfig({ defaultFontFamily: '  ' })).toEqual({});
        expect(parseRuntimeBuildConfig({ defaultFontFamily: 'x'.repeat(201) })).toEqual({});
        expect(parseRuntimeBuildConfig({ defaultFontFamily: 'Arial' })).toEqual({});
    });
});

describe('maxFrameRate', () => {
    it('is a whole number from 0 (follow the display) to 240', () => {
        expect(parseRuntimeBuildConfig({ maxFrameRate: 60 })).toEqual({ maxFrameRate: 60 });
        expect(parseRuntimeBuildConfig({ maxFrameRate: 29.6 })).toEqual({ maxFrameRate: 30 });
        expect(parseRuntimeBuildConfig({ maxFrameRate: 1000 })).toEqual({ maxFrameRate: 240 });
        expect(parseRuntimeBuildConfig({ maxFrameRate: -5 })).toEqual({});
        expect(parseRuntimeBuildConfig({ maxFrameRate: 0 })).toEqual({});
    });

    it('caps the App the game boots, and leaves an undeclared cap alone', () => {
        const caps: number[] = [];
        const app = { setMaxDeltaTime() {}, setMaxFixedSteps() {}, setTargetFrameRate(fps: number) { caps.push(fps); } };
        try {
            applyBuildRuntimeConfig(app, { maxFrameRate: 60 });
            expect(caps).toEqual([60]);
            expect(RuntimeConfig.maxFrameRate).toBe(60);
            applyBuildRuntimeConfig(app, {});
            expect(caps).toEqual([60]);
            expect(RuntimeConfig.maxFrameRate).toBe(0);
        } finally {
            applyBuildRuntimeConfig(app, {});
        }
    });
});
