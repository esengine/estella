// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Compressed-texture loading (KTX2 / Basis Universal).
 *
 * Decoded textures stay GPU-compressed in VRAM (4–8× smaller than RGBA8), the key
 * constraint on mobile. The actual transcode is done by a wasm side-module behind
 * the {@link BasisTranscoder} seam; this module owns the device
 * capability probe, the format choice, and the WebGL upload — all testable without
 * the wasm.
 *
 * Upload is JS-direct (`gl.compressedTexImage2D`) to mirror the existing
 * `TextureLoader` PNG path, and because WebGL compressed-texture extensions must be
 * enabled JS-side via `getExtension`. The C++ `GfxDevice::compressedTexImage2D`
 * entry backs the non-WebGL2 fallback path instead.
 */
import type { ESEngineModule } from '../wasm';
import { requireResourceManager } from '../wasm/resourceManager';
import { glWrapMode } from './glTexParams';

// =============================================================================
// Format vocabulary
// =============================================================================

/**
 * GPU compressed formats the transcoder can target, mirroring the C++
 * `GfxCompressedFormat`. ASTC is best quality/size, ETC2 is the WebGL2 baseline,
 * S3TC covers desktop GPUs.
 */
export enum CompressedTextureFormat {
    ETC2_RGBA8 = 'etc2-rgba8',
    ASTC_4x4 = 'astc-4x4',
    S3TC_DXT5 = 's3tc-dxt5',
}

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** True if `bytes` begins with the 12-byte KTX2 file identifier. */
export function isKtx2(bytes: Uint8Array): boolean {
    if (bytes.length < KTX2_IDENTIFIER.length) return false;
    for (let i = 0; i < KTX2_IDENTIFIER.length; i++) {
        if (bytes[i] !== KTX2_IDENTIFIER[i]) return false;
    }
    return true;
}

/** True if `path` names a KTX2 container: its own extension, or the
 *  `.ktx2.bin` spelling the WeChat export stages (WeChat's code-package
 *  suffix whitelist has no `ktx2`; `bin` is whitelisted, and the compound
 *  suffix keeps the container's identity in the name). */
export function isKtx2Path(path: string): boolean {
    const p = path.toLowerCase();
    return p.endsWith('.ktx2') || p.endsWith('.ktx2.bin');
}

// =============================================================================
// Transcoder seam
// =============================================================================

export interface TranscodeResult {
    readonly width: number;
    readonly height: number;
    /** GPU-ready compressed block data for the requested format. */
    readonly data: Uint8Array;
}

export interface RgbaResult {
    readonly width: number;
    readonly height: number;
    /** width*height*4 RGBA8 bytes. */
    readonly data: Uint8Array;
}

/**
 * Decodes a KTX2/Basis container into GPU-ready bytes. The concrete implementation
 * is a wasm side-module injected behind this interface, so the loader
 * decision logic stays unit-testable without it.
 */
export interface BasisTranscoder {
    /** Transcode to a device-supported compressed format, or null if it cannot. */
    transcode(ktx2: Uint8Array, target: CompressedTextureFormat): TranscodeResult | null;
    /** Decode to uncompressed RGBA8 — the universal fallback. */
    transcodeToRgba(ktx2: Uint8Array): RgbaResult | null;
}

// =============================================================================
// Device capability probe
// =============================================================================

// Minimal shapes for the extension constants we read — robust to lib.dom not
// typing every getExtension overload (some omit the ETC one). The ASTC/ETC
// extensions expose their sRGB variants on the same object; S3TC splits sRGB
// into a separate extension (WEBGL_compressed_texture_s3tc_srgb).
interface AstcExt {
    readonly COMPRESSED_RGBA_ASTC_4x4_KHR: number;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR: number;
}
interface EtcExt {
    readonly COMPRESSED_RGBA8_ETC2_EAC: number;
    readonly COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: number;
}
interface S3tcExt { readonly COMPRESSED_RGBA_S3TC_DXT5_EXT: number }
interface S3tcSrgbExt { readonly COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: number }

export interface CompressedTextureSupport {
    readonly astc: AstcExt | null;
    readonly etc: EtcExt | null;
    readonly s3tc: S3tcExt | null;
    readonly s3tcSrgb: S3tcSrgbExt | null;
}

/**
 * Probes — and, crucially, *enables* — the WebGL compressed-texture extensions.
 * `getExtension` is the only way to turn an extension on, so this must run before
 * any `compressedTexImage2D` with a non-core format.
 */
export function detectCompressedTextureSupport(gl: WebGL2RenderingContext): CompressedTextureSupport {
    return {
        astc: gl.getExtension('WEBGL_compressed_texture_astc') as AstcExt | null,
        etc: gl.getExtension('WEBGL_compressed_texture_etc') as EtcExt | null,
        s3tc: gl.getExtension('WEBGL_compressed_texture_s3tc') as S3tcExt | null,
        s3tcSrgb: gl.getExtension('WEBGL_compressed_texture_s3tc_srgb') as S3tcSrgbExt | null,
    };
}

/**
 * Best available target in quality/size order: ASTC > ETC2 > S3TC. null = none.
 * With `srgb` (linear pipeline) a format only qualifies when its sRGB variant is
 * uploadable — S3TC needs the separate s3tc_srgb extension; ASTC/ETC2 sRGB ride
 * the same extension as their UNORM twins. The transcoded block data is
 * identical either way; only the sampling interpretation differs.
 */
export function chooseTargetFormat(
    support: CompressedTextureSupport, srgb = false,
): CompressedTextureFormat | null {
    if (support.astc) return CompressedTextureFormat.ASTC_4x4;
    if (support.etc) return CompressedTextureFormat.ETC2_RGBA8;
    if (srgb ? support.s3tcSrgb : support.s3tc) return CompressedTextureFormat.S3TC_DXT5;
    return null;
}

/** WebGL `internalformat` enum for a chosen format, from its enabling extension. */
export function glInternalFormat(
    support: CompressedTextureSupport, fmt: CompressedTextureFormat, srgb = false,
): number | null {
    switch (fmt) {
        case CompressedTextureFormat.ASTC_4x4:
            if (!support.astc) return null;
            return srgb ? support.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR
                        : support.astc.COMPRESSED_RGBA_ASTC_4x4_KHR;
        case CompressedTextureFormat.ETC2_RGBA8:
            if (!support.etc) return null;
            return srgb ? support.etc.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
                        : support.etc.COMPRESSED_RGBA8_ETC2_EAC;
        case CompressedTextureFormat.S3TC_DXT5:
            if (srgb) return support.s3tcSrgb ? support.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT : null;
            return support.s3tc ? support.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT : null;
    }
    return null;
}

// =============================================================================
// Upload
// =============================================================================

export interface CompressedUploadOptions {
    readonly filter?: 'linear' | 'nearest';
    readonly wrap?: 'repeat' | 'clamp' | 'mirror';
    /** Linear pipeline: store sRGB-encoded so the sampler linearizes in hardware. */
    readonly srgb?: boolean;
}

export interface UploadedTexture {
    readonly handle: number;
    readonly width: number;
    readonly height: number;
}

function applyParams(gl: WebGL2RenderingContext, opts?: CompressedUploadOptions): void {
    // Single-level textures: never select a mipmap min-filter (would be incomplete).
    const mag = opts?.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const min = mag;
    const wrap = glWrapMode(gl, opts?.wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

/**
 * Register an uploaded GL texture with the C++ pool. `gpuBytes` is the actual
 * VRAM size for the eviction budget — compressed formats are 4–8× smaller than
 * the pool's RGBA8 estimate, so billing them at the estimate would squat on
 * most of the budget. 0 keeps the estimate (RGBA8 uploads, where it's exact).
 */
function registerGlTexture(
    module: ESEngineModule, texture: WebGLTexture,
    width: number, height: number, gpuBytes = 0,
): number {
    const glObj = module.GL;
    const id = glObj.getNewId(glObj.textures);
    glObj.textures[id] = texture;
    const rm = requireResourceManager();
    // Older wasm builds / minimal mocks lack the sized variant — fall back to
    // the estimate rather than fail the upload.
    if (gpuBytes > 0 && typeof rm.registerExternalTextureSized === 'function') {
        return rm.registerExternalTextureSized(id, width, height, gpuBytes);
    }
    return rm.registerExternalTexture(id, width, height);
}

/** Upload pre-transcoded compressed blocks via `gl.compressedTexImage2D`. */
export function uploadCompressedTexture(
    gl: WebGL2RenderingContext, module: ESEngineModule,
    support: CompressedTextureSupport, fmt: CompressedTextureFormat,
    t: TranscodeResult, opts?: CompressedUploadOptions,
): UploadedTexture {
    const internalFormat = glInternalFormat(support, fmt, opts?.srgb ?? false);
    if (internalFormat == null) throw new Error(`compressed upload: no GL internalformat for ${fmt}`);
    const texture = gl.createTexture();
    if (!texture) throw new Error('compressed upload: gl.createTexture failed');
    try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, internalFormat, t.width, t.height, 0, t.data);
        applyParams(gl, opts);
    } catch (err) {
        // Release the GL texture if the upload throws — don't leak it.
        gl.deleteTexture(texture);
        throw err;
    }
    return {
        handle: registerGlTexture(module, texture, t.width, t.height, t.data.byteLength),
        width: t.width, height: t.height,
    };
}

/** Fallback: upload decoded RGBA8 via `gl.texImage2D`. */
export function uploadRgbaTexture(
    gl: WebGL2RenderingContext, module: ESEngineModule, r: RgbaResult, opts?: CompressedUploadOptions,
): UploadedTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('rgba upload: gl.createTexture failed');
    try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Linear pipeline: the decoded pixels are sRGB-encoded color, same as
        // the PNG path — store them in an sRGB format so sampling linearizes.
        const internalFormat = opts?.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA;
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, r.width, r.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, r.data);
        applyParams(gl, opts);
    } catch (err) {
        // Release the GL texture if the upload throws — don't leak it.
        gl.deleteTexture(texture);
        throw err;
    }
    return { handle: registerGlTexture(module, texture, r.width, r.height), width: r.width, height: r.height };
}

// =============================================================================
// Orchestration (the compressed-vs-fallback decision — the testable core)
// =============================================================================

/**
 * Load a KTX2 buffer into a GPU texture: prefer a device-supported compressed
 * format, fall back to RGBA8 when none is available or the compressed transcode
 * fails. Throws only if even the RGBA decode fails (a corrupt/unsupported file).
 */
export function loadCompressedTexture(
    gl: WebGL2RenderingContext, module: ESEngineModule,
    transcoder: BasisTranscoder, bytes: Uint8Array, opts?: CompressedUploadOptions,
): UploadedTexture {
    const support = detectCompressedTextureSupport(gl);
    const target = chooseTargetFormat(support, opts?.srgb ?? false);
    if (target !== null) {
        const t = transcoder.transcode(bytes, target);
        if (t) return uploadCompressedTexture(gl, module, support, target, t, opts);
        // transcode to the chosen format failed → fall through to RGBA.
    }
    const rgba = transcoder.transcodeToRgba(bytes);
    if (!rgba) throw new Error('BasisTranscoder failed to decode KTX2 (compressed and RGBA paths both failed)');
    return uploadRgbaTexture(gl, module, rgba, opts);
}
