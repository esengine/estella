/**
 * @file    TextRenderer.ts
 * @brief   Renders text to GPU textures using Canvas 2D API
 */

import type { Entity, Vec2 } from '../types';
import { DEFAULT_TEXT_CANVAS_SIZE } from '../defaults';
import type { ESEngineModule, CppResourceManager } from '../wasm';
import { TextAlign, TextVerticalAlign, TextOverflow, type TextData } from './text';
import type { UIRectData } from './UIRect';
import { platformCreateCanvas } from '../platform';

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
        this.canvas = platformCreateCanvas(DEFAULT_TEXT_CANVAS_SIZE, DEFAULT_TEXT_CANVAS_SIZE);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })! as CanvasRenderingContext2D;
    }

    /**
     * Renders text to a texture and returns the handle
     */
    renderText(text: TextData, uiRect?: UIRectData | null): TextRenderResult {
        const ctx = this.ctx;
        const canvas = this.canvas;

        ctx.font = `${text.fontSize}px ${text.fontFamily}`;

        const hasContainer = uiRect && uiRect.size.x > 0 && uiRect.size.y > 0;
        const containerWidth = hasContainer ? uiRect!.size.x : 0;
        const containerHeight = hasContainer ? uiRect!.size.y : 0;

        const shouldWrap = text.wordWrap && hasContainer;
        let lines = this.wrapText(text.content, shouldWrap ? containerWidth : 0);
        const lineHeightPx = Math.ceil(text.fontSize * text.lineHeight);
        const padding = Math.ceil(text.fontSize * 0.2);

        const measuredWidth = Math.ceil(this.measureWidth(lines));
        const measuredHeight = Math.ceil(lines.length * lineHeightPx);

        const width = hasContainer ? Math.ceil(containerWidth) : measuredWidth + padding * 2;
        const height = hasContainer ? Math.ceil(containerHeight) : measuredHeight + padding * 2;

        // Handle overflow ellipsis
        if (hasContainer && text.overflow === TextOverflow.Ellipsis && measuredHeight > containerHeight) {
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

        const r = Math.round(text.color.r * 255);
        const g = Math.round(text.color.g * 255);
        const b = Math.round(text.color.b * 255);
        const a = text.color.a;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${text.fontSize}px ${text.fontFamily}`;
        ctx.textAlign = this.mapAlign(text.align);
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;

        // Handle overflow clip
        if (hasContainer && text.overflow === TextOverflow.Clip) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, width, height);
            ctx.clip();
        }

        const textBlockHeight = lines.length * lineHeightPx;
        let startY: number;
        if (hasContainer) {
            switch (text.verticalAlign) {
                case TextVerticalAlign.Top: startY = padding; break;
                case TextVerticalAlign.Middle: startY = (height - textBlockHeight) / 2; break;
                case TextVerticalAlign.Bottom: startY = height - textBlockHeight - padding; break;
                default: startY = padding;
            }
        } else {
            startY = padding;
        }

        let y = startY;
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
                default:
                    x = padding;
            }
            ctx.fillText(line, x, y);
            y += lineHeightPx;
        }

        if (hasContainer && text.overflow === TextOverflow.Clip) {
            ctx.restore();
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);

        const rm = this.module.getResourceManager();
        const ptr = this.module._malloc(pixels.length);
        this.module.HEAPU8.set(pixels, ptr);

        const textureHandle = rm.createTexture(width, height, ptr, pixels.length, 1, true);

        this.module._free(ptr);

        return { textureHandle, width, height };
    }

    private truncateWithEllipsis(text: string, maxWidth: number): string {
        const ellipsis = '...';

        if (this.ctx.measureText(text).width <= maxWidth) {
            return text;
        }

        let truncated = text;
        while (truncated.length > 0 && this.ctx.measureText(truncated + ellipsis).width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }

        return truncated + ellipsis;
    }

    /**
     * Renders text for an entity and caches the result
     */
    renderForEntity(entity: Entity, text: TextData, uiRect?: UIRectData | null): TextRenderResult {
        const existing = this.cache.get(entity);
        if (existing) {
            const rm = this.module.getResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }

        const result = this.renderText(text, uiRect);
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

    cleanupOrphaned(isAlive: (entity: Entity) => boolean): void {
        const rm = this.module.getResourceManager();
        for (const [entity, result] of this.cache) {
            if (!isAlive(entity)) {
                rm.releaseTexture(result.textureHandle);
                this.cache.delete(entity);
            }
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
            if (!paragraph) {
                lines.push('');
                continue;
            }

            let currentLine = '';

            for (const char of paragraph) {
                const testLine = currentLine + char;
                const metrics = this.ctx.measureText(testLine);

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

}
