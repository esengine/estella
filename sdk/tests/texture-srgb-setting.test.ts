// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A KTX2 texture is sampled as colour or as data by its own sRGB setting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CppResourceManager, ESEngineModule } from '../src/wasm';

const { rm, host } = vi.hoisted(() => {
    const rm = {
        createTextureFromKTX2: vi.fn(() => ({ handle: 3, width: 4, height: 4, format: 2 })),
        createTextureFromBytes: vi.fn(() => 4),
        adoptTextureContent: vi.fn(() => true),
        releaseTexture: vi.fn(),
    };
    return { rm, host: { manager: rm as Partial<CppResourceManager> } };
});
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => host.manager,
    provideTextureContent: () => {},
}));

import { TextureLoader } from '../src/asset/loaders/TextureLoader';
import { textureFormatOf } from '../src/asset/textureFormatReport';
import { TextureContent } from '../src/wasm';
import { setLinearColorSpace } from '../src/ecs/env';
import { setNativeEngineApi } from '../src/ecs/bridge/engineApi';
import { createNativeResourceManager } from '../src/ecs/bridge/nativeResourceManager';

const KTX2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ctx = {
    backend: { fetchBinary: async () => KTX2.buffer.slice(0) },
    catalog: { getBuildPath: (p: string) => p },
} as never;

async function srgbFor(settings?: { srgb?: boolean }): Promise<boolean> {
    rm.createTextureFromKTX2.mockClear();
    await new TextureLoader(null).loadDetached('a.ktx2', ctx, false, settings);
    return (rm.createTextureFromKTX2.mock.calls[0] as unknown[])[1] as boolean;
}

describe('a KTX2 texture under the linear pipeline', () => {
    afterEach(() => setLinearColorSpace(false));

    it('is decoded as colour unless its settings say it holds data', async () => {
        setLinearColorSpace(true);
        expect(await srgbFor()).toBe(true);
        expect(await srgbFor({ srgb: true })).toBe(true);
        // A normal map decoded as colour would bend every texel below one.
        expect(await srgbFor({ srgb: false })).toBe(false);
    });

    it('is never decoded as colour when the pipeline is not linear', async () => {
        expect(await srgbFor()).toBe(false);
    });

    it('uploads linear data as plain RGBA when compressed blocks cannot be used', async () => {
        setLinearColorSpace(true);
        host.manager = { ...rm, createTextureFromKTX2: undefined };
        const pixels = new Uint8Array(4 * 4 * 4);
        const loader = new TextureLoader(null);
        loader.setTranscoder({ transcode: () => null, transcodeToRgba: () => ({ width: 4, height: 4, data: pixels }) });
        try {
            await loader.loadDetached('normal.ktx2', ctx, false, { srgb: false, filter: 'nearest', wrap: 'mirror', mipmaps: false });
            expect(rm.createTextureFromBytes).toHaveBeenLastCalledWith(4, 4, pixels, 1, false, TextureContent.Asset, 0, 2);
        } finally { host.manager = rm; }
    });
});

describe('the sampler of an engine-uploaded KTX2', () => {
    afterEach(() => { host.manager = rm; setNativeEngineApi(null); });

    it.each([true, false])('selects the authored levels and addresses the renderer texture with mipmaps %s', async mipmaps => {
        const createCompressedTexture = vi.fn(() => 7);
        host.manager = { ...rm, createTextureFromKTX2: undefined, supportsCompressedFormat: () => true,
            createCompressedTexture, getTextureGLId: handle => handle + 100 };
        const renderer_setTextureParams = vi.fn();
        const module = { HEAPU8: new Uint8Array(128), _malloc: () => 16, _free: vi.fn(), renderer_setTextureParams };
        const loader = new TextureLoader(module as unknown as ESEngineModule);
        const base = { width: 8, height: 8, data: new Uint8Array(64) };
        const tail = { width: 4, height: 4, data: new Uint8Array(16) };
        loader.setTranscoder({ transcode: () => ({ ...base, levels: [base, tail] }), transcodeToRgba: () => null });
        await loader.loadDetached('sprite.ktx2', ctx, false, { filter: 'nearest', wrap: 'repeat', mipmaps });
        expect(createCompressedTexture).toHaveBeenCalledWith(8, 8, expect.any(Number), 16, mipmaps ? 80 : 64,
            mipmaps ? 2 : 1, TextureContent.Asset);
        expect(renderer_setTextureParams).toHaveBeenCalledWith(107, 0, 0, 0, 0);
    });

    it('applies native sampling to the host render id and forwards the mip choice', async () => {
        const renderer_setTextureParams = vi.fn();
        const createTexture = vi.fn(() => ({ id: 3, width: 4, height: 4 }));
        setNativeEngineApi({ renderer_setTextureParams });
        host.manager = createNativeResourceManager({
            es_createTextureKTX2: createTexture,
            es_rm_getTextureGLId: (handle: number) => handle + 200,
        });
        await new TextureLoader(null).loadDetached('sprite.ktx2', ctx, false, { filter: 'nearest', wrap: 'mirror', mipmaps: false });
        expect(createTexture).toHaveBeenCalledWith(KTX2, false, false, 0);
        expect(renderer_setTextureParams).toHaveBeenCalledWith(203, 0, 0, 2, 2);
    });

    it('passes the streaming bound from a held texture through the native bridge', async () => {
        const createTexture = vi.fn((_bytes: Uint8Array, _srgb: boolean, _mips: boolean, edge: number) =>
            ({ id: 3, width: edge || 64, height: edge || 64 }));
        host.manager = createNativeResourceManager({ es_createTextureKTX2: createTexture, es_rm_adoptTextureContent: () => true });
        const loader = new TextureLoader(null);
        const { handle } = await loader.load('mesh.ktx2', ctx);
        expect(await loader.resize(handle, 16, ctx)).toEqual({ width: 16, height: 16 });
        expect(await loader.resize(handle, 0, ctx)).toEqual({ width: 64, height: 64 });
        expect(createTexture.mock.calls.map(args => args[3])).toEqual([0, 16, 0]);
    });

    it('keeps a sub-block preview drawable and restores the original compressed content on the same handle', async () => {
        const createCompressedTexture = vi.fn(() => 7);
        host.manager = { ...rm, createTextureFromKTX2: undefined, supportsCompressedFormat: () => true, createCompressedTexture };
        const module = { HEAPU8: new Uint8Array(128), _malloc: () => 16, _free: vi.fn() };
        const loader = new TextureLoader(module as unknown as ESEngineModule);
        const level = (width: number) => ({ width, height: width, data: new Uint8Array(16) });
        const levels = [level(4), level(2), level(1)];
        // An injected transcoder may still return every level. Its full result must work on resize too.
        const transcodeToRgba = vi.fn(() => ({ ...levels[0]!, levels }));
        loader.setTranscoder({ transcode: () => ({ ...levels[0]!, levels }), transcodeToRgba });
        const { handle } = await loader.load('mesh.ktx2', ctx);
        expect(await loader.resize(handle, 2, ctx)).toEqual({ width: 2, height: 2 });
        expect(createCompressedTexture).toHaveBeenCalledOnce();
        expect(transcodeToRgba).toHaveBeenCalledWith(KTX2, { maxEdge: 2, mipmaps: false });
        expect(textureFormatOf(loader.formatReport(), 'mesh.ktx2')?.reason).toBe('not-block-aligned');
        expect(rm.adoptTextureContent).toHaveBeenLastCalledWith(handle, 4);
        expect(await loader.resize(handle, 0, ctx)).toEqual({ width: 4, height: 4 });
        expect(createCompressedTexture).toHaveBeenCalledTimes(2);
        expect(textureFormatOf(loader.formatReport(), 'mesh.ktx2')?.reason).toBe('compressed');
    });

    it('releases an unpublished texture when the device rejects the sampler', async () => {
        setNativeEngineApi({ renderer_setTextureParams() { throw new Error('device lost'); } });
        const releaseTexture = vi.fn();
        host.manager = { ...rm, releaseTexture, getTextureGLId: handle => handle + 200 };
        await expect(new TextureLoader(null).loadDetached('sprite.ktx2', ctx, false, { filter: 'nearest' }))
            .rejects.toThrow('device lost');
        expect(releaseTexture.mock.calls).toEqual([[3]]);
    });
});

describe('the upload published in the texture format report', () => {
    const pixels = { width: 1, height: 1, pixels: new Uint8Array(4) };

    it('keeps the pixel and compressed decisions with their own concurrent requests', async () => {
        const loader = new TextureLoader(null);
        let resume!: () => void;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        loader.setPixelDecoder(async () => { await gate; return pixels; });
        const image = loader.load('panel.png', ctx);
        try {
            expect(await loader.loadRaw('mesh.ktx2', ctx)).toEqual({ handle: 3, width: 4, height: 4 });
        } finally { resume(); }
        expect(await image).toEqual({ handle: 4, width: 1, height: 1 });
        const report = loader.formatReport();
        expect(textureFormatOf(report, 'panel.png')?.reason).toBe('uncompressed-payload');
        expect(textureFormatOf(report, 'mesh.ktx2')?.effective).toBe('astc-4x4');
        expect(report.compressed).toBe(1);
    });

    it('updates the report only after a streamed replacement is adopted', async () => {
        const loader = new TextureLoader(null);
        loader.setPixelDecoder(async () => pixels);
        const file = 'wall.png';
        const { handle } = await loader.load(file, ctx);
        loader.setCompressedSource(async () => KTX2);
        rm.adoptTextureContent.mockReturnValueOnce(false);
        expect(await loader.resize(handle, 0, ctx)).toBeNull();
        expect(textureFormatOf(loader.formatReport(), file)?.payload).toBe('raw');
        expect(await loader.resize(handle, 0, ctx)).toEqual({ width: 4, height: 4 });
        expect(textureFormatOf(loader.formatReport(), file)?.effective).toBe('astc-4x4');
        expect(loader.formatReport().textures).toHaveLength(1);
    });
});
