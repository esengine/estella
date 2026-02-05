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

    renderText(entityId: number, data: any, uiRect?: { size: { x: number; y: number } } | null): TextRenderResult | null {
        const existing = this.cache_.get(entityId);
        if (existing) {
            const rm = this.module_.getResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }

        const result = this.renderTextInternal(data, uiRect);
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

    private renderTextInternal(data: any, uiRect?: { size: { x: number; y: number } } | null): TextRenderResult | null {
        const content = data.content ?? '';
        if (!content) return null;

        const fontFamily = data.fontFamily ?? 'Arial';
        const fontSize = data.fontSize ?? 24;
        const color = data.color ?? { x: 1, y: 1, z: 1, w: 1 };
        const align = data.align ?? 0;
        const verticalAlign = data.verticalAlign ?? 0;
        const wordWrap = data.wordWrap ?? true;
        const overflow = data.overflow ?? 0;
        const lineHeight = data.lineHeight ?? 1.2;

        const ctx = this.ctx_;
        const canvas = this.canvas_;

        ctx.font = `${fontSize}px ${fontFamily}`;

        const hasContainer = uiRect && uiRect.size.x > 0 && uiRect.size.y > 0;
        const containerWidth = hasContainer ? uiRect!.size.x : 0;
        const containerHeight = hasContainer ? uiRect!.size.y : 0;

        const shouldWrap = wordWrap && hasContainer;
        let lines = this.wrapText(content, shouldWrap ? containerWidth : 0);
        const lineHeightPx = Math.ceil(fontSize * lineHeight);
        const padding = Math.ceil(fontSize * 0.2);

        const measuredWidth = Math.ceil(this.measureWidth(lines));
        const measuredHeight = Math.ceil(lines.length * lineHeightPx);

        const width = hasContainer ? Math.ceil(containerWidth) : measuredWidth + padding * 2;
        const height = hasContainer ? Math.ceil(containerHeight) : measuredHeight + padding * 2;

        // Handle overflow ellipsis
        if (hasContainer && overflow === 2 && measuredHeight > containerHeight) {
            const maxLines = Math.floor(containerHeight / lineHeightPx);
            if (maxLines > 0 && lines.length > maxLines) {
                lines = lines.slice(0, maxLines);
                const lastLine = lines[maxLines - 1];
                lines[maxLines - 1] = this.truncateWithEllipsis(lastLine, containerWidth);
            }
        }

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

        // Handle overflow clip
        if (hasContainer && overflow === 1) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, width, height);
            ctx.clip();
        }

        const textBlockHeight = lines.length * lineHeightPx;
        let startY: number;
        if (hasContainer) {
            switch (verticalAlign) {
                case 0: startY = padding; break;
                case 1: startY = (height - textBlockHeight) / 2; break;
                case 2: startY = height - textBlockHeight - padding; break;
                default: startY = padding;
            }
        } else {
            startY = padding;
        }

        let y = startY;
        for (const line of lines) {
            let x: number;
            if (hasContainer) {
                switch (align) {
                    case 0: x = padding; break;
                    case 1: x = width / 2; break;
                    case 2: x = width - padding; break;
                    default: x = padding;
                }
            } else {
                switch (align) {
                    case 0: x = padding; break;
                    case 1: x = width / 2; break;
                    case 2: x = width - padding; break;
                    default: x = padding;
                }
            }
            ctx.fillText(line, x, y);
            y += lineHeightPx;
        }

        if (hasContainer && overflow === 1) {
            ctx.restore();
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

    private truncateWithEllipsis(text: string, maxWidth: number): string {
        const ellipsis = '...';
        const ellipsisWidth = this.ctx_.measureText(ellipsis).width;

        if (this.ctx_.measureText(text).width <= maxWidth) {
            return text;
        }

        let truncated = text;
        while (truncated.length > 0 && this.ctx_.measureText(truncated + ellipsis).width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }

        return truncated + ellipsis;
    }

    private wrapText(text: string, maxWidth: number): string[] {
        if (!text) return [''];
        if (maxWidth <= 0) return text.split('\n');

        const paragraphs = text.split('\n');
        const lines: string[] = [];

        for (const paragraph of paragraphs) {
            if (!paragraph) {
                lines.push('');
                continue;
            }

            let currentLine = '';

            for (const char of paragraph) {
                const testLine = currentLine + char;
                const metrics = this.ctx_.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) {
                lines.push(currentLine);
            }
        }

        return lines.length > 0 ? lines : [''];
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
