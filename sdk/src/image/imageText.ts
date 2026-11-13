// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    imageText.ts
 * @brief   A picture's text, drawn by a 2D canvas: the one part of a picture that follows the fonts of the machine it is drawn on.
 *
 * @details The raster has no fonts. Whoever has a canvas (a browser, a worker with an OffscreenCanvas, a mini-game) hands it this
 *          drawer, which sets the text and reads back how much of each pixel it covers. A `font` that is a file of the project is
 *          drawn in that file's own glyphs wherever it is drawn; a family name is whatever the device has by that name.
 */
import type { ImageTextDrawer } from './imageRaster';

/** As much of a 2D canvas as setting text takes. */
export interface TextCanvasContext {
    font: string;
    textBaseline: string;
    textAlign: string;
    lineWidth: number;
    lineJoin: string;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    measureText(text: string): { width: number };
    fillText(text: string, x: number, y: number): void;
    strokeText(text: string, x: number, y: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

export interface TextCanvas { getContext(id: '2d', options?: { willReadFrequently?: boolean }): unknown }

/**
 * A drawer of text on canvases `canvas` makes. `familyOf` answers the family a font file was registered under, or nothing for a
 * font that is a family's own name.
 */
export function canvasTextDrawer(canvas: (w: number, h: number) => TextCanvas, familyOf: (font: string) => string | undefined): ImageTextDrawer {
    return (layer, m, w, h) => {
        const ctx = canvas(w, h).getContext('2d', { willReadFrequently: true }) as TextCanvasContext | null;
        if (!ctx) throw new Error('could not draw text here');
        const size = layer.fontSize as number;
        const family = layer.font ? `"${familyOf(layer.font) ?? layer.font}", sans-serif` : 'sans-serif';
        ctx.font = `${layer.weight ?? 'normal'} ${size}px ${family}`;
        ctx.textBaseline = 'alphabetic';
        ctx.setTransform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
        const [x, y] = layer.at as readonly [number, number];
        const chars = [...(layer.text as string)];
        const tracking = layer.tracking ?? 0;
        const put = (paint: (t: string, px: number, py: number) => void): void => {
            if (layer.vertical) {
                // One under the other, each centred on the column: at is the top of it.
                ctx.textAlign = 'center';
                chars.forEach((ch, i) => paint(ch, x, y + size * (i + 0.86) + (size * 0.08 + tracking) * i));
                return;
            }
            ctx.textAlign = 'left';
            const widths = chars.map((ch) => ctx.measureText(ch).width + tracking);
            const total = widths.reduce((a, b) => a + b, 0) - tracking;
            let at = x - (layer.align === 'center' ? total / 2 : layer.align === 'right' ? total : 0);
            chars.forEach((ch, i) => { paint(ch, at, y); at += widths[i]!; });
        };
        const read = (): Float32Array => {
            const data = ctx.getImageData(0, 0, w, h).data;
            const out = new Float32Array(w * h);
            for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]! / 255;
            return out;
        };
        put((t, px, py) => ctx.fillText(t, px, py));
        const fill = read();
        let line: Float32Array | null = null;
        if (layer.stroke) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, w, h);
            ctx.setTransform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
            ctx.lineWidth = layer.stroke.width;
            ctx.lineJoin = 'round';
            put((t, px, py) => ctx.strokeText(t, px, py));
            line = read();
        }
        return { fill, line };
    };
}
