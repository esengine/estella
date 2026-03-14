import type { AssetLoader, LoadContext, TextureResult } from '../AssetLoader';
import { platformCreateCanvas, platformCreateImage } from '../../platform';
import { requireResourceManager } from '../../resourceManager';
import type { ESEngineModule } from '../../wasm';

export class TextureLoader implements AssetLoader<TextureResult> {
    readonly type = 'texture';
    readonly extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

    private module_: ESEngineModule;
    private canvas_: HTMLCanvasElement | OffscreenCanvas | null = null;
    private ctx_: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

    constructor(module: ESEngineModule) {
        this.module_ = module;
    }

    private ensureCanvas_(): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
        if (this.canvas_ && this.ctx_) return { canvas: this.canvas_, ctx: this.ctx_ };
        this.canvas_ = platformCreateCanvas(256, 256);
        const ctx = this.canvas_.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('TextureLoader: failed to create 2D context');
        this.ctx_ = ctx;
        return { canvas: this.canvas_, ctx: this.ctx_ };
    }

    async load(path: string, ctx: LoadContext): Promise<TextureResult> {
        return this.loadWithFlip(path, ctx, true);
    }

    async loadRaw(path: string, ctx: LoadContext): Promise<TextureResult> {
        return this.loadWithFlip(path, ctx, false);
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

    private async loadWithFlip(path: string, ctx: LoadContext, flip: boolean): Promise<TextureResult> {
        const url = ctx.backend.resolveUrl(ctx.catalog.getBuildPath(path));
        const img = await this.loadImage(url);
        return this.createTextureFromImage(img, flip);
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
        img: HTMLImageElement | ImageBitmap, flip: boolean,
    ): TextureResult {
        const { width, height } = img;
        const gl = this.getWebGL2Context();

        if (gl) {
            return this.createTextureWebGL2(gl, img, width, height, flip);
        }
        return this.createTextureFallback(img, width, height, flip);
    }

    private getWebGL2Context(): WebGL2RenderingContext | null {
        try {
            const glObj = (this.module_ as any).GL;
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
    ): TextureResult {
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip ? 1 : 0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as any);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

        const glObj = (this.module_ as any).GL;
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
