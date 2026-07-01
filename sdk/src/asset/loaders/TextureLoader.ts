// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, TextureResult } from '../AssetLoader';
import { platformCreateCanvas, platformCreateImage } from '../../platform';
import { decodeImageBitmap } from '../imageDecode';
import { requireResourceManager } from '../../resourceManager';
import type { ESEngineModule } from '../../wasm';
import { withMalloc } from '../../wasmScratch';
import { isKtx2, loadCompressedTexture, type BasisTranscoder } from '../compressed';
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
}

export type TextureImportSettingsResolver = (ref: string) => TextureImportSettings | undefined;

export class TextureLoader implements AssetLoader<TextureResult> {
    readonly type = 'texture';
    readonly extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ktx2'];

    private module_: ESEngineModule;
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
    private canvas_: HTMLCanvasElement | OffscreenCanvas | null = null;
    private ctx_: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
    /**
     * Optional hook that returns per-asset import settings. Invoked at
     * load-time with the ORIGINAL ref (pre-resolution), so callers can key
     * off `@uuid:...` directly. Undefined-result falls back to defaults.
     */
    importSettingsResolver: TextureImportSettingsResolver | null = null;

    constructor(module: ESEngineModule) {
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

    private ensureCanvas_(): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
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
        const handle = withMalloc(this.module_, pixels.length, ptr => {
            this.module_.HEAPU8.set(pixels, ptr);
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
        if (path.toLowerCase().endsWith('.ktx2')) {
            return this.loadCompressed(path, ctx, settings);
        }
        // A platform pixel decoder (runtime scene loader) pre-decodes to RGBA and
        // uploads through the shared createTexture path — the same code the old
        // runtimeLoader.loadTextures used — instead of a URL-based <img>.
        if (this.pixelDecoder_) {
            const result = await this.pixelDecoder_(path, flip);
            const params: TextureParams = { filterMode: settings?.filter, wrapMode: settings?.wrap };
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
        const gl = this.getWebGL2Context();
        if (!gl) throw new Error('TextureLoader: KTX2 textures require a WebGL2 context');
        const transcoder = await this.ensureTranscoder_();
        if (!transcoder) {
            throw new Error('TextureLoader: no Basis transcoder available (basis side module missing — KTX2 assets need it)');
        }
        const r = loadCompressedTexture(gl, this.module_, transcoder, bytes, settings);
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
    private loadImage(src: string, flip: boolean): Promise<HTMLImageElement | ImageBitmap> {
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
        img: HTMLImageElement | ImageBitmap, flip: boolean, settings?: TextureImportSettings,
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
        return this.createTextureFallback(img, width, height, uploadFlip);
    }

    private getWebGL2Context(): WebGL2RenderingContext | null {
        try {
            const glObj = this.module_.GL;
            if (glObj?.currentContext?.GLctx instanceof WebGL2RenderingContext) {
                return glObj.currentContext.GLctx;
            }
        } catch {
            // fallback
        }
        return null;
    }

    private createTextureWebGL2(
        gl: WebGL2RenderingContext,
        img: HTMLImageElement | ImageBitmap,
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
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as any);
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

        const glObj = this.module_.GL;
        const glTextureId = glObj.getNewId(glObj.textures);
        glObj.textures[glTextureId] = texture;

        const rm = requireResourceManager();
        const handle = rm.registerExternalTexture(glTextureId, width, height);
        return { handle, width, height };
    }

    private createTextureFallback(
        img: HTMLImageElement | ImageBitmap,
        width: number, height: number, flip: boolean,
    ): TextureResult {
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
        const handle = withMalloc(this.module_, pixels.length, ptr => {
            this.module_.HEAPU8.set(pixels, ptr);
            return rm.createTexture(width, height, ptr, pixels.length, 1, flip);
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
