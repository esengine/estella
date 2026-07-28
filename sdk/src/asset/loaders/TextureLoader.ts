// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, TextureResult } from '../AssetLoader';
import { linearColorSpace } from '../../env';
import { platformCreateCanvas, platformCreateImage } from '../../platform/base';
import type { PlatformCanvas, PlatformCanvas2DContext, PlatformImage } from '../../platform/types';
import { decodeImageBitmap } from '../imageDecode';
import { requireResourceManager } from '../../resourceManager';
import type { ESEngineModule } from '../../wasm';
import { withMalloc } from '../../wasmScratch';
import { isKtx2, isKtx2Path, loadCompressedTexture, type BasisTranscoder } from '../compressed';
import { glWrapMode } from '../glTexParams';
import { createTextureFromPixels, type TextureParams } from '../../runtimeAssets';

/**
 * Decode a texture ref to raw RGBA pixels on the current platform. Set by a
 * caller that fetches through a channel `TextureLoader`'s URL-based `<img>`
 * decode can't reach — e.g. the runtime scene loader, whose asset providers
 * pre-decode from `estella://` / WeChat package files / inlined data-URLs. When
 * set, non-KTX2 textures upload through this instead of `loadImage(url)`.
 */
export type TexturePixelDecoder = (
    path: string,
    flip: boolean,
) => Promise<{ width: number; height: number; pixels: Uint8Array }>;

/**
 * Texture import-time settings. Applied when the GL texture is first uploaded,
 * because WebGL sampler state lives on the texture object — the only way to
 * change filter/wrap after the fact is to hold the GL texture id and call
 * `texParameteri`. See {@link TextureLoader#importSettingsResolver}.
 */
export interface TextureImportSettings {
    readonly filter?: 'linear' | 'nearest';
    readonly wrap?: 'repeat' | 'clamp' | 'mirror';
    readonly mipmaps?: boolean;
    /** Whether the image stores sRGB-encoded color (default). Authored-linear
     *  data (normal maps, masks) sets false so the linear pipeline skips the
     *  hardware EOTF. Ignored in gamma mode. */
    readonly srgb?: boolean;
    /**
     * 9-slice border in texture pixels. A property of the IMAGE (where its
     * corners end), not of any one entity — so it is authored once at import
     * and every `UIVisual` set to NineSlice inherits it. Applied to the texture
     * handle's metadata at load; a UIVisual may still override per entity.
     */
    readonly sliceBorder?: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

export type TextureImportSettingsResolver = (ref: string) => TextureImportSettings | undefined;

/**
 * Canonical residency key for a texture: the resolved load path plus the
 * flip-orientation flag (flipped and raw uploads are genuinely different GPU
 * objects). One string serves as both the SDK's AsyncCache key and the C++
 * ResourcePool path identity, so a texture whose last reference was released
 * can be revived by `acquireTextureByPath` under the exact same key the next
 * `loadTexture` looks up.
 */
export function textureResidencyKey(path: string, flip: boolean): string {
    return `${path}:${flip ? 'f' : 'n'}`;
}

export class TextureLoader implements AssetLoader<TextureResult> {
    readonly type = 'texture';
    readonly extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ktx2'];

    private module_: ESEngineModule | null;
    /**
     * Basis transcoder for KTX2 assets. Either injected directly via
     * {@link setTranscoder} (tests / embedded realms) or acquired lazily on the
     * first KTX2 load via {@link setTranscoderProvider} — AssetPlugin wires the
     * provider to `app.sideModules.acquire('basis')`, so the basis wasm is only
     * fetched when a project actually uses compressed textures (self-gating, like
     * physics / spine).
     */
    private transcoder_: BasisTranscoder | null = null;
    private transcoderProvider_: (() => Promise<BasisTranscoder | null>) | null = null;
    private transcoderPending_: Promise<BasisTranscoder | null> | null = null;
    setTranscoder(t: BasisTranscoder | null): void { this.transcoder_ = t; }
    setTranscoderProvider(p: (() => Promise<BasisTranscoder | null>) | null): void {
        this.transcoderProvider_ = p;
    }

    /** The transcoder, acquiring it once on demand. Concurrent KTX2 loads share
     *  the in-flight acquisition so the basis module loads exactly once. */
    private async ensureTranscoder_(): Promise<BasisTranscoder | null> {
        if (this.transcoder_) return this.transcoder_;
        if (!this.transcoderProvider_) return null;
        if (!this.transcoderPending_) this.transcoderPending_ = this.transcoderProvider_();
        this.transcoder_ = await this.transcoderPending_;
        return this.transcoder_;
    }
    private canvas_: PlatformCanvas | null = null;
    private ctx_: PlatformCanvas2DContext | null = null;
    /**
     * Optional hook that returns per-asset import settings. Invoked at
     * load-time with the ORIGINAL ref (pre-resolution), so callers can key
     * off `@uuid:...` directly. Undefined-result falls back to defaults.
     */
    importSettingsResolver: TextureImportSettingsResolver | null = null;

    constructor(module: ESEngineModule | null) {
        this.module_ = module;
    }

    /** Currently-effective settings for the in-flight load. Set by Assets.ts
     *  before delegating to load(); cleared when done. Avoids threading a new
     *  param through the AssetLoader interface, which is also implemented by
     *  non-texture loaders that don't need it. */
    private pendingSettings_: TextureImportSettings | undefined;
    setPendingSettings(s: TextureImportSettings | undefined): void { this.pendingSettings_ = s; }

    /** Platform pixel decoder (see {@link TexturePixelDecoder}). Null ⇒ the
     *  default URL `<img>` decode path (editor / app Assets, unchanged). */
    private pixelDecoder_: TexturePixelDecoder | null = null;
    setPixelDecoder(decoder: TexturePixelDecoder | null): void { this.pixelDecoder_ = decoder; }
    get pixelDecoder(): TexturePixelDecoder | null { return this.pixelDecoder_; }

    private ensureCanvas_(): { canvas: PlatformCanvas; ctx: PlatformCanvas2DContext } {
        if (this.canvas_ && this.ctx_) return { canvas: this.canvas_, ctx: this.ctx_ };
        this.canvas_ = platformCreateCanvas(256, 256);
        const ctx = this.canvas_.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('TextureLoader: failed to create 2D context');
        this.ctx_ = ctx;
        return { canvas: this.canvas_, ctx: this.ctx_ };
    }

    async load(path: string, ctx: LoadContext): Promise<TextureResult> {
        const settings = this.pendingSettings_;
        this.pendingSettings_ = undefined;
        return this.loadWithFlip(path, ctx, true, settings);
    }

    async loadRaw(path: string, ctx: LoadContext): Promise<TextureResult> {
        const settings = this.pendingSettings_;
        this.pendingSettings_ = undefined;
        return this.loadWithFlip(path, ctx, false, settings);
    }

    async loadFromPixels(
        width: number, height: number, pixels: Uint8Array, flipY: boolean,
    ): Promise<TextureResult> {
        const rm = requireResourceManager();
        // Native (no wasm heap): upload the bytes directly. Web embind lacks this
        // method, so it takes the heap path below unchanged.
        if (rm.createTextureFromBytes) {
            const handle = rm.createTextureFromBytes(width, height, pixels, 1, flipY);
            return { handle, width, height };
        }
        if (!this.module_) {
            throw new Error('TextureLoader.loadFromPixels: no wasm module and no native byte-upload path');
        }
        const module = this.module_;
        const handle = withMalloc(module, pixels.length, ptr => {
            module.HEAPU8.set(pixels, ptr);
            return rm.createTexture(width, height, ptr, pixels.length, 1, flipY);
        });
        return { handle, width, height };
    }

    unload(asset: TextureResult): void {
        const rm = requireResourceManager();
        rm.releaseTexture(asset.handle);
    }

    private async loadWithFlip(
        path: string, ctx: LoadContext, flip: boolean, settings?: TextureImportSettings,
    ): Promise<TextureResult> {
        const result = await this.decodeAndUpload_(path, ctx, flip, settings);
        // Path identity in the C++ pool: after the last release the texture can
        // survive as an evictable cache entry (budget permitting) and the next
        // load revives it by this key instead of re-fetching + re-decoding.
        // Optional-chained: minimal test mocks may not model the pool surface.
        requireResourceManager().registerTextureWithPath?.(
            result.handle, textureResidencyKey(path, flip));
        return result;
    }

    private async decodeAndUpload_(
        path: string, ctx: LoadContext, flip: boolean, settings?: TextureImportSettings,
    ): Promise<TextureResult> {
        if (isKtx2Path(path)) {
            return this.loadCompressed(path, ctx, settings);
        }
        // A platform pixel decoder (runtime scene loader) pre-decodes to RGBA and
        // uploads through the shared createTexture path — the same code the old
        // runtimeLoader.loadTextures used — instead of a URL-based <img>.
        if (this.pixelDecoder_) {
            const result = await this.pixelDecoder_(path, flip);
            const params: TextureParams = {
                filterMode: settings?.filter, wrapMode: settings?.wrap, srgb: settings?.srgb,
            };
            const handle = createTextureFromPixels(this.module_, result, flip, params);
            return { handle, width: result.width, height: result.height };
        }
        const url = ctx.backend.resolveUrl(ctx.catalog.getBuildPath(path));
        const img = await this.loadImage(url, flip);
        return this.createTextureFromImage(img, flip, settings);
    }

    /**
     * Load a KTX2 (Basis) compressed texture: fetch the container, transcode to a
     * device-supported GPU format (or RGBA8 fallback), and upload. KTX2 carries its
     * own orientation, so the `flip` flag does not apply.
     */
    private async loadCompressed(
        path: string, ctx: LoadContext, settings?: TextureImportSettings,
    ): Promise<TextureResult> {
        const buf = await ctx.backend.fetchBinary(ctx.catalog.getBuildPath(path));
        const bytes = new Uint8Array(buf);
        if (!isKtx2(bytes)) throw new Error(`TextureLoader: ${path} is not a KTX2 file`);
        // Native (embedded Dawn): the ResourceManager transcodes the KTX2 with the
        // host's basis library and uploads the compressed blocks — no WebGL2, no
        // wasm transcoder. sRGB follows the color pipeline, like the web path below.
        const rm = requireResourceManager();
        if (rm.createTextureFromKTX2) {
            const r = rm.createTextureFromKTX2(bytes, linearColorSpace());
            if (!r) throw new Error(`TextureLoader: KTX2 transcode failed for ${path}`);
            return { handle: r.handle, width: r.width, height: r.height };
        }
        const gl = this.getWebGL2Context();
        if (!gl) throw new Error('TextureLoader: KTX2 textures require a WebGL2 context');
        const transcoder = await this.ensureTranscoder_();
        if (!transcoder) {
            throw new Error('TextureLoader: no Basis transcoder available (basis side module missing — KTX2 assets need it)');
        }
        // KTX2 payloads are color, like the PNG path: linear mode wants the
        // sRGB variant of whatever compressed format the device supports.
        // A WebGL2 context implies a wasm module (native has neither, and threw
        // above on the missing gl); the KTX2 path is web-only.
        const r = loadCompressedTexture(gl, this.module_!, transcoder, bytes,
            { ...settings, srgb: linearColorSpace() });
        return { handle: r.handle, width: r.width, height: r.height };
    }

    /**
     * Decode `src` into a GPU-uploadable source. When `createImageBitmap` is
     * available we bake the vertical orientation into the bitmap here via
     * `imageOrientation`, NOT later via `UNPACK_FLIP_Y_WEBGL`: Chromium/ANGLE
     * silently ignore that pixel-store flag for `ImageBitmap` sources, so relying
     * on it uploads every texture upside-down. The raw `<img>` fallback keeps the
     * flag (it works for element/pixel sources) — see {@link createTextureFromImage}.
     */
    private loadImage(src: string, flip: boolean): Promise<PlatformImage | ImageBitmap> {
        return new Promise((resolve, reject) => {
            const img = platformCreateImage();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                if (typeof createImageBitmap !== 'undefined') {
                    try {
                        resolve(await decodeImageBitmap(img, flip));
                        return;
                    } catch {
                        // fallback
                    }
                }
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
            img.src = src;
        });
    }

    private createTextureFromImage(
        img: PlatformImage | ImageBitmap, flip: boolean, settings?: TextureImportSettings,
    ): TextureResult {
        const { width, height } = img;
        const gl = this.getWebGL2Context();

        // A bitmap is already oriented by loadImage (imageOrientation); flipping it
        // again at upload would double-flip it. Only raw <img>/pixel sources need
        // the UNPACK_FLIP_Y_WEBGL flip.
        const uploadFlip = (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap)
            ? false : flip;

        if (gl) {
            return this.createTextureWebGL2(gl, img, width, height, uploadFlip, settings);
        }
        return this.createTextureFallback(img, width, height, uploadFlip, settings);
    }

    private getWebGL2Context(): WebGL2RenderingContext | null {
        return findWebGL2Context(this.module_?.GL);
    }

    private createTextureWebGL2(
        gl: WebGL2RenderingContext,
        img: PlatformImage | ImageBitmap,
        width: number, height: number, flip: boolean,
        settings?: TextureImportSettings,
    ): TextureResult {
        const filter = settings?.filter ?? 'linear';
        const wrap = settings?.wrap ?? 'repeat';
        const useMipmaps = settings?.mipmaps ?? true;
        const glMinFilter = filter === 'nearest'
            ? (useMipmaps ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST)
            : (useMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        const glMagFilter = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
        const glWrap = glWrapMode(gl, wrap);

        // createTexture returns null on a lost context — don't `!`-assert it
        // into the calls below.
        const texture = gl.createTexture();
        if (!texture) {
            throw new Error('TextureLoader: gl.createTexture() returned null (GL context lost?)');
        }
        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip ? 1 : 0);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
            // Linear pipeline: color textures store sRGB-encoded — the sampler
            // linearizes in hardware. Data textures (normal maps) opt out via
            // the importer's sRGB flag.
            const internalFormat = linearColorSpace() && (settings?.srgb ?? true)
                ? gl.SRGB8_ALPHA8 : gl.RGBA;
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, img as any);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glMinFilter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glMagFilter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, glWrap);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, glWrap);
            if (useMipmaps) {
                gl.generateMipmap(gl.TEXTURE_2D);
            }
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        } catch (err) {
            // Upload threw (e.g. context lost mid-call); release the GL texture
            // instead of leaking it.
            gl.deleteTexture(texture);
            throw err;
        }

        // This path runs only with a live WebGL2 context, which implies a module.
        const glObj = this.module_!.GL;
        const glTextureId = glObj.getNewId(glObj.textures);
        glObj.textures[glTextureId] = texture;

        const rm = requireResourceManager();
        const handle = rm.registerExternalTexture(glTextureId, width, height);
        return { handle, width, height };
    }

    private createTextureFallback(
        img: PlatformImage | ImageBitmap,
        width: number, height: number, flip: boolean,
        settings?: TextureImportSettings,
    ): TextureResult {
        // The 2D-canvas fallback is web-only: it decodes through an offscreen
        // canvas + wasm heap upload. Native never reaches it — it sets a
        // pixelDecoder, so decodeAndUpload_ takes the createTextureFromPixels
        // (byte) path before this — so require the module rather than pretend.
        if (!this.module_) {
            throw new Error('TextureLoader: 2D-canvas fallback needs a wasm module (native uses the pixel-decode path)');
        }
        const module = this.module_;
        const { canvas, ctx } = this.ensureCanvas_();
        if (canvas.width < width || canvas.height < height) {
            canvas.width = Math.max(canvas.width, nextPowerOf2(width));
            canvas.height = Math.max(canvas.height, nextPowerOf2(height));
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        unpremultiplyAlpha(pixels);

        const rm = requireResourceManager();
        // Format 2 = sRGB color under the linear pipeline (see rm_createTexture).
        const format = linearColorSpace() && (settings?.srgb ?? true) ? 2 : 1;
        const handle = withMalloc(module, pixels.length, ptr => {
            module.HEAPU8.set(pixels, ptr);
            return rm.createTexture(width, height, ptr, pixels.length, format, flip);
        });

        return { handle, width, height };
    }
}

function unpremultiplyAlpha(pixels: Uint8Array): void {
    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a > 0 && a < 255) {
            const scale = 255 / a;
            pixels[i] = Math.min(255, Math.round(pixels[i] * scale));
            pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * scale));
            pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * scale));
        }
    }
}

function nextPowerOf2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

/**
 * The engine's WebGL2 context, looked up through emscripten's GL bookkeeping.
 * Duck-typed on `texStorage2D` (a WebGL2-only method): WeChat MiniGames have no
 * `WebGL2RenderingContext` global — an `instanceof` check THREW there and read
 * as "no context", refusing every KTX2 texture — and instanceof lies across
 * realms anyway. Falls back to any registered context when none is current yet
 * (a host registers the context before the renderer's first frame makes it
 * current). Exported for tests.
 */
export function findWebGL2Context(glObj: ESEngineModule['GL'] | undefined): WebGL2RenderingContext | null {
    try {
        const current = glObj?.currentContext?.GLctx;
        if (isWebGL2(current)) return current;
        for (const rec of glObj?.contexts ?? []) {
            if (rec && isWebGL2(rec.GLctx)) return rec.GLctx;
        }
    } catch {
        // fall through — treated as "no WebGL2 context"
    }
    return null;
}

function isWebGL2(ctx: unknown): ctx is WebGL2RenderingContext {
    return !!ctx && typeof (ctx as WebGL2RenderingContext).texStorage2D === 'function';
}
