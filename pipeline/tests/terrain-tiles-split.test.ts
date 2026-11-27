// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { parseTerrainTiles, sampleHeight, type Heightfield } from 'esengine';
import { splitTerrain } from '../src/world/terrainTiles';

const field = (w: number, h: number): Heightfield => ({ width: w, height: h,
    data: Float32Array.from({ length: w * h }, (_, k) => 0.5 + 0.4 * Math.sin((k % w) / 13) * Math.cos(Math.floor(k / w) / 9)) });
const heights = (p: { width: number; height: number; rgba: Uint8Array }): Heightfield =>
    ({ width: p.width, height: p.height, data: Float32Array.from({ length: p.width * p.height }, (_, k) => (p.rgba[k * 4]! * 256 + p.rgba[k * 4 + 1]!) / 65535) });

describe('splitTerrain', () => {
    it('cuts a field into tiles that share their edges and give back its heights', () => {
        const f = field(129, 65);
        const out = splitTerrain(f, null, null, { dir: 'assets/ground', name: 'island', tileSamples: 33 });
        const doc = parseTerrainTiles(JSON.parse(JSON.stringify(out.document)));
        expect([doc.tilesX, doc.tilesZ, doc.tiles.length]).toEqual([4, 2, 8]);
        expect(out.documentPath).toBe('assets/ground/island.esterrain');
        const a = heights(out.images.get('assets/ground/island_0_0.png')!), b = heights(out.images.get('assets/ground/island_1_0.png')!);
        for (let j = 0; j < 33; j++) expect(a.data[j * 33 + 32]).toBe(b.data[j * 33]);
        for (let j = 0; j < 33; j += 8) for (let i = 0; i < 33; i += 8) {
            expect(b.data[j * 33 + i]).toBeCloseTo(f.data[j * 129 + 32 + i]!, 4);
        }
    });

    it('resamples a field that is not a whole number of tiles, and keeps its shape', () => {
        const f = field(100, 100);
        const out = splitTerrain(f, null, null, { dir: 'g', name: 'x', tileSamples: 33, overviewSamples: 17 });
        expect([out.document.tilesX, out.document.tilesZ]).toEqual([4, 4]);
        const o = heights(out.images.get(out.document.overview)!);
        expect([o.width, o.height]).toEqual([17, 17]);
        expect(o.data[8 * 17 + 8]).toBeCloseTo(sampleHeight(f, 0.5, 0.5), 4);
    });

    it('resamples both splatmaps byte-for-byte across tile edges and the overview', () => {
        const paint = (width: number, height: number, seed: number) => {
            const pixels = new Uint8Array(width * height * 4 + 1).subarray(1);
            for (let i = 0; i < pixels.length; i++) pixels[i] = (i % 8 === 3 ? 0 : i * 13 + seed) % 256;
            return { width, height, pixels };
        };
        const first = paint(4, 4, 17), second = paint(3, 2, 91);
        const out = splitTerrain(field(9, 5), first, second, { dir: 'g', name: 'x', tileSamples: 5, overviewSamples: 5 });
        const check = (path: string | undefined, source: typeof first, width: number, height: number, uAt: (x: number) => number) => {
            const image = out.images.get(path!)!;
            expect([image.width, image.height]).toEqual([width, height]);
            const expected = [];
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const sx = Math.round(uAt(x) * (source.width - 1));
                const sy = Math.round(y / (height - 1) * (source.height - 1));
                expected.push(...source.pixels.subarray((sy * source.width + sx) * 4, (sy * source.width + sx + 1) * 4));
            }
            expect(image.rgba).toEqual(Uint8Array.from(expected));
        };
        for (const tile of out.document.tiles) {
            check(tile.splat, first, 5, 5, x => (tile.x * 4 + x) / 8);
            check(tile.splat2, second, 5, 5, x => (tile.x * 4 + x) / 8);
        }
        check(out.document.overviewSplat, first, 5, 3, x => x / 4);
        check(out.document.overviewSplat2, second, 5, 3, x => x / 4);
    });
});
