// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    recipeWorker.ts
 * @brief   The worker that draws texture recipes: a picture's source in, its pixels out, off the thread the game runs on.
 *
 * @details This file is bundled on its own (sdk/scripts/build-worker.mjs) into text `esengine/image` starts its workers from, as the
 *          planning worker is. A job is `{ id, source }`; its answer is `{ id, result: { width, height, pixels } }` with the pixels'
 *          own buffer handed over, or `{ id, error }`.
 */
import { renderImage } from './imageRaster';
import { validateImageSource } from './imageSource';

/** The pixels a source draws, in a buffer of their own (one a worker can hand over whole). */
export function drawRecipe(source: string): { width: number; height: number; pixels: Uint8Array } {
    const picture = renderImage(validateImageSource(JSON.parse(source)));
    const whole = picture.rgba.byteOffset === 0 && picture.rgba.byteLength === picture.rgba.buffer.byteLength;
    return { width: picture.width, height: picture.height, pixels: whole ? picture.rgba : picture.rgba.slice() };
}

declare const self: { onmessage: ((e: { data: { id: number; source: string } }) => void) | null; postMessage(m: unknown, transfer?: ArrayBuffer[]): void } | undefined;

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
    self.onmessage = (e) => {
        const job = e.data;
        try {
            const drawn = drawRecipe(job.source);
            self!.postMessage({ id: job.id, result: drawn }, [drawn.pixels.buffer as ArrayBuffer]);
        } catch (err) {
            self!.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
        }
    };
}
