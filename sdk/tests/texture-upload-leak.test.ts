// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    texture-upload-leak.test.ts
 * @brief   A GL texture created during upload must be released if the upload
 *          throws (lost context / bad source), and gl.createTexture() returning
 *          null must not be `!`-asserted into the upload calls — otherwise each
 *          failed upload leaks a GL texture.
 */
import { describe, expect, it, vi } from 'vitest';
import { TextureLoader } from '../src/asset/loaders/TextureLoader';
import { uploadRgbaTexture } from '../src/asset/compressed';

function mockGl(opts?: { createReturnsNull?: boolean; throwOnUpload?: boolean }) {
    const tex = { __tex: true };
    const gl: any = {
        TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
        TEXTURE_MIN_FILTER: 0, TEXTURE_MAG_FILTER: 0, TEXTURE_WRAP_S: 0, TEXTURE_WRAP_T: 0,
        LINEAR: 0x2601, NEAREST: 0x2600, LINEAR_MIPMAP_LINEAR: 0, NEAREST_MIPMAP_NEAREST: 0,
        REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812f, MIRRORED_REPEAT: 0x8370,
        UNPACK_FLIP_Y_WEBGL: 0, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0,
        createTexture: vi.fn(() => (opts?.createReturnsNull ? null : tex)),
        bindTexture: vi.fn(),
        pixelStorei: vi.fn(),
        texImage2D: vi.fn(() => { if (opts?.throwOnUpload) throw new Error('GL upload failed'); }),
        compressedTexImage2D: vi.fn(() => { if (opts?.throwOnUpload) throw new Error('GL upload failed'); }),
        texParameteri: vi.fn(),
        generateMipmap: vi.fn(),
        deleteTexture: vi.fn(),
    };
    return { gl, tex };
}

describe('TextureLoader.createTextureWebGL2', () => {
    it('throws clearly when gl.createTexture() returns null (no `!` assert)', () => {
        const loader = new TextureLoader({} as any);
        const { gl } = mockGl({ createReturnsNull: true });
        expect(() => (loader as any).createTextureWebGL2(gl, {} as any, 4, 4, true))
            .toThrow(/createTexture\(\) returned null/);
    });

    it('releases the GL texture when the upload throws (no leak)', () => {
        const loader = new TextureLoader({} as any);
        const { gl, tex } = mockGl({ throwOnUpload: true });
        expect(() => (loader as any).createTextureWebGL2(gl, {} as any, 4, 4, true))
            .toThrow(/GL upload failed/);
        expect(gl.deleteTexture).toHaveBeenCalledWith(tex);
    });
});

describe('compressed uploadRgbaTexture', () => {
    it('releases the GL texture when the upload throws (no leak)', () => {
        const { gl, tex } = mockGl({ throwOnUpload: true });
        const r = { width: 4, height: 4, data: new Uint8Array(64) };
        expect(() => uploadRgbaTexture(gl, {} as any, r as any))
            .toThrow(/GL upload failed/);
        expect(gl.deleteTexture).toHaveBeenCalledWith(tex);
    });
});
