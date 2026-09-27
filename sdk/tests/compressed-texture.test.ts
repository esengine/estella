// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { TextureContent } from '../src/wasm';
import {
    isKtx2,
    chooseTargetFormat,
    glInternalFormat,
    detectCompressedTextureSupport,
    loadCompressedTexture,
    uploadCompressedTexture,
    CompressedTextureFormat,
    type BasisTranscoder,
} from '../src/asset/compressed';

const ASTC = 0x93b0;       // COMPRESSED_RGBA_ASTC_4x4_KHR
const ETC2 = 0x9278;       // COMPRESSED_RGBA8_ETC2_EAC
const DXT5 = 0x83f3;       // COMPRESSED_RGBA_S3TC_DXT5_EXT
const ASTC_SRGB = 0x93d0;  // COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR
const ETC2_SRGB = 0x9279;  // COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
const DXT5_SRGB = 0x8c4f;  // COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
const SRGB8_ALPHA8 = 0x8c43;

function makeGl(support: { astc?: boolean; etc?: boolean; s3tc?: boolean; s3tcSrgb?: boolean } = {}) {
    const exts: Record<string, unknown> = {};
    if (support.astc) exts['WEBGL_compressed_texture_astc'] = {
        COMPRESSED_RGBA_ASTC_4x4_KHR: ASTC, COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR: ASTC_SRGB,
    };
    if (support.etc) exts['WEBGL_compressed_texture_etc'] = {
        COMPRESSED_RGBA8_ETC2_EAC: ETC2, COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: ETC2_SRGB,
    };
    if (support.s3tc) exts['WEBGL_compressed_texture_s3tc'] = { COMPRESSED_RGBA_S3TC_DXT5_EXT: DXT5 };
    if (support.s3tcSrgb) exts['WEBGL_compressed_texture_s3tc_srgb'] = { COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: DXT5_SRGB };
    return {
        TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, SRGB8_ALPHA8,
        NEAREST: 0x2600, LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f, MIRRORED_REPEAT: 0x8370, REPEAT: 0x2901,
        TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
        LINEAR_MIPMAP_LINEAR: 0x2703, NEAREST_MIPMAP_NEAREST: 0x2700, TEXTURE_MAX_LEVEL: 0x813d,
        generateMipmap: vi.fn(),
        getExtension: vi.fn((n: string) => exts[n] ?? null),
        createTexture: vi.fn(() => ({}) as WebGLTexture),
        bindTexture: vi.fn(),
        compressedTexImage2D: vi.fn(),
        texImage2D: vi.fn(),
        texParameteri: vi.fn(),
    };
}

function makeModule() {
    return { GL: { getNewId: vi.fn(() => 7), textures: {} as Record<number, WebGLTexture> } };
}

function makeTranscoder(over: Partial<BasisTranscoder> = {}): BasisTranscoder {
    return {
        transcode: vi.fn(() => ({ width: 4, height: 4, data: new Uint8Array(8) })),
        transcodeToRgba: vi.fn(() => ({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) })),
        ...over,
    };
}

const KTX2_HEADER = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let registerExternalTexture: ReturnType<typeof vi.fn>;
beforeEach(() => {
    registerExternalTexture = vi.fn(() => 42);
    initResourceManager({ registerExternalTexture } as never);
});
afterEach(() => shutdownResourceManager());

describe('KTX2 detection', () => {
    it('matches the 12-byte identifier', async () => {
        expect(isKtx2(KTX2_HEADER)).toBe(true);
    });
    it('rejects non-KTX2 / short buffers', async () => {
        expect(isKtx2(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
        expect(isKtx2(new Uint8Array(4))).toBe(false);
    });
});

describe('format capability selection', () => {
    it('prefers ASTC > ETC2 > S3TC', async () => {
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl({ astc: true, etc: true, s3tc: true }) as never)))
            .toBe(CompressedTextureFormat.ASTC_4x4);
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl({ etc: true, s3tc: true }) as never)))
            .toBe(CompressedTextureFormat.ETC2_RGBA8);
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl({ s3tc: true }) as never)))
            .toBe(CompressedTextureFormat.S3TC_DXT5);
    });
    it('returns null when no compressed extension is available', async () => {
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl() as never))).toBeNull();
    });
    it('maps each format to its enabling extension constant', async () => {
        const s = detectCompressedTextureSupport(makeGl({ astc: true, etc: true, s3tc: true }) as never);
        expect(glInternalFormat(s, CompressedTextureFormat.ASTC_4x4)).toBe(ASTC);
        expect(glInternalFormat(s, CompressedTextureFormat.ETC2_RGBA8)).toBe(ETC2);
        expect(glInternalFormat(s, CompressedTextureFormat.S3TC_DXT5)).toBe(DXT5);
    });
    it('srgb maps to the sRGB variant constants (linear pipeline)', async () => {
        const s = detectCompressedTextureSupport(
            makeGl({ astc: true, etc: true, s3tc: true, s3tcSrgb: true }) as never);
        expect(glInternalFormat(s, CompressedTextureFormat.ASTC_4x4, true)).toBe(ASTC_SRGB);
        expect(glInternalFormat(s, CompressedTextureFormat.ETC2_RGBA8, true)).toBe(ETC2_SRGB);
        expect(glInternalFormat(s, CompressedTextureFormat.S3TC_DXT5, true)).toBe(DXT5_SRGB);
    });
    it('srgb S3TC requires the separate s3tc_srgb extension', async () => {
        // Base s3tc alone cannot upload sRGB DXT blocks: no target, no internalformat.
        const s = detectCompressedTextureSupport(makeGl({ s3tc: true }) as never);
        expect(chooseTargetFormat(s, true)).toBeNull();
        expect(glInternalFormat(s, CompressedTextureFormat.S3TC_DXT5, true)).toBeNull();
        const withSrgb = detectCompressedTextureSupport(makeGl({ s3tc: true, s3tcSrgb: true }) as never);
        expect(chooseTargetFormat(withSrgb, true)).toBe(CompressedTextureFormat.S3TC_DXT5);
    });
});

describe('loadCompressedTexture', () => {
    it('uploads compressed when the device supports a format', async () => {
        const gl = makeGl({ astc: true });
        const mod = makeModule();
        const transcoder = makeTranscoder();
        const r = await loadCompressedTexture(gl as never, mod as never, transcoder, KTX2_HEADER);

        expect(transcoder.transcode).toHaveBeenCalledWith(KTX2_HEADER, CompressedTextureFormat.ASTC_4x4);
        expect(transcoder.transcodeToRgba).not.toHaveBeenCalled();
        expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(1);
        // internalformat arg = the ASTC extension constant
        expect(gl.compressedTexImage2D.mock.calls[0][2]).toBe(ASTC);
        expect(gl.texImage2D).not.toHaveBeenCalled();
        expect(registerExternalTexture).toHaveBeenCalledWith(7, 4, 4, TextureContent.Asset);
        expect(r).toEqual({
            handle: 42, width: 4, height: 4,
            decision: {
                payload: 'ktx2', target: CompressedTextureFormat.ASTC_4x4,
                effective: CompressedTextureFormat.ASTC_4x4, reason: 'compressed',
            },
        });
    });

    it('falls back to RGBA8 when no compressed format is supported', async () => {
        const gl = makeGl();  // no extensions
        const transcoder = makeTranscoder();
        const r = await loadCompressedTexture(gl as never, makeModule() as never, transcoder, KTX2_HEADER);

        expect(transcoder.transcode).not.toHaveBeenCalled();
        expect(transcoder.transcodeToRgba).toHaveBeenCalledOnce();
        expect(gl.compressedTexImage2D).not.toHaveBeenCalled();
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        expect(r.handle).toBe(42);
        // The DEVICE turned it down — nothing about the file is wrong, and the
        // fix is a build target rather than the asset.
        expect(r.decision).toEqual({
            payload: 'ktx2', target: null, effective: 'rgba8', reason: 'no-device-format',
        });
    });

    it('falls back to RGBA8 when the compressed transcode fails', async () => {
        const gl = makeGl({ etc: true });
        const transcoder = makeTranscoder({ transcode: vi.fn(() => null) });
        const r = await loadCompressedTexture(gl as never, makeModule() as never, transcoder, KTX2_HEADER);

        expect(transcoder.transcode).toHaveBeenCalledOnce();
        expect(transcoder.transcodeToRgba).toHaveBeenCalledOnce();
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        // The device DID offer a format; the payload would not become it. Reported
        // apart from "no-device-format" because only this one names the file.
        expect(r.decision).toEqual({
            payload: 'ktx2', target: CompressedTextureFormat.ETC2_RGBA8,
            effective: 'rgba8', reason: 'transcode-failed',
        });
    });

    it('throws when both compressed and RGBA decode fail', async () => {
        const gl = makeGl({ astc: true });
        const transcoder = makeTranscoder({ transcode: vi.fn(() => null), transcodeToRgba: vi.fn(() => null) });
        await expect(loadCompressedTexture(gl as never, makeModule() as never, transcoder, KTX2_HEADER)).rejects.toThrow(/failed to decode/i);
    });

    it('srgb uploads the sRGB internalformat of the chosen format', async () => {
        const gl = makeGl({ astc: true });
        await loadCompressedTexture(gl as never, makeModule() as never, makeTranscoder(), KTX2_HEADER, { srgb: true });
        expect(gl.compressedTexImage2D.mock.calls[0][2]).toBe(ASTC_SRGB);
    });

    it('srgb RGBA fallback stores SRGB8_ALPHA8', async () => {
        const gl = makeGl();  // no compressed support → RGBA path
        await loadCompressedTexture(gl as never, makeModule() as never, makeTranscoder(), KTX2_HEADER, { srgb: true });
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        expect(gl.texImage2D.mock.calls[0][2]).toBe(SRGB8_ALPHA8);
    });
});

describe('mip levels', () => {
    const minFilter = (gl: ReturnType<typeof makeGl>) =>
        gl.texParameteri.mock.calls.find((c) => c[1] === gl.TEXTURE_MIN_FILTER)?.[2];
    const maxLevel = (gl: ReturnType<typeof makeGl>) =>
        gl.texParameteri.mock.calls.find((c) => c[1] === gl.TEXTURE_MAX_LEVEL)?.[2];
    const chain = [8, 4, 2].map((w) => ({ width: w, height: w, data: new Uint8Array(w) }));

    // Every KTX2 the cook writes carries a chain; a level left behind is a texture
    // that shimmers in the distance and bytes shipped for nothing.
    it('uploads every level a compressed file carries and samples them as a chain', async () => {
        const gl = makeGl({ astc: true });
        await loadCompressedTexture(gl as never, makeModule() as never,
            makeTranscoder({ transcode: vi.fn(() => ({ ...chain[0], levels: chain })) }), KTX2_HEADER);
        expect(gl.compressedTexImage2D.mock.calls.map((c) => [c[1], c[3]])).toEqual([[0, 8], [1, 4], [2, 2]]);
        expect(minFilter(gl)).toBe(gl.LINEAR_MIPMAP_LINEAR);
        expect(maxLevel(gl)).toBe(2);
        expect(gl.generateMipmap).not.toHaveBeenCalled();
    });

    it('keeps level 0 alone when the import setting turns mipmaps off', async () => {
        const gl = makeGl({ astc: true });
        await loadCompressedTexture(gl as never, makeModule() as never,
            makeTranscoder({ transcode: vi.fn(() => ({ ...chain[0], levels: chain })) }), KTX2_HEADER, { mipmaps: false });
        expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(1);
        expect(minFilter(gl)).toBe(gl.LINEAR);
        expect(gl.generateMipmap).not.toHaveBeenCalled();
    });

    it('samples a single compressed level without mips, since none can be generated', async () => {
        const gl = makeGl({ astc: true });
        await loadCompressedTexture(gl as never, makeModule() as never, makeTranscoder(), KTX2_HEADER);
        expect(minFilter(gl)).toBe(gl.LINEAR);
        expect(maxLevel(gl)).toBeUndefined();
        expect(gl.generateMipmap).not.toHaveBeenCalled();
    });

    it('generates a chain for a single level decoded to RGBA', async () => {
        const gl = makeGl();
        await loadCompressedTexture(gl as never, makeModule() as never, makeTranscoder(), KTX2_HEADER);
        expect(minFilter(gl)).toBe(gl.LINEAR_MIPMAP_LINEAR);
        expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    });
});

describe('uploadCompressedTexture', () => {
    it('throws if the chosen format has no enabling extension', async () => {
        const gl = makeGl();  // ASTC not enabled
        const support = detectCompressedTextureSupport(gl as never);
        expect(() =>
            uploadCompressedTexture(gl as never, makeModule() as never, support, CompressedTextureFormat.ASTC_4x4,
                { width: 4, height: 4, data: new Uint8Array(8) }),
        ).toThrow(/internalformat/i);
    });
});

describe('GPU byte accounting', () => {
    let registerExternalTextureSized: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        registerExternalTextureSized = vi.fn(() => 42);
        initResourceManager({ registerExternalTexture, registerExternalTextureSized } as never);
    });

    it('books compressed uploads at their real block size, not the RGBA8 estimate', async () => {
        const gl = makeGl({ astc: true });
        // 4×4 ASTC block data is 8 bytes here vs a 64-byte RGBA8 estimate.
        await loadCompressedTexture(gl as never, makeModule() as never, makeTranscoder(), KTX2_HEADER);

        expect(registerExternalTextureSized).toHaveBeenCalledWith(7, 4, 4, 8, TextureContent.Asset);
        expect(registerExternalTexture).not.toHaveBeenCalled();
    });

    it('books the RGBA8 fallback at the estimate (which is exact for RGBA8)', async () => {
        const gl = makeGl();  // no compressed support → RGBA path
        await loadCompressedTexture(gl as never, makeModule() as never, makeTranscoder(), KTX2_HEADER);

        expect(registerExternalTexture).toHaveBeenCalledWith(7, 4, 4, TextureContent.Asset);
        expect(registerExternalTextureSized).not.toHaveBeenCalled();
    });
});
