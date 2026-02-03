/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */

import type { TextureHandle } from '../types';
import type { ESEngineModule } from '../wasm';

// =============================================================================
// Types
// =============================================================================

export interface TextureInfo {
    handle: TextureHandle;
    width: number;
    height: number;
}

// =============================================================================
// AssetServer
// =============================================================================

export class AssetServer {
    private module_: ESEngineModule;
    private cache_ = new Map<string, TextureInfo>();
    private pending_ = new Map<string, Promise<TextureInfo>>();
    private canvas_: OffscreenCanvas | HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    constructor(module: ESEngineModule) {
        this.module_ = module;

        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas_ = new OffscreenCanvas(512, 512);
            this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true })!;
        } else {
            this.canvas_ = document.createElement('canvas');
            this.canvas_.width = 512;
            this.canvas_.height = 512;
            this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true })!;
        }
    }

    // =========================================================================
    // Public API
    // =========================================================================

    async loadTexture(source: string): Promise<TextureInfo> {
        const cached = this.cache_.get(source);
        if (cached) {
            return cached;
        }

        const pending = this.pending_.get(source);
        if (pending) {
            return pending;
        }

        const promise = this.loadTextureInternal(source);
        this.pending_.set(source, promise);

        try {
            const result = await promise;
            this.cache_.set(source, result);
            return result;
        } finally {
            this.pending_.delete(source);
        }
    }

    getTexture(source: string): TextureInfo | undefined {
        return this.cache_.get(source);
    }

    hasTexture(source: string): boolean {
        return this.cache_.has(source);
    }

    releaseTexture(source: string): void {
        const info = this.cache_.get(source);
        if (info) {
            const rm = this.module_.getResourceManager();
            rm.releaseTexture(info.handle);
            this.cache_.delete(source);
        }
    }

    releaseAll(): void {
        const rm = this.module_.getResourceManager();
        for (const info of this.cache_.values()) {
            rm.releaseTexture(info.handle);
        }
        this.cache_.clear();
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async loadTextureInternal(source: string): Promise<TextureInfo> {
        const img = await this.loadImage(source);
        return this.createTextureFromImage(img);
    }

    private async loadImage(source: string): Promise<HTMLImageElement | ImageBitmap> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                if (typeof createImageBitmap !== 'undefined') {
                    try {
                        const bitmap = await createImageBitmap(img, {
                            premultiplyAlpha: 'none',
                            colorSpaceConversion: 'none'
                        });
                        resolve(bitmap);
                        return;
                    } catch {
                        // Fall back to Image element
                    }
                }
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${source}`));
            img.src = source;
        });
    }

    private createTextureFromImage(img: HTMLImageElement | ImageBitmap): TextureInfo {
        const { width, height } = img;

        if (this.canvas_.width < width || this.canvas_.height < height) {
            this.canvas_.width = Math.max(this.canvas_.width, this.nextPowerOf2(width));
            this.canvas_.height = Math.max(this.canvas_.height, this.nextPowerOf2(height));
        }

        this.ctx_.clearRect(0, 0, this.canvas_.width, this.canvas_.height);
        this.ctx_.globalCompositeOperation = 'copy';
        this.ctx_.drawImage(img, 0, 0);
        this.ctx_.globalCompositeOperation = 'source-over';

        const imageData = this.ctx_.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);
        const flipped = this.flipVertically(pixels, width, height);

        const rm = this.module_.getResourceManager();
        const ptr = this.module_._malloc(flipped.length);
        this.module_.HEAPU8.set(flipped, ptr);
        const handle = rm.createTexture(width, height, ptr, flipped.length, 1);
        this.module_._free(ptr);

        return { handle, width, height };
    }

    private unpremultiplyAlpha(pixels: Uint8Array): void {
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

    private flipVertically(pixels: Uint8Array, width: number, height: number): Uint8Array {
        const rowSize = width * 4;
        const flipped = new Uint8Array(pixels.length);

        for (let y = 0; y < height; y++) {
            const srcOffset = y * rowSize;
            const dstOffset = (height - 1 - y) * rowSize;
            flipped.set(pixels.subarray(srcOffset, srcOffset + rowSize), dstOffset);
        }

        return flipped;
    }

    private nextPowerOf2(n: number): number {
        let p = 1;
        while (p < n) p *= 2;
        return p;
    }
}
