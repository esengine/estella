// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadContext } from '../src/asset/AssetLoader';

const state = vi.hoisted(() => ({
    elements: [] as string[],
    upload: vi.fn((_w: number, _h: number, _pixels: Uint8Array, _format: number, _flip: boolean) => 17),
}));
class ImageFake {
    width = 640;
    height = 320;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    set src(url: string) {
        state.elements.push(url);
        queueMicrotask(() => this.onload?.());
    }
}
vi.mock('../src/platform/base', () => ({
    platformCreateImage: () => new ImageFake(),
    platformCreateCanvas: (width: number, height: number) => ({
        width, height, getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }) }),
    }),
}));
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ createTextureFromBytes: state.upload, registerTextureWithPath: vi.fn(), adoptTextureContent: vi.fn() }),
}));
import { imageBitmapOptions } from '../src/asset/imageDecode';
import { TextureLoader } from '../src/asset/loaders/TextureLoader';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);
const context = { catalog: { getBuildPath: (p: string) => p } } as unknown as LoadContext;

interface Sized { width: number; height: number }
type Decode = (source: unknown, options?: ImageBitmapOptions) => Promise<Sized>;

function loader() {
    const result = new TextureLoader(null);
    const internal = result as unknown as { createTextureFromImage(image: Sized): { handle: number; width: number; height: number } };
    vi.spyOn(internal, 'createTextureFromImage').mockImplementation(image => ({ handle: 1, width: image.width, height: image.height }));
    result.setCompressedSource(async () => PNG);
    return result;
}

function stubDecode(fromBlob: () => Promise<Sized>) {
    const decode = vi.fn<Decode>(async (source, options) => {
        if (source instanceof Blob) return fromBlob();
        if (options?.resizeWidth) return { width: options.resizeWidth, height: options.resizeHeight! };
        const sized = source as Sized;
        return { width: sized.width, height: sized.height };
    });
    vi.stubGlobal('createImageBitmap', decode);
    return decode;
}

describe('a texture whose encoded bytes are already in memory', () => {
    let fetched: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        state.elements.length = 0;
        fetched = vi.fn(async (url: unknown) => {
            throw new TypeError(`Refused to connect to '${String(url)}': connect-src 'self' ws: estella:`);
        });
        vi.stubGlobal('fetch', fetched);
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('is decoded from a Blob of those bytes, with no fetch and no element', async () => {
        const decode = stubDecode(async () => ({ width: 2048, height: 1024 }));
        const made = await loader().load('panel.png', context);
        expect([made.width, made.height]).toEqual([2048, 1024]);
        expect(fetched).not.toHaveBeenCalled();
        expect(state.elements).toEqual([]);
        expect(decode).toHaveBeenCalledTimes(1);
        const [source, options] = decode.mock.calls[0]!;
        expect(source).toBeInstanceOf(Blob);
        expect(new Uint8Array(await (source as Blob).arrayBuffer())).toEqual(PNG);
        expect(options).toEqual(imageBitmapOptions(true));
    });

    it('is held no larger than asked and still says the size it was made from', async () => {
        stubDecode(async () => ({ width: 2048, height: 1024 }));
        const textures = loader();
        textures.setPendingStartEdge(512);
        const made = await textures.load('panel.png', context);
        expect([made.width, made.height]).toEqual([512, 256]);
        expect(textures.fullSize(made.handle)).toEqual({ width: 2048, height: 1024 });
        expect(fetched).not.toHaveBeenCalled();
        expect(state.elements).toEqual([]);
    });

    it('goes through an element when the Blob cannot be decoded, still without a fetch', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        stubDecode(async () => { throw new Error('undecodable'); });
        const made = await loader().load('panel.png', context);
        expect([made.width, made.height]).toEqual([640, 320]);
        expect(fetched).not.toHaveBeenCalled();
        expect(state.elements).toHaveLength(1);
        expect(state.elements[0]).toMatch(/^blob:/);
        expect(revoke).toHaveBeenCalledWith(state.elements[0]);
    });

    it('goes through an element on a host with no createImageBitmap', async () => {
        vi.stubGlobal('createImageBitmap', undefined);
        const made = await loader().load('panel.png', context);
        expect([made.width, made.height]).toEqual([640, 320]);
        expect(fetched).not.toHaveBeenCalled();
        expect(state.elements).toHaveLength(1);
    });

    it.each([true, false])('fits a canvas upload when bitmap resizing is unavailable (bitmap decode %s)', async canDecode => {
        class Bitmap {
            width = 640;
            height = 320;
            close = vi.fn();
        }
        const bitmap = new Bitmap();
        vi.stubGlobal('ImageBitmap', Bitmap);
        vi.stubGlobal('createImageBitmap', canDecode ? async (source: unknown) => {
            if (source instanceof Blob) return bitmap;
            throw new Error('bitmap resizing unsupported');
        } : undefined);
        const textures = new TextureLoader(null);
        textures.setCompressedSource(async () => PNG);
        const made = await textures.load('panel.png', context, { startEdge: 63 });
        expect([made.width, made.height, made.fullWidth, made.fullHeight]).toEqual([63, 32, 640, 320]);
        const [width, height, pixels, , flip] = state.upload.mock.lastCall!;
        expect([width, height, pixels.length, flip]).toEqual([63, 32, 63 * 32 * 4, !canDecode]);
        expect(bitmap.close).toHaveBeenCalledTimes(canDecode ? 1 : 0);
    });
});
