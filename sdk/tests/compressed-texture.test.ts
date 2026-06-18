import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initResourceManager, shutdownResourceManager } from '../src/resourceManager';
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

const ASTC = 0x93b0;  // COMPRESSED_RGBA_ASTC_4x4_KHR
const ETC2 = 0x9278;  // COMPRESSED_RGBA8_ETC2_EAC
const DXT5 = 0x83f3;  // COMPRESSED_RGBA_S3TC_DXT5_EXT

function makeGl(support: { astc?: boolean; etc?: boolean; s3tc?: boolean } = {}) {
    const exts: Record<string, unknown> = {};
    if (support.astc) exts['WEBGL_compressed_texture_astc'] = { COMPRESSED_RGBA_ASTC_4x4_KHR: ASTC };
    if (support.etc) exts['WEBGL_compressed_texture_etc'] = { COMPRESSED_RGBA8_ETC2_EAC: ETC2 };
    if (support.s3tc) exts['WEBGL_compressed_texture_s3tc'] = { COMPRESSED_RGBA_S3TC_DXT5_EXT: DXT5 };
    return {
        TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
        NEAREST: 0x2600, LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f, MIRRORED_REPEAT: 0x8370, REPEAT: 0x2901,
        TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
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
    it('matches the 12-byte identifier', () => {
        expect(isKtx2(KTX2_HEADER)).toBe(true);
    });
    it('rejects non-KTX2 / short buffers', () => {
        expect(isKtx2(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
        expect(isKtx2(new Uint8Array(4))).toBe(false);
    });
});

describe('format capability selection', () => {
    it('prefers ASTC > ETC2 > S3TC', () => {
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl({ astc: true, etc: true, s3tc: true }) as never)))
            .toBe(CompressedTextureFormat.ASTC_4x4);
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl({ etc: true, s3tc: true }) as never)))
            .toBe(CompressedTextureFormat.ETC2_RGBA8);
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl({ s3tc: true }) as never)))
            .toBe(CompressedTextureFormat.S3TC_DXT5);
    });
    it('returns null when no compressed extension is available', () => {
        expect(chooseTargetFormat(detectCompressedTextureSupport(makeGl() as never))).toBeNull();
    });
    it('maps each format to its enabling extension constant', () => {
        const s = detectCompressedTextureSupport(makeGl({ astc: true, etc: true, s3tc: true }) as never);
        expect(glInternalFormat(s, CompressedTextureFormat.ASTC_4x4)).toBe(ASTC);
        expect(glInternalFormat(s, CompressedTextureFormat.ETC2_RGBA8)).toBe(ETC2);
        expect(glInternalFormat(s, CompressedTextureFormat.S3TC_DXT5)).toBe(DXT5);
    });
});

describe('loadCompressedTexture', () => {
    it('uploads compressed when the device supports a format', () => {
        const gl = makeGl({ astc: true });
        const mod = makeModule();
        const transcoder = makeTranscoder();
        const r = loadCompressedTexture(gl as never, mod as never, transcoder, KTX2_HEADER);

        expect(transcoder.transcode).toHaveBeenCalledWith(KTX2_HEADER, CompressedTextureFormat.ASTC_4x4);
        expect(transcoder.transcodeToRgba).not.toHaveBeenCalled();
        expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(1);
        // internalformat arg = the ASTC extension constant
        expect(gl.compressedTexImage2D.mock.calls[0][2]).toBe(ASTC);
        expect(gl.texImage2D).not.toHaveBeenCalled();
        expect(registerExternalTexture).toHaveBeenCalledWith(7, 4, 4);
        expect(r).toEqual({ handle: 42, width: 4, height: 4 });
    });

    it('falls back to RGBA8 when no compressed format is supported', () => {
        const gl = makeGl();  // no extensions
        const transcoder = makeTranscoder();
        const r = loadCompressedTexture(gl as never, makeModule() as never, transcoder, KTX2_HEADER);

        expect(transcoder.transcode).not.toHaveBeenCalled();
        expect(transcoder.transcodeToRgba).toHaveBeenCalledOnce();
        expect(gl.compressedTexImage2D).not.toHaveBeenCalled();
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        expect(r.handle).toBe(42);
    });

    it('falls back to RGBA8 when the compressed transcode fails', () => {
        const gl = makeGl({ etc: true });
        const transcoder = makeTranscoder({ transcode: vi.fn(() => null) });
        loadCompressedTexture(gl as never, makeModule() as never, transcoder, KTX2_HEADER);

        expect(transcoder.transcode).toHaveBeenCalledOnce();
        expect(transcoder.transcodeToRgba).toHaveBeenCalledOnce();
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    });

    it('throws when both compressed and RGBA decode fail', () => {
        const gl = makeGl({ astc: true });
        const transcoder = makeTranscoder({ transcode: vi.fn(() => null), transcodeToRgba: vi.fn(() => null) });
        expect(() => loadCompressedTexture(gl as never, makeModule() as never, transcoder, KTX2_HEADER)).toThrow(/failed to decode/i);
    });
});

describe('uploadCompressedTexture', () => {
    it('throws if the chosen format has no enabling extension', () => {
        const gl = makeGl();  // ASTC not enabled
        const support = detectCompressedTextureSupport(gl as never);
        expect(() =>
            uploadCompressedTexture(gl as never, makeModule() as never, support, CompressedTextureFormat.ASTC_4x4,
                { width: 4, height: 4, data: new Uint8Array(8) }),
        ).toThrow(/internalformat/i);
    });
});
