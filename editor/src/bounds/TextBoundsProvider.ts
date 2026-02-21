/**
 * @file    TextBoundsProvider.ts
 * @brief   Bounds provider for Text component
 */

import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY, DEFAULT_LINE_HEIGHT } from 'esengine';
import type { Bounds, BoundsProvider } from './BoundsProvider';

let measureCtx: CanvasRenderingContext2D | null = null;

function getContext(): CanvasRenderingContext2D {
    if (!measureCtx) {
        measureCtx = document.createElement('canvas').getContext('2d')!;
    }
    return measureCtx;
}

export const textBoundsProvider: BoundsProvider = {
    getBounds(data: any): Bounds | null {
        const content = data?.content;
        if (!content) return null;

        const fontSize = data.fontSize ?? DEFAULT_FONT_SIZE;
        const fontFamily = data.fontFamily ?? DEFAULT_FONT_FAMILY;
        const lineHeight = data.lineHeight ?? DEFAULT_LINE_HEIGHT;
        const maxWidthLimit = data.maxWidth ?? 0;

        const ctx = getContext();
        ctx.font = `${fontSize}px ${fontFamily}`;

        const lines = wrapText(ctx, content, maxWidthLimit);
        let maxWidth = 0;
        for (const line of lines) {
            maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
        }

        return {
            width: Math.ceil(maxWidth),
            height: Math.ceil(lines.length * fontSize * lineHeight)
        };
    }
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    if (maxWidth <= 0) {
        return text.split('\n');
    }

    const result: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                result.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            result.push(currentLine);
        }
    }

    return result.length > 0 ? result : [''];
}
