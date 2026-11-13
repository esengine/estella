// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    image-raster-revision.test.ts
 * @brief   The raster's revision names how it draws: the same sources come out as the same pixels for as long as the revision stands.
 *
 * @details A texture recipe drawn on a device is kept there under the raster's revision. If a change to the raster moves a pixel and the
 *          revision stays, every device goes on showing the picture the old raster drew. So the pixels of a few sources are pinned
 *          here beside the revision: when they move, raise IMAGE_RASTER_REVISION and pin them again.
 */
import { describe, expect, it } from 'vitest';
import { contentHashHex } from '../src/asset/contentHash';
import { IMAGE_RASTER_REVISION, renderImage } from '../src/image/imageRaster';
import { validateImageSource } from '../src/image/imageSource';

const SOURCES: Record<string, unknown> = {
    shapes: { size: 64, background: '#102030', layers: [
        { shape: 'rect', at: [6, 6], size: [30, 20], radius: 5, fill: '#e04030', stroke: { color: '#ffffff', width: 2 } },
        { shape: 'circle', at: [44, 40], radius: 14, fill: { type: 'radial', at: [40, 36], radius: 16, stops: [[0, '#ffe080'], [1, '#804000']] } },
        { shape: 'star', at: [18, 46], radius: 12, inner: 5, count: 5, fill: '#40c0ff', opacity: 0.8 },
    ] },
    noise: { size: 64, tile: true, layers: [
        { shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'noise', scale: 20, octaves: 4, seed: 9, stops: [[0, '#203040'], [1, '#c0d0e0']] } },
        { shape: 'rect', at: [0, 24], size: [64, 12], fill: { type: 'linear', from: [0, 24], to: [0, 36], stops: [[0, '#ffcc00'], [1, '#aa6600']] }, blur: 1.5 },
    ] },
    grid: { size: [96, 48], background: '#181818', layers: [
        { shape: 'rect', at: [0, 0], size: [96, 48], fill: { type: 'grid', cell: [12, 12], mark: [0.5, 0.5], colors: ['#f0f0f0', '#909090'], lit: 0.7, off: '#303030', seed: 4 } },
    ] },
};

/** The pixels of each source as revision 1 draws them (their XXH64). */
const PINNED: Record<string, Record<string, string>> = {
    '1': { shapes: 'bfd5719385b5613f', noise: 'b437c52dead56ad9', grid: '01b167b54446f44c' },
};

describe('the image raster\'s revision', () => {
    it('has its pixels pinned: a change that moves one raises IMAGE_RASTER_REVISION', () => {
        const pinned = PINNED[IMAGE_RASTER_REVISION];
        expect(pinned, `no pixels are pinned for revision ${IMAGE_RASTER_REVISION}`).toBeDefined();
        const drawn = Object.fromEntries(Object.entries(SOURCES).map(([name, source]) => [name, contentHashHex(renderImage(validateImageSource(source)).rgba)]));
        expect(drawn).toEqual(pinned);
    });
});
