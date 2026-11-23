// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A KTX2 texture is sampled as colour or as data by its own sRGB setting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const { rm, host } = vi.hoisted(() => {
    const rm = {
        createTextureFromKTX2: vi.fn(() => ({ handle: 3, width: 4, height: 4, format: 2 })),
        createTextureFromBytes: vi.fn(() => 4),
        adoptTextureContent: vi.fn(() => true),
        releaseTexture: vi.fn(),
    };
    return { rm, host: { manager: rm as Partial<typeof rm> } };
});
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => host.manager,
    provideTextureContent: () => {},
}));

import { TextureLoader } from '../src/asset/loaders/TextureLoader';
import { textureFormatOf } from '../src/asset/textureFormatReport';
import { TextureContent } from '../src/wasm';
import { setLinearColorSpace } from '../src/ecs/env';

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
            await loader.loadDetached('normal.ktx2', ctx, false, { srgb: false });
            expect(rm.createTextureFromBytes).toHaveBeenLastCalledWith(4, 4, pixels, 1, false, TextureContent.Asset);
        } finally { host.manager = rm; }
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
