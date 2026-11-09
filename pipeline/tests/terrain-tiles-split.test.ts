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

    it('cuts the splatmaps with the heights', () => {
        const s = { width: 4, height: 4, pixels: Uint8Array.from({ length: 64 }, (_, k) => k * 4) };
        const out = splitTerrain(field(65, 65), s, null, { dir: 'g', name: 'x', tileSamples: 33 });
        expect(out.document.tiles.every((t) => t.splat && out.images.has(t.splat))).toBe(true);
        expect(out.images.has(out.document.overviewSplat!)).toBe(true);
    });
});
