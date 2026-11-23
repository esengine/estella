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
import { platformCreateCanvas } from '../platform/base';
import { imageSizeAtEdge, readCanvasPixels } from '../platform/imagePixels';
import { readBitmapTexels } from './glTextureUpload';
import type { ImageLoadResult, PlatformImage } from '../platform/types';

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
export function decodeImageBitmap(
    src: ImageBitmapSource | PlatformImage,
    flip: boolean,
): Promise<ImageBitmap> {
    // The one honest DOM cast in the decode path: `createImageBitmap`'s lib.dom
    // signature lists DOM sources only, but every host that HAS createImageBitmap
    // (web/editor/desktop) hands us a real HTMLImageElement — PlatformImage merely
    // erases its DOM brand. Native decodes via loadImagePixels and never reaches here.
    return createImageBitmap(src as ImageBitmapSource, imageBitmapOptions(flip));
}

export async function decodeBlobBitmap(blob: Blob, flip: boolean): Promise<ImageBitmap | null> {
    if (typeof createImageBitmap !== 'function') return null;
    try {
        return await createImageBitmap(blob, imageBitmapOptions(flip));
    } catch {
        return null;
    }
}

export async function fetchImageBitmap(url: string, flip: boolean): Promise<ImageBitmap | null> {
    if (typeof fetch !== 'function' || typeof Blob === 'undefined' || typeof createImageBitmap !== 'function') return null;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await decodeBlobBitmap(await response.blob(), flip);
    } catch {
        return null;
    }
}

export interface DecodedPixels extends ImageLoadResult {}

/**
 * Decode a source into a top-first RGBA pixel buffer for the C++ `createTexture`
 * upload path (play realm, preview, spine). Orientation stays top-first here; the
 * consumer chooses the final convention via `createTextureFromPixels(flipY)` —
 * v=1=top for general textures, v=0=top for spine / bitmap fonts.
 */
export async function decodeImagePixels(src: ImageBitmapSource, maxEdge = 0): Promise<DecodedPixels> {
    const whole = await decodeImageBitmap(src, false);
    const sourceWidth = whole.width, sourceHeight = whole.height;
    const bitmap = await shrinkBitmap(whole, maxEdge);
    try {
        const pixels = readImagePixels(bitmap, maxEdge);
        // The bitmap was already made smaller, so the read cannot see what it was made from.
        return pixels.width < sourceWidth || pixels.height < sourceHeight ? { ...pixels, sourceWidth, sourceHeight } : pixels;
    } finally {
        bitmap.close?.();
    }
}

/**
 * A bitmap made no longer than `maxEdge` on its long side (the bitmap itself when it already is, or when there is no decoder to do it). The decoder makes
 * it smaller with the options it decoded with: left to its defaults a resize premultiplies, and the colour under a clear texel is gone, which a weight map
 * the ground is mixed by has all over it. The bitmap given is closed when a smaller one is made.
 */
export async function shrinkBitmap(bitmap: ImageBitmap, maxEdge: number): Promise<ImageBitmap> {
    const { width, height } = imageSizeAtEdge(bitmap.width, bitmap.height, maxEdge);
    if ((width === bitmap.width && height === bitmap.height) || typeof createImageBitmap !== 'function') return bitmap;
    try {
        const smaller = await createImageBitmap(bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
        });
        bitmap.close?.();
        return smaller;
    } catch {
        // Some hosts can decode the file but cannot resize a bitmap. The pixel reader fits the canvas.
        return bitmap;
    }
}

/**
 * The RGBA of an image that is already decoded, in its own row order.
 *
 * `ImageData` is unpremultiplied by definition, so these bytes are the upload as
 * they stand: dividing them by alpha again drives every half-transparent texel
 * toward white, and an RGBM texel — whose alpha IS its brightness — to grey.
 */
export function readImagePixels(image: PlatformImage | ImageBitmap, maxEdge = 0): DecodedPixels {
    const { width, height } = imageSizeAtEdge(image.width, image.height, maxEdge);
    // A bitmap of the size asked for is read as the texels it holds; anything else goes through a canvas, which scales and which is what hosts without GL have.
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap && width === image.width && height === image.height) {
        const texels = readBitmapTexels(image, width, height);
        if (texels) return { width, height, pixels: texels };
    }
    const canvas = platformCreateCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('imageDecode: 2D context unavailable for pixel decode');
    return readCanvasPixels(image, width, height, ctx);
}

/**
 * Fetch a URL and decode it to top-first RGBA pixels. The single fetch→blob→decode
 * path the runtime asset sources use for `estella://` / http origins (a CORS-mode
 * `<img>` taints the canvas on custom schemes; fetch→blob sidesteps it). Uses the
 * global `fetch` — these callers all run in a browser/electron context.
 */
export async function fetchDecodePixels(url: string, maxEdge = 0): Promise<DecodedPixels> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch failed (${res.status}): ${url}`);
    return decodeImagePixels(await res.blob(), maxEdge);
}
