// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ParsedTextureImportSettings } from '../../../sdk/src/asset/textureImportSettings';

/** Raw RGBA8 with the top row first. */
export interface RgbaImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}

export type TextureWrap = NonNullable<ParsedTextureImportSettings['wrap']>;

function texel(index: number, size: number, wrap: TextureWrap): number {
    if (index >= 0 && index < size) return index;
    if (wrap === 'clamp') return Math.max(0, Math.min(index, size - 1));
    const period = wrap === 'repeat' ? size : 2 * size;
    const phase = ((index % period) + period) % period;
    return phase < size ? phase : period - 1 - phase;
}

/** Copy a source rectangle to (x, y). The surrounding texels reproduce sampling just outside its edges. */
export function copyPaddedRgba(
    source: RgbaImage, rect: { x: number; y: number; width: number; height: number },
    page: RgbaImage, x: number, y: number, padding: number, wrap: TextureWrap = 'clamp',
): void {
    const { width, height } = rect;
    if (width <= 0 || height <= 0) return;
    for (let row = -padding; row < height + padding; row++) {
        const sourceY = rect.y + texel(row, height, wrap);
        const from = 4 * (sourceY * source.width + rect.x);
        const to = 4 * ((y + row) * page.width + x);
        page.rgba.set(source.rgba.subarray(from, from + 4 * width), to);
        for (let i = 1; i <= padding; i++) {
            const left = to + 4 * texel(-i, width, wrap);
            const right = to + 4 * texel(width - 1 + i, width, wrap);
            page.rgba.copyWithin(to - 4 * i, left, left + 4);
            page.rgba.copyWithin(to + 4 * (width - 1 + i), right, right + 4);
        }
    }
}
