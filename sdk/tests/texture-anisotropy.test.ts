// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { applyBoundTextureSampling } from '../src/asset/glTextureUpload';

const TEXTURE_MAX_ANISOTROPY = 0x84fe;
const MAX_TEXTURE_MAX_ANISOTROPY = 0x84ff;

function makeGl(device: number | null) {
    return {
        TEXTURE_2D: 0x0de1, NEAREST: 0x2600, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, NEAREST_MIPMAP_NEAREST: 0x2700,
        CLAMP_TO_EDGE: 0x812f, MIRRORED_REPEAT: 0x8370, REPEAT: 0x2901,
        TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE_MAX_LEVEL: 0x813d,
        texParameteri: vi.fn(),
        texParameterf: vi.fn(),
        generateMipmap: vi.fn(),
        getExtension: vi.fn((name: string) => (name === 'EXT_texture_filter_anisotropic' && device !== null
            ? { TEXTURE_MAX_ANISOTROPY_EXT: TEXTURE_MAX_ANISOTROPY, MAX_TEXTURE_MAX_ANISOTROPY_EXT: MAX_TEXTURE_MAX_ANISOTROPY } : null)),
        getParameter: vi.fn((name: number) => (name === MAX_TEXTURE_MAX_ANISOTROPY ? device : null)),
    };
}

const slant = (gl: ReturnType<typeof makeGl>): unknown[] | undefined => gl.texParameterf.mock.calls.find((c) => c[1] === TEXTURE_MAX_ANISOTROPY);

describe('a texture seen at a slant', () => {
    it('takes the extra samples a mipmapped, linear texture can use, up to sixteen', () => {
        const wide = makeGl(32);
        applyBoundTextureSampling(wide as never, { mipmaps: true });
        expect(slant(wide)).toEqual([0x0de1, TEXTURE_MAX_ANISOTROPY, 16]);
        const narrow = makeGl(8);
        applyBoundTextureSampling(narrow as never, { levels: 6 });
        expect(slant(narrow)).toEqual([0x0de1, TEXTURE_MAX_ANISOTROPY, 8]);
    });

    it('takes none where it has no mipmaps or is read to the nearest texel', () => {
        const flat = makeGl(16);
        applyBoundTextureSampling(flat as never, { mipmaps: false });
        expect(slant(flat)?.[2]).toBe(1);
        const blocky = makeGl(16);
        applyBoundTextureSampling(blocky as never, { filter: 'nearest', mipmaps: true });
        expect(slant(blocky)?.[2]).toBe(1);
    });

    it('asks the device once for each context', () => {
        const gl = makeGl(16);
        applyBoundTextureSampling(gl as never, { mipmaps: true });
        applyBoundTextureSampling(gl as never, { mipmaps: true });
        expect(gl.getExtension).toHaveBeenCalledTimes(1);
        expect(gl.texParameterf).toHaveBeenCalledTimes(2);
    });

    it('is left alone where the device has no such thing, or the context cannot be asked', () => {
        const without = makeGl(null);
        applyBoundTextureSampling(without as never, { mipmaps: true });
        expect(without.texParameterf).not.toHaveBeenCalled();
        const { getExtension: _gone, ...bare } = makeGl(16);
        expect(() => applyBoundTextureSampling(bare as never, { mipmaps: true })).not.toThrow();
        expect(bare.texParameterf).not.toHaveBeenCalled();
    });
});
