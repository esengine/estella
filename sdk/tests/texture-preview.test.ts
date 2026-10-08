// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    draw: vi.fn(),
    read: vi.fn((_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
    })),
    upload: vi.fn(() => 42),
}));
vi.mock('../src/platform/base', () => ({
    platformCreateCanvas: (width: number, height: number) => ({
        width, height, getContext: () => ({ drawImage: mocks.draw, getImageData: mocks.read }),
    }),
}));
vi.mock('../src/wasm/resourceManager', () => ({ requireResourceManager: () => ({}) }));
vi.mock('../src/runtime/runtimeAssets', () => ({ createTextureFromPixels: mocks.upload }));

import { readImagePixels } from '../src/asset/imageDecode';
import { TextureLoader } from '../src/asset/loaders/TextureLoader';
import type { LoadContext } from '../src/asset/AssetLoader';
import type { PlatformImage } from '../src/platform/types';

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
});
