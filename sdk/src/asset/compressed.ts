/**
 * Compressed-texture loading (KTX2 / Basis Universal) — RC6 Batch C.
 *
 * Decoded textures stay GPU-compressed in VRAM (4–8× smaller than RGBA8), the key
 * constraint on mobile. The actual transcode is done by a wasm side-module behind
 * the {@link BasisTranscoder} seam (Batch C3); this module owns the device
 * capability probe, the format choice, and the WebGL upload — all testable without
 * the wasm.
 *
 * Upload is JS-direct (`gl.compressedTexImage2D`) to mirror the existing
 * `TextureLoader` PNG path, and because WebGL compressed-texture extensions must be
 * enabled JS-side via `getExtension`. The C++ `GfxDevice::compressedTexImage2D`
 * entry (RC6-A) backs the non-WebGL2 fallback path instead.
 */
import type { ESEngineModule } from '../wasm';
import { requireResourceManager } from '../resourceManager';

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
 * is a wasm side-module (Batch C3) injected behind this interface, so the loader
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
// typing every getExtension overload (some omit the ETC one).
interface AstcExt { readonly COMPRESSED_RGBA_ASTC_4x4_KHR: number }
interface EtcExt { readonly COMPRESSED_RGBA8_ETC2_EAC: number }
interface S3tcExt { readonly COMPRESSED_RGBA_S3TC_DXT5_EXT: number }

export interface CompressedTextureSupport {
    readonly astc: AstcExt | null;
    readonly etc: EtcExt | null;
    readonly s3tc: S3tcExt | null;
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
    };
}

/** Best available target in quality/size order: ASTC > ETC2 > S3TC. null = none. */
export function chooseTargetFormat(support: CompressedTextureSupport): CompressedTextureFormat | null {
    if (support.astc) return CompressedTextureFormat.ASTC_4x4;
    if (support.etc) return CompressedTextureFormat.ETC2_RGBA8;
    if (support.s3tc) return CompressedTextureFormat.S3TC_DXT5;
    return null;
}

/** WebGL `internalformat` enum for a chosen format, from its enabling extension. */
export function glInternalFormat(support: CompressedTextureSupport, fmt: CompressedTextureFormat): number | null {
    switch (fmt) {
        case CompressedTextureFormat.ASTC_4x4:
            return support.astc ? support.astc.COMPRESSED_RGBA_ASTC_4x4_KHR : null;
        case CompressedTextureFormat.ETC2_RGBA8:
            return support.etc ? support.etc.COMPRESSED_RGBA8_ETC2_EAC : null;
        case CompressedTextureFormat.S3TC_DXT5:
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
    const wrap =
        opts?.wrap === 'clamp' ? gl.CLAMP_TO_EDGE :
        opts?.wrap === 'mirror' ? gl.MIRRORED_REPEAT :
        gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

function registerGlTexture(module: ESEngineModule, texture: WebGLTexture, width: number, height: number): number {
    const glObj = module.GL;
    const id = glObj.getNewId(glObj.textures);
    glObj.textures[id] = texture;
    return requireResourceManager().registerExternalTexture(id, width, height);
}

/** Upload pre-transcoded compressed blocks via `gl.compressedTexImage2D`. */
export function uploadCompressedTexture(
    gl: WebGL2RenderingContext, module: ESEngineModule,
    support: CompressedTextureSupport, fmt: CompressedTextureFormat,
    t: TranscodeResult, opts?: CompressedUploadOptions,
): UploadedTexture {
    const internalFormat = glInternalFormat(support, fmt);
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
    return { handle: registerGlTexture(module, texture, t.width, t.height), width: t.width, height: t.height };
}

/** Fallback: upload decoded RGBA8 via `gl.texImage2D`. */
export function uploadRgbaTexture(
    gl: WebGL2RenderingContext, module: ESEngineModule, r: RgbaResult, opts?: CompressedUploadOptions,
): UploadedTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('rgba upload: gl.createTexture failed');
    try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, r.width, r.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, r.data);
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
    const target = chooseTargetFormat(support);
    if (target !== null) {
        const t = transcoder.transcode(bytes, target);
        if (t) return uploadCompressedTexture(gl, module, support, target, t, opts);
        // transcode to the chosen format failed → fall through to RGBA.
    }
    const rgba = transcoder.transcodeToRgba(bytes);
    if (!rgba) throw new Error('BasisTranscoder failed to decode KTX2 (compressed and RGBA paths both failed)');
    return uploadRgbaTexture(gl, module, rgba, opts);
}
