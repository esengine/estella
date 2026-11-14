// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    image-fetch-decode.test.ts
 * @brief   A texture is decoded from its fetched bytes, off the page's thread.
 *
 *          A bitmap made from an `<img>` is decoded on the page's thread: a scene's
 *          4K sky held the editor for over a second at open. fetchImageBitmap makes
 *          it from a Blob with the same options the element path uses, and answers
 *          null whenever it cannot, so the loader falls back to the element.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchImageBitmap, imageBitmapOptions } from '../src/asset/imageDecode';

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchImageBitmap', () => {
    it('decodes the fetched Blob with the canonical options', async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3])]);
        const bitmap = { width: 4, height: 2 };
        const decode = vi.fn(async () => bitmap);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })));
        vi.stubGlobal('createImageBitmap', decode);
        expect(await fetchImageBitmap('estella://project/a.png', true)).toBe(bitmap);
        expect(decode).toHaveBeenCalledWith(blob, imageBitmapOptions(true));
    });

    it('answers null when the bytes cannot be had or decoded, so the element path runs', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('svg'); }));
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
        expect(await fetchImageBitmap('missing.png', false)).toBeNull();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        expect(await fetchImageBitmap('a.png', false)).toBeNull();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([]) })));
        expect(await fetchImageBitmap('a.svg', false)).toBeNull();
    });

    it('answers null on a host with no fetch (a mini-game)', async () => {
        vi.stubGlobal('fetch', undefined);
        expect(await fetchImageBitmap('a.png', false)).toBeNull();
    });
});
