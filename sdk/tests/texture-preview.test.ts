// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import type { ImageLoadResult, PlatformImage } from '../src/platform/types';
import type { MiniGameGlobal, MiniGameImage } from '../src/platform/minigame/api';

const mocks = vi.hoisted(() => ({
    draw: vi.fn(),
    read: vi.fn((_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
    })),
    upload: vi.fn((_module: unknown, _image: ImageLoadResult) => 42),
}));
vi.mock('../src/platform/base', () => ({
    platformReadCacheFile: async () => null,
    platformWriteCacheFile: async () => {},
    platformCreateCanvas: (width: number, height: number) => ({
        width, height, getContext: () => ({ drawImage: mocks.draw, getImageData: mocks.read }),
    }),
}));
vi.mock('../src/wasm/resourceManager', () => ({ requireResourceManager: () => ({ adoptTextureContent: vi.fn() }) }));
vi.mock('../src/runtime/runtimeAssets', () => ({ createTextureFromPixels: mocks.upload }));

import { readImagePixels } from '../src/asset/imageDecode';
import { TextureLoader } from '../src/asset/loaders/TextureLoader';
import type { LoadContext } from '../src/asset/AssetLoader';
import { mgGetImagePixels } from '../src/platform/minigame/image';
import { setTextureRecipeDrawer } from '../src/asset/textureRecipe';

const context = { catalog: { getBuildPath: (path: string) => path } } as unknown as LoadContext;

describe('pending texture previews', () => {
    it('limits pixel readback before allocating RGBA, preserving aspect ratio without enlarging images', () => {
        const image = { width: 8192, height: 4096 } as PlatformImage;
        const preview = readImagePixels(image, 1024);
        expect([preview.width, preview.height, preview.pixels.length]).toEqual([1024, 512, 1024 * 512 * 4]);
        expect(mocks.draw).toHaveBeenLastCalledWith(image, 0, 0, 1024, 512);
        expect(readImagePixels({ width: 4, height: 2 } as PlatformImage, 1024).width).toBe(4);
    });

    it('passes the preview cap to runtime pixel providers only while compression is pending', async () => {
        const loader = new TextureLoader(null);
        const decoder = vi.fn(async (_path: string, _flip: boolean, maxEdge?: number) => ({
            width: maxEdge || 2048, height: maxEdge || 2048, pixels: new Uint8Array(4),
        }));
        loader.setPixelDecoder(decoder);
        loader.setCompressedSource(async () => 'pending');
        expect((await loader.load('color.png', {} as LoadContext)).width).toBe(1024);
        expect(decoder).toHaveBeenLastCalledWith('color.png', true, 1024);
        loader.setCompressedSource(async () => null);
        expect((await loader.load('color.png', {} as LoadContext)).width).toBe(2048);
        expect(decoder).toHaveBeenLastCalledWith('color.png', true, 0);
    });

    it('fits a whole-image decoder before upload, including color data under transparent texels', async () => {
        const pixels = Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255, 100, 0, 10, 0, 0, 40, 0, 0, 0, 80, 0, 0);
        const image = { width: 5, height: 1, pixels, sourceWidth: 10, sourceHeight: 2 };
        const loader = new TextureLoader(null);
        loader.setPixelDecoder(async () => image);
        const texture = await loader.loadRaw('weights.png', context, { startEdge: 2 });
        expect([texture.width, texture.height]).toEqual([2, 1]);
        expect(loader.fullSize(texture.handle)).toEqual({ width: 10, height: 2 });
        expect(mocks.upload.mock.lastCall![1].pixels).toEqual(Uint8Array.of(20, 0, 2, 204, 20, 48, 2, 0));
        await loader.loadRaw('weights.png', context, { startEdge: 64 });
        expect(mocks.upload.mock.lastCall![1]).toBe(image);
        await loader.loadRaw('weights.png', context);
        expect(mocks.upload.mock.lastCall![1]).toBe(image);
    });

    it('reads the fitted minigame canvas and respects the byte range of its RGBA view', () => {
        const data = new Uint8ClampedArray(24).subarray(4, 20);
        const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })) };
        const canvas = { width: 0, height: 0, getContext: () => ctx };
        const host = { createCanvas: () => canvas } as unknown as MiniGameGlobal;
        const img = { width: 3, height: 12 } as MiniGameImage;
        const result = mgGetImagePixels(host, img, 4);
        expect([canvas.width, canvas.height]).toEqual([1, 4]);
        expect(ctx.drawImage).toHaveBeenCalledWith(img, 0, 0, 1, 4);
        expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 1, 4);
        expect([result.sourceWidth, result.sourceHeight, result.pixels.byteOffset, result.pixels.byteLength]).toEqual([3, 12, 4, 16]);
    });

    it('rejects a truncated whole-image decode before a smaller upload can hide it', async () => {
        const loader = new TextureLoader(null);
        loader.setPixelDecoder(async () => ({ width: 4, height: 2, pixels: new Uint8Array(8) }));
        await expect(loader.load('incomplete.png', context, { startEdge: 2 })).rejects.toThrow(/Incomplete RGBA/);
    });

    it('fits a drawn recipe before upload and keeps its authored dimensions', async () => {
        const loader = new TextureLoader(null);
        const { installTextureRecipes } = await import('../src/image/index');
        installTextureRecipes();
        try {
            const recipe = new TextEncoder().encode(JSON.stringify({ size: [8, 4], background: '#0000ff', layers: [] }));
            const ctx = { ...context, backend: { ...context.backend, fetchBinary: async () => recipe.buffer } };
            const made = await loader.load('paint.esimage', ctx, { startEdge: 2 });
            expect([made.width, made.height, made.fullWidth, made.fullHeight]).toEqual([2, 1, 8, 4]);
            expect(mocks.upload.mock.lastCall![1].pixels).toEqual(Uint8Array.of(0, 0, 255, 255, 0, 0, 255, 255));
        } finally { setTextureRecipeDrawer(null); }
    });

    it('draws a PNG the compressed source answers with as an image, a KTX2 as a KTX2', async () => {
        const loader = new TextureLoader(null);
        const internals = loader as unknown as {
            uploadImageBytes_: (...a: unknown[]) => Promise<unknown>; uploadKtx2_: (...a: unknown[]) => Promise<unknown>;
        };
        const image = vi.spyOn(internals, 'uploadImageBytes_').mockResolvedValue({ handle: 1, width: 4, height: 4 });
        const ktx2 = vi.spyOn(internals, 'uploadKtx2_').mockResolvedValue({ handle: 2, width: 4, height: 4 });
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
        loader.setCompressedSource(async () => png);
        await loader.load('panel.png', {} as LoadContext);
        expect(image).toHaveBeenCalledTimes(1);
        expect(ktx2).not.toHaveBeenCalled();
        loader.setCompressedSource(async () => new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0, 0]));
        await loader.load('panel.png', {} as LoadContext);
        expect(ktx2).toHaveBeenCalledTimes(1);
    });
});
