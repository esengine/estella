// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setNativeEngineApi, type EngineApi } from '../src/ecs/bridge/engineApi';
import { createNativeResourceManager } from '../src/ecs/bridge/nativeResourceManager';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { RenderTexture } from '../src/render/renderTexture';
import { Renderer } from '../src/render/renderer';

afterEach(() => {
    setNativeEngineApi(null);
    shutdownResourceManager();
});

describe('render targets on a native core', () => {
    it('makes a render target and names its texture with no wasm module', () => {
        const api = {
            renderer_createTarget: vi.fn(() => 5),
            renderer_getTargetTexture: vi.fn(() => 9),
            renderer_getTargetDepthTexture: vi.fn(() => 10),
            renderer_releaseTarget: vi.fn(),
        };
        setNativeEngineApi(api as unknown as EngineApi);
        const wrap = vi.fn(() => 42);
        const release = vi.fn();
        initResourceManager(createNativeResourceManager({ es_rm_wrapDeviceTexture: wrap, es_rm_releaseTexture: release }));

        const rt = RenderTexture.create({ width: 256, height: 128, filter: 'linear' });
        expect(api.renderer_createTarget).toHaveBeenCalledWith(256, 128, 3);
        expect(rt).toMatchObject({ _handle: 5, textureId: 9, texture: 42 });
        expect(wrap).toHaveBeenCalledWith(9, 256, 128);
        expect(RenderTexture.getDepthTexture(rt)).toBe(10);

        RenderTexture.release(rt);
        expect(release).toHaveBeenCalledWith(42);
        expect(api.renderer_releaseTarget).toHaveBeenCalledWith(5);
    });

    it('sets the clear colour and texture parameters through the native core', () => {
        const api = { renderer_setClearColor: vi.fn(), renderer_setTextureParams: vi.fn() };
        setNativeEngineApi(api as unknown as EngineApi);
        Renderer.setClearColor(0.1, 0.2, 0.3, 1);
        Renderer.setTextureParams(9, 1, 1, 0, 0);
        expect(api.renderer_setClearColor).toHaveBeenCalledWith(0.1, 0.2, 0.3, 1);
        expect(api.renderer_setTextureParams).toHaveBeenCalledWith(9, 1, 1, 0, 0);
    });
});
