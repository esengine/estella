/**
 * @file    EditorTextRenderer.ts
 * @brief   Renders text to GPU textures for editor scene view
 */

import type { ESEngineModule } from 'esengine';

// =============================================================================
// Text Render Result
// =============================================================================

export interface TextRenderResult {
    textureHandle: number;
    width: number;
    height: number;
}

// =============================================================================
// EditorTextRenderer
// =============================================================================

export class EditorTextRenderer {
    private canvas_: OffscreenCanvas | HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    private module_: ESEngineModule;
    private cache_ = new Map<number, TextRenderResult>();

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

    renderText(entityId: number, data: any): TextRenderResult | null {
        const existing = this.cache_.get(entityId);
        if (existing) {
            const rm = this.module_.getResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }

        const result = this.renderTextInternal(data);
        if (result) {
            this.cache_.set(entityId, result);
        }
        return result;
    }

    releaseAll(): void {
        const rm = this.module_.getResourceManager();
        for (const result of this.cache_.values()) {
            rm.releaseTexture(result.textureHandle);
        }
        this.cache_.clear();
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private renderTextInternal(data: any): TextRenderResult | null {
        const content = data.content ?? '';
        if (!content) return null;

        const fontFamily = data.fontFamily ?? 'Arial';
        const fontSize = data.fontSize ?? 24;
        const color = data.color ?? { x: 1, y: 1, z: 1, w: 1 };
        const align = data.align ?? 0;
        const maxWidth = data.maxWidth ?? 0;
        const lineHeight = data.lineHeight ?? 1.2;

        const ctx = this.ctx_;
        const canvas = this.canvas_;

        ctx.font = `${fontSize}px ${fontFamily}`;

        const lines = this.wrapText(content, maxWidth);
        const lineHeightPx = Math.ceil(fontSize * lineHeight);
        const padding = Math.ceil(fontSize * 0.2);
        const width = Math.ceil(this.measureWidth(lines)) + padding * 2;
        const height = Math.ceil(lines.length * lineHeightPx) + padding * 2;

        if (canvas.width < width || canvas.height < height) {
            const newWidth = Math.max(canvas.width, this.nextPowerOf2(width));
            const newHeight = Math.max(canvas.height, this.nextPowerOf2(height));
            canvas.width = newWidth;
            canvas.height = newHeight;
        }

        const r = Math.round(color.x * 255);
        const g = Math.round(color.y * 255);
        const b = Math.round(color.z * 255);
        const a = color.w;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.textAlign = this.mapAlign(align);
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;

        let y = padding;
        for (const line of lines) {
            let x: number;
            switch (align) {
                case 0: x = padding; break;
                case 1: x = width / 2; break;
                case 2: x = width - padding; break;
                default: x = padding;
            }
            ctx.fillText(line, x, y);
            y += lineHeightPx;
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        const flipped = this.flipVertically(pixels, width, height);

        const rm = this.module_.getResourceManager();
        const ptr = this.module_._malloc(flipped.length);
        this.module_.HEAPU8.set(flipped, ptr);

        const textureHandle = rm.createTexture(width, height, ptr, flipped.length, 1);

        this.module_._free(ptr);

        return { textureHandle, width, height };
    }

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
                const metrics = this.ctx_.measureText(testLine);

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
            const metrics = this.ctx_.measureText(line);
            const width = metrics.actualBoundingBoxLeft !== undefined
                ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
                : metrics.width;
            maxWidth = Math.max(maxWidth, width);
        }
        return maxWidth;
    }

    private mapAlign(align: number): CanvasTextAlign {
        switch (align) {
            case 0: return 'left';
            case 1: return 'center';
            case 2: return 'right';
            default: return 'left';
        }
    }

    private nextPowerOf2(n: number): number {
        let p = 1;
        while (p < n) p *= 2;
        return p;
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
