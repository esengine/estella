// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    render/uvRect.ts
 * @brief   A rectangle of a picture, in pixels, as the UV window a sprite shows.
 *
 * Texture space has v growing UP: v = 0 is the image's LAST row, v = 1 its first.
 * Pixel rectangles (an atlas packer, a sheet grid, an image editor) are measured
 * from the TOP. The conversion between the two lives here once — written out by
 * hand it comes out upside down, and a quad that shows the whole picture never
 * says so.
 */

/** The window `Sprite.uvOffset` / `uvScale` (and `UIVisual`'s) take. */
export interface UvRect {
    uvOffset: { x: number; y: number };
    uvScale: { x: number; y: number };
}

/**
 * The UV window of a pixel rectangle in a @p textureWidth x @p textureHeight
 * picture, the rectangle's @p y measured DOWN from the top edge as image tools
 * measure it. Spread the result into a `Sprite` to show exactly that cell.
 */
export function uvRectFromPixels(
    rect: { x: number; y: number; width: number; height: number },
    textureWidth: number,
    textureHeight: number,
): UvRect {
    return {
        uvOffset: {
            x: rect.x / textureWidth,
            y: 1 - (rect.y + rect.height) / textureHeight,
        },
        uvScale: {
            x: rect.width / textureWidth,
            y: rect.height / textureHeight,
        },
    };
}
