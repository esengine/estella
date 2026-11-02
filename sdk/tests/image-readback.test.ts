// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A decoded bitmap is read back through a texture, not a 2D canvas: a canvas keeps its pixels premultiplied, so the colour of a texel whose alpha is clear
 *        (a weight map the ground is mixed by) is gone by the time it is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let canvasKind: string[] = [];

const gl = {
    MAX_TEXTURE_SIZE: 1, TEXTURE_2D: 2, UNPACK_FLIP_Y_WEBGL: 3, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 4, UNPACK_COLORSPACE_CONVERSION_WEBGL: 5,
    NONE: 6, RGBA: 7, UNSIGNED_BYTE: 8, FRAMEBUFFER: 9, COLOR_ATTACHMENT0: 10, FRAMEBUFFER_COMPLETE: 11, NO_ERROR: 0,
    getParameter: () => 4096,
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    bindTexture: () => {},
    bindFramebuffer: () => {},
    pixelStorei: (name: number, value: unknown) => { calls.push(`pixelStorei ${name} ${String(value)}`); },
    texImage2D: () => { calls.push('texImage2D'); },
    framebufferTexture2D: () => {},
    checkFramebufferStatus: () => 11,
    // the texel a canvas would have lost: red under a clear alpha
    readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, out: Uint8Array) => { out.set([255, 0, 0, 0]); calls.push('readPixels'); },
    getError: () => 0,
    deleteFramebuffer: () => {},
    deleteTexture: () => {},
};

vi.mock('../src/platform/base', () => ({
    platformCreateCanvas: () => ({
        width: 0,
        height: 0,
        getContext: (kind: string) => {
            canvasKind.push(kind);
            if (kind === 'webgl2') return gl;
            return { drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }) };
        },
    }),
}));

import { readImagePixels } from '../src/asset/imageDecode';

class FakeBitmap { constructor(readonly width: number, readonly height: number) {} close(): void {} }

describe('reading a decoded bitmap', () => {
    beforeEach(() => { calls.length = 0; canvasKind = []; vi.stubGlobal('ImageBitmap', FakeBitmap); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('keeps the colour of a texel whose alpha is clear', () => {
        const read = readImagePixels(new FakeBitmap(1, 1) as unknown as ImageBitmap);
        expect([...read.pixels]).toEqual([255, 0, 0, 0]);
        expect(canvasKind).not.toContain('2d');
    });

    it('uploads it unpremultiplied and without a colour conversion', () => {
        readImagePixels(new FakeBitmap(1, 1) as unknown as ImageBitmap);
        expect(calls).toContain('pixelStorei 4 false');
        expect(calls).toContain('pixelStorei 5 6');
        expect(calls.indexOf('texImage2D')).toBeLessThan(calls.indexOf('readPixels'));
    });
});
