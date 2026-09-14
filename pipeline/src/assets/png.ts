// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    png.ts
 * @brief   Raw pixels to PNG bytes, for the imports that compute an image.
 *
 * Its own file because two unrelated bakes need it — an environment's atlas and
 * a lightmap's — and the second reaching into the first for it is how a third
 * copy gets written.
 */
import { PNG } from 'pngjs';

/** Encode raw RGBA8 (row 0 = top) as PNG bytes. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const png = new PNG({ width, height });
    png.data = Buffer.from(rgba);
    return new Uint8Array(PNG.sync.write(png));
}
