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
import { applyBoundTextureSampling } from './glTextureUpload';

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
 * The C++ `GfxCompressedFormat` ordinal for each target, as [unorm, sRGB].
 *
 * Asking the ENGINE which formats it samples is the only question both backends
 * answer; WebGL extensions are one backend's answer, and on the other one that
 * answer is "none", which is how a compressed texture became a white placeholder.
 */
const ENGINE_FORMAT_CODE: Record<CompressedTextureFormat, readonly [number, number]> = {
    [CompressedTextureFormat.ETC2_RGBA8]: [1, 6],
    [CompressedTextureFormat.ASTC_4x4]: [2, 7],
    [CompressedTextureFormat.S3TC_DXT5]: [5, 8],
};

/** The engine's ordinal for `format` under the running colour pipeline. */
export function engineFormatCode(format: CompressedTextureFormat, srgb: boolean): number {
    return ENGINE_FORMAT_CODE[format][srgb ? 1 : 0];
}

/**
 * Quality/size order: ASTC (best), ETC2 (the WebGL2 baseline), S3TC (desktop).
 *
 * ONE list. The GL path and the engine-upload path ask different oracles about
 * the same device; a second ordering would let a texture land in a different
 * format depending on which backend loaded it.
 */
export const TARGET_PREFERENCE: readonly CompressedTextureFormat[] = [
    CompressedTextureFormat.ASTC_4x4,
    CompressedTextureFormat.ETC2_RGBA8,
    CompressedTextureFormat.S3TC_DXT5,
];

/** Best target the ENGINE says it can sample, in {@link TARGET_PREFERENCE} order. */
export function chooseEngineTargetFormat(
    supports: (code: number) => boolean, srgb = false,
): CompressedTextureFormat | null {
    for (const f of TARGET_PREFERENCE) if (supports(engineFormatCode(f, srgb))) return f;
    return null;
}

/**
 * Best available target in {@link TARGET_PREFERENCE} order. null = none.
 * With `srgb` (linear pipeline) a format only qualifies when its sRGB variant is
 * uploadable — S3TC needs the separate s3tc_srgb extension; ASTC/ETC2 sRGB ride
 * the same extension as their UNORM twins. The transcoded block data is
 * identical either way; only the sampling interpretation differs, which is why
 * "can this be uploaded" IS whether an internalformat exists for it.
 */
export function chooseTargetFormat(
    support: CompressedTextureSupport, srgb = false,
): CompressedTextureFormat | null {
    for (const f of TARGET_PREFERENCE) if (glInternalFormat(support, f, srgb) !== null) return f;
    return null;
}

/** Every target this device samples, best first — the capability, not a choice. */
export function supportedTargetFormats(
    supports: (f: CompressedTextureFormat) => boolean,
): CompressedTextureFormat[] {
    return TARGET_PREFERENCE.filter(supports);
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
    // Single-level textures: never select a mipmap min-filter (would be
    // incomplete) and never generate a chain — which is exactly what the shared
    // sampler state does when told there are no mipmaps.
    applyBoundTextureSampling(gl, { filter: opts?.filter, wrap: opts?.wrap, mipmaps: false });
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

/** What a texture ended up as on the GPU. */
export type UploadedGpuFormat = CompressedTextureFormat | 'rgba8';

/**
 * Why an upload landed on the format it did.
 *
 * `uncompressed-payload` is not a fallback — an ordinary image asked for
 * nothing. The other three each name a different thing to change: the DEVICE
 * samples none, the FILE would not transcode, or its size is not whole blocks.
 */
export type TextureUploadReason =
    | 'compressed'
    | 'no-device-format'
    | 'transcode-failed'
    | 'not-block-aligned'
    | 'uncompressed-payload';

/**
 * What one texture upload did with a cooked payload, on THIS device.
 *
 * The second half; the first is what the build shipped
 * (pipeline/src/assets/textureCookDecision.ts). Kept apart because a cook that
 * shipped raw is a build setting and a device that decoded it is a device.
 */
export interface TextureUploadDecision {
    /** What arrived: a transcodable container, or a plain image. */
    readonly payload: 'ktx2' | 'raw';
    /** The best format this device offered for it; null when it offered none. */
    readonly target: CompressedTextureFormat | null;
    readonly effective: UploadedGpuFormat;
    readonly reason: TextureUploadReason;
}

/** The decision a compressed payload came to, given the device's answer and
 *  whether the transcode to it worked. Pure — the three cases hold without a
 *  GL context, a device or the basis module. */
export function compressedUploadDecision(
    target: CompressedTextureFormat | null, transcoded: boolean,
): TextureUploadDecision {
    if (target === null) {
        return { payload: 'ktx2', target: null, effective: 'rgba8', reason: 'no-device-format' };
    }
    if (!transcoded) {
        return { payload: 'ktx2', target, effective: 'rgba8', reason: 'transcode-failed' };
    }
    return { payload: 'ktx2', target, effective: target, reason: 'compressed' };
}

/** The target an engine ordinal names, or null when it names none of the three
 *  (an RGBA upload, or a format no loader targets). */
export function formatFromEngineCode(code: number): CompressedTextureFormat | null {
    for (const f of TARGET_PREFERENCE) {
        const [unorm, srgb] = ENGINE_FORMAT_CODE[f];
        if (code === unorm || code === srgb) return f;
    }
    return null;
}

/**
 * What a native host's own KTX2 upload came to.
 *
 * `format` is the engine ordinal it uploaded, negative when it decoded to RGBA.
 * `blockRefused` separates the two ways that happens — an image that was not
 * whole blocks, or a device that offered nothing. Only the first is the asset's.
 */
export function hostUploadDecision(format: number, blockRefused: boolean): TextureUploadDecision {
    const target = formatFromEngineCode(format);
    if (target) return { payload: 'ktx2', target, effective: target, reason: 'compressed' };
    return {
        payload: 'ktx2', target: null, effective: 'rgba8',
        reason: blockRefused ? 'not-block-aligned' : 'no-device-format',
    };
}

/** A texture that was never a compressed payload — an ordinary image upload. */
export const RAW_PAYLOAD_UPLOAD: TextureUploadDecision = {
    payload: 'raw', target: null, effective: 'rgba8', reason: 'uncompressed-payload',
};

export interface LoadedCompressedTexture extends UploadedTexture {
    /** What this upload came to, and why — the fallback is otherwise an
     *  else-branch that counts nothing. */
    readonly decision: TextureUploadDecision;
}

/**
 * Load a KTX2 buffer into a GPU texture: prefer a device-supported compressed
 * format, fall back to RGBA8 when none is available or the compressed transcode
 * fails. Throws only if even the RGBA decode fails (a corrupt/unsupported file).
 */
export function loadCompressedTexture(
    gl: WebGL2RenderingContext, module: ESEngineModule,
    transcoder: BasisTranscoder, bytes: Uint8Array, opts?: CompressedUploadOptions,
): LoadedCompressedTexture {
    const support = detectCompressedTextureSupport(gl);
    const target = chooseTargetFormat(support, opts?.srgb ?? false);
    const t = target !== null ? transcoder.transcode(bytes, target) : null;
    const decision = compressedUploadDecision(target, t !== null);
    if (target !== null && t) {
        return { ...uploadCompressedTexture(gl, module, support, target, t, opts), decision };
    }
    const rgba = transcoder.transcodeToRgba(bytes);
    if (!rgba) throw new Error('BasisTranscoder failed to decode KTX2 (compressed and RGBA paths both failed)');
    return { ...uploadRgbaTexture(gl, module, rgba, opts), decision };
}
