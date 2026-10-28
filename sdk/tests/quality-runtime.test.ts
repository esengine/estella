// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import type { ESEngineModule } from '../src/wasm';
import { Quality, installQuality } from '../src/render/qualityRuntime';
import { getDeviceIdentity } from '../src/render/renderer';

vi.mock('../src/platform', () => ({
    getPlatform: () => ({ deviceName: () => 'desktop', deviceQualityInfo: () => ({ memoryGB: 8, cores: 2 }) }),
    platformNow: () => 1,
    platformOnAppHide: () => () => {}, platformOnAppShow: () => () => {},
}));
vi.mock('../src/ecs/bridge/engineApi', () => ({
    engineApi: () => ({ renderer_setQualityBudgets: vi.fn(), renderer_setShadowDistance: distanceBudget, renderer_setShadow2DSoftSamples: softSamples, renderer_setPlanarReflectionQuality: reflectionBudget, renderer_setDepthPrepass: prepass, renderer_setAsyncShaderCompile: asyncCompile }),
}));

const { distanceBudget, softSamples, reflectionBudget, prepass, asyncCompile } = vi.hoisted(() => ({ distanceBudget: vi.fn(), softSamples: vi.fn(), reflectionBudget: vi.fn(), prepass: vi.fn(), asyncCompile: vi.fn() }));

describe('quality runtime device selection', () => {
    it('applies the tier shadow range and restores camera coverage when disabled', () => {
        let apply: (() => void) | undefined;
        let controller: import('../src/render/quality').QualityController;
        const app = { wasmModule: null, insertResource: (_: unknown, value: typeof controller) => { controller = value; },
            pipeline: { setQuality: (_: unknown, callback: () => void) => { apply = callback; } },
            addPlugin: vi.fn(), onFrameEnd: () => () => {},
        } as unknown as App;
        installQuality(app, { mode: 'high', profiles: { high: { shadowDistance: 60, planarReflectionScale: 0.75, planarReflectionMaxSize: 1536 } } }, 4);
        expect(reflectionBudget).toHaveBeenLastCalledWith(0.75,1536,0);
        expect(distanceBudget).toHaveBeenLastCalledWith(60);
        controller!.setMode('off'); apply!();
        expect(distanceBudget).toHaveBeenLastCalledWith(0);
        expect(reflectionBudget).toHaveBeenLastCalledWith(0.5,1024,0);
    });
    it('draws a soft 2D shadow with the samples of its level, and with the sixteen it always had when the quality system is off', () => {
        let apply: (() => void) | undefined;
        let controller: import('../src/render/quality').QualityController;
        const app = { wasmModule: null, insertResource: (_: unknown, value: typeof controller) => { controller = value; },
            pipeline: { setQuality: (_: unknown, callback: () => void) => { apply = callback; } },
            addPlugin: vi.fn(), onFrameEnd: () => () => {},
        } as unknown as App;
        installQuality(app, { mode: 'low', profiles: { low: { shadowSoftSamples: 6 } } }, 4);
        expect(softSamples).toHaveBeenLastCalledWith(6);
        controller!.setMode('off'); apply!();
        expect(softSamples).toHaveBeenLastCalledWith(16);
    });
    it('turns the depth prepass on for a level that asks for it and off with the quality system, or for a level that does not', () => {
        let apply: (() => void) | undefined;
        let controller: import('../src/render/quality').QualityController;
        const app = { wasmModule: null, insertResource: (_: unknown, value: typeof controller) => { controller = value; },
            pipeline: { setQuality: (_: unknown, callback: () => void) => { apply = callback; } },
            addPlugin: vi.fn(), onFrameEnd: () => () => {},
        } as unknown as App;
        installQuality(app, { mode: 'high' }, 4);
        expect(prepass).toHaveBeenLastCalledWith(true);
        controller!.setMode('low'); apply!();
        expect(prepass).toHaveBeenLastCalledWith(false);
        controller!.setMode('medium'); apply!();
        expect(prepass).toHaveBeenLastCalledWith(true);
        controller!.setMode('off'); apply!();
        expect(prepass).toHaveBeenLastCalledWith(false);
    });
    it('leaves shader compiles waited for unless the config asks for them not to be, whatever the level', () => {
        const app = { wasmModule: null, insertResource: vi.fn(), addPlugin: vi.fn(), onFrameEnd: () => () => {} } as unknown as App;
        installQuality(app, { mode: 'high' }, 4);
        expect(asyncCompile).toHaveBeenLastCalledWith(false);
        installQuality(app, { mode: 'off', asyncShaderCompile: true }, 4);
        expect(asyncCompile).toHaveBeenLastCalledWith(true);
        installQuality(app, { mode: 'low', asyncShaderCompile: true }, 4);
        expect(asyncCompile).toHaveBeenLastCalledWith(true);
    });
    it('uses this app’s actual renderer identity when a GPU rule matches', () => {
        const insertResource = vi.fn();
        const wasmModule = { deviceIdentity: () => 'WebGL2|NVIDIA|RTX 3060|driver' } as ESEngineModule;
        const app = { wasmModule, insertResource, addPlugin: vi.fn(), onFrameEnd: () => () => {} } as unknown as App;
        installQuality(app, { mode: 'auto', deviceRules: [{ level: 'high', gpuIncludes: 'RTX' }] }, 1);
        expect(insertResource).toHaveBeenCalledWith(Quality, expect.anything());
        expect(insertResource.mock.calls[0][1].report()).toMatchObject({ level: 'high', reason: 'device-rule' });
        expect(getDeviceIdentity(wasmModule)?.renderer).toBe('RTX 3060');
    });

    it('uses platform capacity when this app provides no GPU identity', () => {
        const insertResource = vi.fn();
        const app = { wasmModule: null, insertResource, addPlugin: vi.fn(), onFrameEnd: () => () => {} } as unknown as App;
        installQuality(app, { mode: 'auto', deviceRules: [{ level: 'high', gpuIncludes: 'RTX' }] }, 1);
        expect(insertResource.mock.calls[0][1].report()).toMatchObject({ level: 'low', reason: 'device-capacity' });
        expect(getDeviceIdentity(null)).toBeNull();
    });
});
