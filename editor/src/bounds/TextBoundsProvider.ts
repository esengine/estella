/**
 * @file    TextBoundsProvider.ts
 * @brief   Bounds provider for Text component
 */

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

        const fontSize = data.fontSize ?? 24;
        const fontFamily = data.fontFamily ?? 'Arial';
        const lineHeight = data.lineHeight ?? 1.2;

        const ctx = getContext();
        ctx.font = `${fontSize}px ${fontFamily}`;

        const lines = content.split('\n');
        let maxWidth = 0;
        for (const line of lines) {
            maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
        }

        const padding = fontSize * 0.2;
        return {
            width: Math.ceil(maxWidth) + padding * 2,
            height: Math.ceil(lines.length * fontSize * lineHeight) + padding * 2
        };
    }
};
