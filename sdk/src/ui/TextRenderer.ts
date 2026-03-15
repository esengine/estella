/**
 * @file    TextRenderer.ts
 * @brief   Renders text to GPU textures using Canvas 2D API
 */

import type { Entity } from '../types';
import { RuntimeConfig } from '../defaults';
import type { ESEngineModule } from '../wasm';
import { TextAlign, TextVerticalAlign, TextOverflow, type TextData } from './text';
import { platformCreateCanvas } from '../platform';
import { requireResourceManager } from '../resourceManager';
import { wrapText, nextPowerOf2, colorToRgba } from './uiHelpers';
import { TEXT_PADDING_RATIO, TEXT_CANVAS_SHRINK_FRAMES, TEXT_CANVAS_OVERSIZE_RATIO, TEXT_ASCENT_RATIO } from './uiConstants';
import { parseRichText } from './RichTextParser';
import { createFontSet, layoutRichText, measureLayoutWidth, type LayoutLine } from './RichTextLayout';
import type { ImageResolver } from './ImageResolver';

interface SizedRect {
    size: { x: number; y: number };
}

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
    private shrinkCounter_ = 0;
    private frameMaxW_ = 0;
    private frameMaxH_ = 0;
    private imageResolver_: ImageResolver | null = null;

    constructor(module: ESEngineModule) {
        this.module = module;
        this.canvas = platformCreateCanvas(RuntimeConfig.textCanvasSize, RuntimeConfig.textCanvasSize);
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('TextRenderer: failed to create 2D canvas context');
        this.ctx = ctx;
    }

    beginFrame(): void {
        const canvas = this.canvas;
        if (this.frameMaxW_ > 0) {
            if (canvas.width < this.frameMaxW_ || canvas.height < this.frameMaxH_) {
                canvas.width = Math.max(canvas.width, nextPowerOf2(this.frameMaxW_));
                canvas.height = Math.max(canvas.height, nextPowerOf2(this.frameMaxH_));
                this.shrinkCounter_ = 0;
            } else if (canvas.width > this.frameMaxW_ * TEXT_CANVAS_OVERSIZE_RATIO || canvas.height > this.frameMaxH_ * TEXT_CANVAS_OVERSIZE_RATIO) {
                this.shrinkCounter_++;
                if (this.shrinkCounter_ >= TEXT_CANVAS_SHRINK_FRAMES) {
                    canvas.width = nextPowerOf2(this.frameMaxW_);
                    canvas.height = nextPowerOf2(this.frameMaxH_);
                    this.shrinkCounter_ = 0;
                }
            } else {
                this.shrinkCounter_ = 0;
            }
        }
        this.frameMaxW_ = 0;
        this.frameMaxH_ = 0;
    }

    setImageResolver(resolver: ImageResolver | null): void {
        this.imageResolver_ = resolver;
    }

    private renderText(text: TextData, uiRect?: SizedRect | null): TextRenderResult {
        try {
            return this.renderTextInner(text, uiRect);
        } catch (e) {
            console.error('TextRenderer: render failed', e);
            return { textureHandle: 0, width: 0, height: 0 };
        }
    }

    private renderTextInner(text: TextData, uiRect?: SizedRect | null): TextRenderResult {
        const ctx = this.ctx;
        const canvas = this.canvas;

        const hasContainer = uiRect && uiRect.size.x > 0 && uiRect.size.y > 0;
        const containerWidth = hasContainer ? uiRect!.size.x : 0;
        const containerHeight = hasContainer ? uiRect!.size.y : 0;

        const hasStroke = text.strokeWidth > 0;
        const hasShadow = text.shadowBlur > 0 || text.shadowOffsetX !== 0 || text.shadowOffsetY !== 0;
        const strokeExpand = hasStroke ? Math.ceil(text.strokeWidth) : 0;
        const shadowExpand = hasShadow ? Math.ceil(text.shadowBlur + Math.max(Math.abs(text.shadowOffsetX), Math.abs(text.shadowOffsetY))) : 0;
        const effectPadding = Math.max(strokeExpand, shadowExpand);

        const lineHeightPx = Math.ceil(text.fontSize * text.lineHeight);
        const padding = Math.ceil(text.fontSize * TEXT_PADDING_RATIO) + effectPadding;
        const shouldWrap = text.wordWrap && hasContainer;

        let richLines: LayoutLine[] | null = null;
        let plainLines: string[] | null = null;
        let fontSet: ReturnType<typeof createFontSet> | null = null;
        let measuredWidth: number;
        let measuredHeight: number;

        if (text.richText) {
            const runs = parseRichText(text.content);
            fontSet = createFontSet(text.fontSize, text.fontFamily);
            richLines = layoutRichText(ctx, runs, fontSet, text.color, shouldWrap ? containerWidth : 0, text.fontSize);
            measuredWidth = Math.ceil(measureLayoutWidth(richLines));
            let totalH = 0;
            for (const line of richLines) {
                totalH += line.height ? Math.max(lineHeightPx, line.height) : lineHeightPx;
            }
            measuredHeight = Math.ceil(totalH);
        } else {
            ctx.font = `${text.fontSize}px ${text.fontFamily}`;
            plainLines = wrapText(ctx, text.content, shouldWrap ? containerWidth : 0);
            measuredWidth = Math.ceil(this.measureWidth(plainLines));
            measuredHeight = Math.ceil(plainLines.length * lineHeightPx);
        }

        const contentWidth = measuredWidth + padding * 2;
        const contentHeight = measuredHeight + padding * 2;
        let width: number;
        let height: number;
        if (hasContainer) {
            const isVisible = text.overflow === TextOverflow.Visible;
            width = isVisible ? Math.max(Math.ceil(containerWidth), contentWidth) : Math.ceil(containerWidth);
            height = isVisible ? Math.max(Math.ceil(containerHeight), contentHeight) : Math.ceil(containerHeight);
        } else {
            width = contentWidth;
            height = contentHeight;
        }

        if (hasContainer && text.overflow === TextOverflow.Ellipsis && measuredHeight > containerHeight) {
            const maxLines = Math.floor(containerHeight / lineHeightPx);
            if (maxLines > 0) {
                if (richLines && richLines.length > maxLines) {
                    richLines = richLines.slice(0, maxLines);
                    this.truncateRichLine(richLines[maxLines - 1], containerWidth, fontSet!);
                } else if (plainLines && plainLines.length > maxLines) {
                    plainLines = plainLines.slice(0, maxLines);
                    plainLines[maxLines - 1] = this.truncateWithEllipsis(plainLines[maxLines - 1], containerWidth);
                }
            }
        }

        this.frameMaxW_ = Math.max(this.frameMaxW_, width);
        this.frameMaxH_ = Math.max(this.frameMaxH_, height);

        if (canvas.width < width || canvas.height < height) {
            canvas.width = Math.max(canvas.width, nextPowerOf2(width));
            canvas.height = Math.max(canvas.height, nextPowerOf2(height));
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.textBaseline = 'top';

        if (hasContainer && text.overflow === TextOverflow.Clip) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, width, height);
            ctx.clip();
        }

        let textBlockHeight: number;
        if (richLines) {
            textBlockHeight = 0;
            for (const line of richLines) {
                textBlockHeight += line.height ? Math.max(lineHeightPx, line.height) : lineHeightPx;
            }
        } else {
            textBlockHeight = plainLines!.length * lineHeightPx;
        }
        let startY: number;
        if (hasContainer) {
            switch (text.verticalAlign) {
                case TextVerticalAlign.Top: startY = padding; break;
                case TextVerticalAlign.Middle: startY = padding + (height - 2 * padding - textBlockHeight) / 2; break;
                case TextVerticalAlign.Bottom: startY = height - textBlockHeight - padding; break;
                default: startY = padding;
            }
            if (startY < 0) startY = 0;
        } else {
            startY = padding;
        }

        if (hasStroke) {
            ctx.strokeStyle = colorToRgba(text.strokeColor);
            ctx.lineWidth = text.strokeWidth * 2;
            ctx.lineJoin = 'round';
        }

        if (hasShadow) {
            ctx.shadowColor = colorToRgba(text.shadowColor);
            ctx.shadowBlur = text.shadowBlur;
            ctx.shadowOffsetX = text.shadowOffsetX;
            ctx.shadowOffsetY = text.shadowOffsetY;
        }

        if (richLines) {
            ctx.textAlign = 'left';
            let lastFI = -1;
            let y = startY;

            const resolver = this.imageResolver_;

            if (hasStroke) {
                for (const line of richLines) {
                    const lh = line.height ? Math.max(lineHeightPx, line.height) : lineHeightPx;
                    const baseX = this.lineBaseX(text.align, width, line.width, padding);
                    for (const run of line.runs) {
                        if (run.type !== 'text') continue;
                        if (run.fontIndex !== lastFI) {
                            ctx.font = fontSet!.fonts[run.fontIndex];
                            lastFI = run.fontIndex;
                        }
                        ctx.strokeText(run.text, baseX + run.x, y);
                    }
                    y += lh;
                }
                lastFI = -1;
                y = startY;
            }

            const ascent = text.fontSize * TEXT_ASCENT_RATIO;

            for (const line of richLines) {
                const lh = line.height ? Math.max(lineHeightPx, line.height) : lineHeightPx;
                let baseX: number;
                switch (text.align) {
                    case TextAlign.Left: baseX = padding; break;
                    case TextAlign.Center: baseX = (width - line.width) / 2; break;
                    case TextAlign.Right: baseX = width - padding - line.width; break;
                    default: baseX = padding;
                }
                for (const run of line.runs) {
                    if (run.type !== 'text') continue;
                    if (run.fontIndex !== lastFI) {
                        ctx.font = fontSet!.fonts[run.fontIndex];
                        lastFI = run.fontIndex;
                    }
                    ctx.fillStyle = colorToRgba(run.color);
                    ctx.fillText(run.text, baseX + run.x, y);
                }
                y += lh;
            }

            if (hasShadow) {
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            }

            if (resolver) {
                y = startY;
                lastFI = -1;
                for (const line of richLines) {
                    const lh = line.height ? Math.max(lineHeightPx, line.height) : lineHeightPx;
                    const baseX = this.lineBaseX(text.align, width, line.width, padding);
                    for (const run of line.runs) {
                        if (run.type !== 'image') continue;
                        const img = resolver.resolve(run.src);
                        if (!img) continue;
                        let imgY: number;
                        switch (run.valign) {
                            case 'top':      imgY = y; break;
                            case 'middle':   imgY = y + (lineHeightPx - run.height) / 2; break;
                            case 'bottom':   imgY = y + lineHeightPx - run.height; break;
                            case 'baseline':
                            default:         imgY = y + ascent - run.height; break;
                        }
                        const dx = baseX + run.x + run.offsetX;
                        const dy = imgY + run.offsetY;
                        if (run.tint) ctx.globalAlpha = run.tint.a;
                        ctx.drawImage(img, dx, dy, run.width, run.height);
                        if (run.tint) ctx.globalAlpha = 1;
                    }
                    y += lh;
                }
            }
        } else {
            ctx.font = `${text.fontSize}px ${text.fontFamily}`;
            ctx.textAlign = this.mapAlign(text.align);
            ctx.fillStyle = colorToRgba(text.color);
            let y = startY;
            for (const line of plainLines!) {
                let x: number;
                switch (text.align) {
                    case TextAlign.Left: x = padding; break;
                    case TextAlign.Center: x = width / 2; break;
                    case TextAlign.Right: x = width - padding; break;
                    default: x = padding;
                }
                if (hasStroke) ctx.strokeText(line, x, y);
                ctx.fillText(line, x, y);
                y += lineHeightPx;
            }
        }

        if (hasShadow) {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        if (hasContainer && text.overflow === TextOverflow.Clip) {
            ctx.restore();
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);

        const rm = requireResourceManager();
        const ptr = this.module._malloc(pixels.length);
        this.module.HEAPU8.set(pixels, ptr);

        const textureHandle = rm.createTexture(width, height, ptr, pixels.length, 1, true);

        this.module._free(ptr);

        return { textureHandle, width, height };
    }

    private truncateWithEllipsis(text: string, maxWidth: number): string {
        const ellipsis = '...';
        if (this.ctx.measureText(text).width <= maxWidth) return text;
        let truncated = text;
        while (truncated.length > 0 && this.ctx.measureText(truncated + ellipsis).width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + ellipsis;
    }

    private truncateRichLine(line: LayoutLine, maxWidth: number, fontSet: ReturnType<typeof createFontSet>): void {
        const ctx = this.ctx;
        const ellipsis = '...';
        const ellipsisWidth = ctx.measureText(ellipsis).width;
        const target = maxWidth - ellipsisWidth;
        if (target <= 0) {
            line.runs = [];
            line.width = 0;
            return;
        }
        let accum = 0;
        for (let i = 0; i < line.runs.length; i++) {
            const run = line.runs[i];
            if (accum + run.width > target) {
                if (run.type === 'image') {
                    line.runs = line.runs.slice(0, i);
                    line.width = accum;
                    return;
                }
                ctx.font = fontSet.fonts[run.fontIndex];
                const available = target - accum;
                let fitLen = 0;
                for (let j = 1; j <= run.text.length; j++) {
                    if (ctx.measureText(run.text.slice(0, j)).width > available) break;
                    fitLen = j;
                }
                const truncText = run.text.slice(0, fitLen) + ellipsis;
                const truncWidth = this.ctx.measureText(truncText).width;
                line.runs = line.runs.slice(0, i + 1);
                line.runs[i] = { ...run, text: truncText, width: truncWidth };
                line.width = accum + truncWidth;
                return;
            }
            accum += run.width;
        }
    }

    private lineBaseX(align: TextAlign, totalWidth: number, lineWidth: number, pad: number): number {
        switch (align) {
            case TextAlign.Left: return pad;
            case TextAlign.Center: return (totalWidth - lineWidth) / 2;
            case TextAlign.Right: return totalWidth - pad - lineWidth;
            default: return pad;
        }
    }

    renderForEntity(entity: Entity, text: TextData, uiRect?: SizedRect | null): TextRenderResult {
        const result = this.renderText(text, uiRect);
        const existing = this.cache.get(entity);
        if (existing) {
            const rm = requireResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }
        this.cache.set(entity, result);
        return result;
    }

    getCached(entity: Entity): TextRenderResult | undefined {
        return this.cache.get(entity);
    }

    release(entity: Entity): void {
        const cached = this.cache.get(entity);
        if (cached) {
            const rm = requireResourceManager();
            rm.releaseTexture(cached.textureHandle);
            this.cache.delete(entity);
        }
    }

    cleanupOrphaned(isAlive: (entity: Entity) => boolean): void {
        const rm = requireResourceManager();
        for (const [entity, result] of this.cache) {
            if (!isAlive(entity)) {
                rm.releaseTexture(result.textureHandle);
                this.cache.delete(entity);
            }
        }
    }

    releaseAll(): void {
        const rm = requireResourceManager();
        for (const result of this.cache.values()) {
            rm.releaseTexture(result.textureHandle);
        }
        this.cache.clear();
    }

    private measureWidth(lines: string[]): number {
        let maxWidth = 0;
        for (const line of lines) {
            maxWidth = Math.max(maxWidth, this.ctx.measureText(line).width);
        }
        return maxWidth;
    }

    private mapAlign(align: TextAlign): CanvasTextAlign {
        switch (align) {
            case TextAlign.Left: return 'left';
            case TextAlign.Center: return 'center';
            case TextAlign.Right: return 'right';
        }
    }
}
