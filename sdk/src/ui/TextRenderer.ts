/**
 * @file    TextRenderer.ts
 * @brief   Renders text to GPU textures using Canvas 2D API
 */

import type { Entity } from '../types';
import type { ESEngineModule, CppResourceManager } from '../wasm';
import { TextAlign, TextBaseline, type TextData } from './text';

// =============================================================================
// Text Render Result
// =============================================================================

export interface TextRenderResult {
    textureHandle: number;
    width: number;
    height: number;
}

// =============================================================================
// Text Renderer
// =============================================================================

export class TextRenderer {
    private canvas: OffscreenCanvas | HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    private module: ESEngineModule;
    private cache = new Map<Entity, TextRenderResult>();

    constructor(module: ESEngineModule) {
        this.module = module;

        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas = new OffscreenCanvas(512, 512);
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
        } else {
            this.canvas = document.createElement('canvas');
            this.canvas.width = 512;
            this.canvas.height = 512;
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
        }
    }

    /**
     * Renders text to a texture and returns the handle
     */
    renderText(text: TextData): TextRenderResult {
        const ctx = this.ctx;
        const canvas = this.canvas;

        ctx.font = `${text.fontSize}px ${text.fontFamily}`;

        const lines = this.wrapText(text.content, text.maxWidth);
        const lineHeight = Math.ceil(text.fontSize * text.lineHeight);
        const padding = Math.ceil(text.fontSize * 0.2);
        const width = Math.ceil(this.measureWidth(lines)) + padding * 2;
        const height = Math.ceil(lines.length * lineHeight) + padding * 2;

        if (canvas.width < width || canvas.height < height) {
            const newWidth = Math.max(canvas.width, this.nextPowerOf2(width));
            const newHeight = Math.max(canvas.height, this.nextPowerOf2(height));
            canvas.width = newWidth;
            canvas.height = newHeight;
        }

        const r = Math.round(text.color.x * 255);
        const g = Math.round(text.color.y * 255);
        const b = Math.round(text.color.z * 255);
        const a = text.color.w;

        // Clear with text color but alpha=0 to avoid black fringing
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = `${text.fontSize}px ${text.fontFamily}`;
        ctx.textAlign = this.mapAlign(text.align);
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;

        let y = padding;
        for (const line of lines) {
            let x: number;
            switch (text.align) {
                case TextAlign.Left:
                    x = padding;
                    break;
                case TextAlign.Center:
                    x = width / 2;
                    break;
                case TextAlign.Right:
                    x = width - padding;
                    break;
            }
            ctx.fillText(line, x, y);
            y += lineHeight;
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);
        const flipped = this.flipVertically(pixels, width, height);

        const rm = this.module.getResourceManager();
        const ptr = this.module._malloc(flipped.length);
        this.module.HEAPU8.set(flipped, ptr);

        const textureHandle = rm.createTexture(width, height, ptr, flipped.length, 1);

        this.module._free(ptr);

        return { textureHandle, width, height };
    }

    /**
     * Renders text for an entity and caches the result
     */
    renderForEntity(entity: Entity, text: TextData): TextRenderResult {
        const existing = this.cache.get(entity);
        if (existing) {
            const rm = this.module.getResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }

        const result = this.renderText(text);
        this.cache.set(entity, result);
        return result;
    }

    /**
     * Gets cached render result for entity
     */
    getCached(entity: Entity): TextRenderResult | undefined {
        return this.cache.get(entity);
    }

    /**
     * Releases texture for entity
     */
    release(entity: Entity): void {
        const cached = this.cache.get(entity);
        if (cached) {
            const rm = this.module.getResourceManager();
            rm.releaseTexture(cached.textureHandle);
            this.cache.delete(entity);
        }
    }

    /**
     * Releases all cached textures
     */
    releaseAll(): void {
        const rm = this.module.getResourceManager();
        for (const result of this.cache.values()) {
            rm.releaseTexture(result.textureHandle);
        }
        this.cache.clear();
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private wrapText(text: string, maxWidth: number): string[] {
        if (!text) return [''];
        if (maxWidth <= 0) return text.split('\n');

        const paragraphs = text.split('\n');
        const lines: string[] = [];

        for (const paragraph of paragraphs) {
            const words = paragraph.split(' ');
            let currentLine = '';

            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const metrics = this.ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            lines.push(currentLine);
        }

        return lines;
    }

    private measureWidth(lines: string[]): number {
        let maxWidth = 0;
        for (const line of lines) {
            const metrics = this.ctx.measureText(line);
            const width = metrics.actualBoundingBoxLeft !== undefined
                ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
                : metrics.width;
            maxWidth = Math.max(maxWidth, width);
        }
        return maxWidth;
    }

    private mapAlign(align: TextAlign): CanvasTextAlign {
        switch (align) {
            case TextAlign.Left:
                return 'left';
            case TextAlign.Center:
                return 'center';
            case TextAlign.Right:
                return 'right';
        }
    }

    private nextPowerOf2(n: number): number {
        let p = 1;
        while (p < n) p *= 2;
        return p;
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
}
