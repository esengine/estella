// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ImageLoadResult, PlatformCanvas2DContext, PlatformImage } from './types';

export function imageSizeAtEdge(width: number, height: number, maxEdge = 0): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!(maxEdge > 0) || longest <= maxEdge) return { width, height };
    const scale = Math.max(1, Math.floor(maxEdge)) / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Read only the fitted rectangle from a canvas of that size. */
export function readCanvasPixels(
    image: PlatformImage | ImageBitmap, width: number, height: number, ctx: PlatformCanvas2DContext,
): ImageLoadResult {
    ctx.drawImage(image, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (width === image.width && height === image.height) return { width, height, pixels };
    return { width, height, pixels, sourceWidth: image.width, sourceHeight: image.height };
}

/** Fit whole-image RGBA decoders to the upload budget. Each channel is filtered independently
 *  because textures can carry material weights in RGB even where alpha is zero. */
export function fitImagePixels(image: ImageLoadResult, maxEdge = 0): ImageLoadResult {
    const { width, height } = imageSizeAtEdge(image.width, image.height, maxEdge);
    if (width === image.width && height === image.height) return image;
    if (image.pixels.byteLength < image.width * image.height * 4) {
        throw new Error(`Incomplete RGBA image for ${image.width} × ${image.height} texels`);
    }
    const pixels = new Uint8Array(width * height * 4);
    const src = image.pixels;
    for (let y = 0; y < height; y++) {
        const top = y * image.height / height;
        const bottom = (y + 1) * image.height / height;
        for (let x = 0; x < width; x++) {
            const left = x * image.width / width;
            const right = (x + 1) * image.width / width;
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = Math.floor(top); sy < bottom; sy++) {
                const rowWeight = Math.min(sy + 1, bottom) - Math.max(sy, top);
                for (let sx = Math.floor(left); sx < right; sx++) {
                    const weight = rowWeight * (Math.min(sx + 1, right) - Math.max(sx, left));
                    const i = (sy * image.width + sx) * 4;
                    r += src[i]! * weight;
                    g += src[i + 1]! * weight;
                    b += src[i + 2]! * weight;
                    a += src[i + 3]! * weight;
                }
            }
            const area = (bottom - top) * (right - left);
            const dst = (y * width + x) * 4;
            pixels[dst] = Math.round(r / area);
            pixels[dst + 1] = Math.round(g / area);
            pixels[dst + 2] = Math.round(b / area);
            pixels[dst + 3] = Math.round(a / area);
        }
    }
    return { width, height, pixels, sourceWidth: image.sourceWidth ?? image.width, sourceHeight: image.sourceHeight ?? image.height };
}
