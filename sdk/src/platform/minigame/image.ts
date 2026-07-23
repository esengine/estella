// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    image.ts
 * @brief   Image decode over a mini-game host (vendor-neutral): load → draw to
 *          an offscreen 2D canvas → read back pixels.
 */

import type { ImageLoadResult, PlatformCanvas2DContext } from '../types';
import type { MiniGameGlobal, MiniGameImage } from './api';

function getOffscreenCanvas(g: MiniGameGlobal, width: number, height: number): {
    ctx: PlatformCanvas2DContext;
} {
    const canvas = g.createCanvas();
    canvas.width = width;
    canvas.height = height;
    // MiniGameCanvas.getContext returns `unknown`; assert to the neutral 2D context.
    const ctx = canvas.getContext('2d') as PlatformCanvas2DContext;
    return { ctx };
}

/** Load an image from a package-relative file path. */
export function mgLoadImage(g: MiniGameGlobal, path: string): Promise<MiniGameImage> {
    return new Promise((resolve, reject) => {
        const img = g.createImage();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error(`Failed to load image: ${path}, ${err}`));
        img.src = path;
    });
}

/** Extract RGBA pixel data from a loaded image. */
export function mgGetImagePixels(g: MiniGameGlobal, img: MiniGameImage): ImageLoadResult {
    const { width, height } = img;
    const { ctx } = getOffscreenCanvas(g, width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = new Uint8Array(imageData.data.buffer);

    return { width, height, pixels };
}

/** Load an image and read its pixels in one call. */
export async function mgLoadImagePixels(g: MiniGameGlobal, path: string): Promise<ImageLoadResult> {
    const img = await mgLoadImage(g, path);
    return mgGetImagePixels(g, img);
}
