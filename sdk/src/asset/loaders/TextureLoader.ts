import type { AssetLoader, LoadContext, TextureResult } from '../AssetLoader';
import { platformCreateCanvas, platformCreateImage } from '../../platform';
import { requireResourceManager } from '../../resourceManager';
import type { ESEngineModule } from '../../wasm';

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
    readonly extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

    private module_: ESEngineModule;
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
        const ptr = this.module_._malloc(pixels.length);
        this.module_.HEAPU8.set(pixels, ptr);
        const handle = rm.createTexture(width, height, ptr, pixels.length, 1, flipY);
        this.module_._free(ptr);
        return { handle, width, height };
    }

    unload(asset: TextureResult): void {
        const rm = requireResourceManager();
        rm.releaseTexture(asset.handle);
    }

    private async loadWithFlip(
        path: string, ctx: LoadContext, flip: boolean, settings?: TextureImportSettings,
    ): Promise<TextureResult> {
        const url = ctx.backend.resolveUrl(ctx.catalog.getBuildPath(path));
        const img = await this.loadImage(url);
        return this.createTextureFromImage(img, flip, settings);
    }

    private loadImage(src: string): Promise<HTMLImageElement | ImageBitmap> {
        return new Promise((resolve, reject) => {
            const img = platformCreateImage();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                if (typeof createImageBitmap !== 'undefined') {
                    try {
                        const bitmap = await createImageBitmap(img, {
                            premultiplyAlpha: 'none',
                            colorSpaceConversion: 'none',
                        });
                        resolve(bitmap);
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

        if (gl) {
            return this.createTextureWebGL2(gl, img, width, height, flip, settings);
        }
        return this.createTextureFallback(img, width, height, flip);
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
        const glWrap =
            wrap === 'clamp'  ? gl.CLAMP_TO_EDGE :
            wrap === 'mirror' ? gl.MIRRORED_REPEAT :
            gl.REPEAT;

        const texture = gl.createTexture()!;
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
        const ptr = this.module_._malloc(pixels.length);
        this.module_.HEAPU8.set(pixels, ptr);
        const handle = rm.createTexture(width, height, ptr, pixels.length, 1, flip);
        this.module_._free(ptr);

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
