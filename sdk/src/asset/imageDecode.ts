// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    imageDecode.ts
 * @brief   The single image-decode path for every texture provider (editor,
 *          play realm, preview, spine). Routing all of them through one module
 *          keeps premultiply / colorspace / orientation identical, so the
 *          edit/play/ship paths can't drift — that drift is the texture-flip
 *          class of bug. Vertical orientation is baked via `imageOrientation`,
 *          NEVER `UNPACK_FLIP_Y_WEBGL`, which Chromium/ANGLE silently ignore for
 *          `ImageBitmap` sources (uploads every texture upside-down otherwise).
 */
import { platformCreateCanvas } from '../platform';

/**
 * Canonical `createImageBitmap` options. premultiply + colorspace conversion are
 * OFF so the engine owns blending and color (matching the C++ upload); `flip`
 * bakes a vertical flip into the bitmap so callers upload it as-is.
 */
export function imageBitmapOptions(flip: boolean): ImageBitmapOptions {
    return {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
        imageOrientation: flip ? 'flipY' : 'from-image',
    };
}

/**
 * Decode a source into a GL-oriented `ImageBitmap` for direct `texImage2D` upload
 * (the editor/web TextureLoader). With `flip`, the result samples file-top at v=1;
 * upload it with `UNPACK_FLIP_Y_WEBGL` off (the orientation is already baked).
 */
export function decodeImageBitmap(src: ImageBitmapSource, flip: boolean): Promise<ImageBitmap> {
    return createImageBitmap(src, imageBitmapOptions(flip));
}

export interface DecodedPixels {
    width: number;
    height: number;
    pixels: Uint8Array;
}

/**
 * Decode a source into a top-first RGBA pixel buffer for the C++ `createTexture`
 * upload path (play realm, preview, spine). Orientation stays top-first here; the
 * consumer chooses the final convention via `createTextureFromPixels(flipY)` —
 * v=1=top for general textures, v=0=top for spine / bitmap fonts.
 */
export async function decodeImagePixels(src: ImageBitmapSource): Promise<DecodedPixels> {
    const bitmap = await decodeImageBitmap(src, false);
    try {
        const canvas = platformCreateCanvas(bitmap.width, bitmap.height);
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
            | CanvasRenderingContext2D
            | OffscreenCanvasRenderingContext2D
            | null;
        if (!ctx) throw new Error('imageDecode: 2D context unavailable for pixel decode');
        ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        return { width: bitmap.width, height: bitmap.height, pixels: new Uint8Array(data.data.buffer) };
    } finally {
        bitmap.close?.();
    }
}

/**
 * Fetch a URL and decode it to top-first RGBA pixels. The single fetch→blob→decode
 * path the runtime asset sources use for `estella://` / http origins (a CORS-mode
 * `<img>` taints the canvas on custom schemes; fetch→blob sidesteps it). Uses the
 * global `fetch` — these callers all run in a browser/electron context.
 */
export async function fetchDecodePixels(url: string): Promise<DecodedPixels> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch failed (${res.status}): ${url}`);
    return decodeImagePixels(await res.blob());
}
