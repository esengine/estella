// SPDX-License-Identifier: Apache-2.0
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
import { handOverNewTexture } from '../src/asset/glTextureUpload';
import { TextureContent, type CppResourceManager, type ESEngineModule } from '../src/wasm';

function mockGl(opts?: { createReturnsNull?: boolean; throwOnUpload?: boolean }) {
    const tex = { __tex: true };
    const gl: any = {
        TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
        TEXTURE_MIN_FILTER: 0, TEXTURE_MAG_FILTER: 0, TEXTURE_WRAP_S: 0, TEXTURE_WRAP_T: 0,
        LINEAR: 0x2601, NEAREST: 0x2600, LINEAR_MIPMAP_LINEAR: 0, NEAREST_MIPMAP_NEAREST: 0,
        REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812f, MIRRORED_REPEAT: 0x8370,
        UNPACK_FLIP_Y_WEBGL: 0, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0,
        TEXTURE_BINDING_2D: 0x8069,
        createTexture: vi.fn(() => (opts?.createReturnsNull ? null : tex)),
        bindTexture: vi.fn(),
        getParameter: vi.fn(() => null),
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
    it('throws clearly when the context gives no texture (no `!` assert)', () => {
        const loader = new TextureLoader({} as any);
        const { gl } = mockGl({ createReturnsNull: true });
        expect(() => (loader as any).createTextureWebGL2(gl, {} as any, 4, 4, true))
            .toThrow(/gave no texture/);
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

it.each(['throw', 'invalid handle'])('reclaims a GL texture and its table entry when pool registration returns %s', outcome => {
    const { gl, tex } = mockGl();
    const table: Record<number, WebGLTexture> = {};
    const module = { GL: { textures: table, getNewId: () => 9 } } as unknown as ESEngineModule;
    const owner = { registerExternalTexture: () => {
        if (outcome === 'throw') throw new Error('pool retired');
        return 0;
    } } as unknown as CppResourceManager;
    const upload = () => handOverNewTexture(module, gl, () => {}, { width: 4, height: 4, content: TextureContent.AtlasPage }, owner);
    if (outcome === 'throw') expect(upload).toThrow('pool retired');
    else expect(upload()).toBe(0);
    expect(table[9]).toBeUndefined();
    expect(gl.deleteTexture.mock.calls).toEqual([[tex]]);
});
