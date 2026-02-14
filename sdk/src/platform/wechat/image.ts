/**
 * @file    image.ts
 * @brief   WeChat MiniGame image loading utilities
 */

/// <reference types="minigame-api-typings" />

// =============================================================================
// Types
// =============================================================================

export interface ImageLoadResult {
    width: number;
    height: number;
    pixels: Uint8Array;
}

// =============================================================================
// Canvas Management
// =============================================================================

function getOffscreenCanvas(width: number, height: number): {
    canvas: WechatMinigame.Canvas;
    ctx: CanvasRenderingContext2D;
} {
    const canvas = wx.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { canvas, ctx };
}

// =============================================================================
// Image Loading
// =============================================================================

/**
 * Load an image from a file path
 * @param path - File path relative to game root
 */
export function wxLoadImage(path: string): Promise<WechatMinigame.Image> {
    return new Promise((resolve, reject) => {
        const img = wx.createImage();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error(`Failed to load image: ${path}, ${err}`));
        img.src = path;
    });
}

/**
 * Extract pixel data from an image
 * @param img - Loaded image object
 */
export function wxGetImagePixels(img: WechatMinigame.Image): ImageLoadResult {
    const { width, height } = img;
    const { ctx } = getOffscreenCanvas(width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = new Uint8Array(imageData.data.buffer);

    return { width, height, pixels };
}

/**
 * Load image and get pixel data in one call
 * @param path - File path relative to game root
 */
export async function wxLoadImagePixels(path: string): Promise<ImageLoadResult> {
    const img = await wxLoadImage(path);
    return wxGetImagePixels(img);
}

