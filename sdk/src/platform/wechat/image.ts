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

let offscreenCanvas: WechatMinigame.Canvas | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

function getOffscreenCanvas(width: number, height: number): {
    canvas: WechatMinigame.Canvas;
    ctx: CanvasRenderingContext2D;
} {
    if (!offscreenCanvas) {
        offscreenCanvas = wx.createCanvas();
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        offscreenCtx = offscreenCanvas.getContext('2d') as CanvasRenderingContext2D;
    }

    if (offscreenCanvas.width < width || offscreenCanvas.height < height) {
        offscreenCanvas.width = Math.max(offscreenCanvas.width, width);
        offscreenCanvas.height = Math.max(offscreenCanvas.height, height);
    }

    return { canvas: offscreenCanvas, ctx: offscreenCtx! };
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

