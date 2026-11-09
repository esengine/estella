// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { HeightmapFormat, sampleHeight, type Heightfield } from '../src/terrain/heightfield';
import { TiledSource, parseTerrainTiles, type TerrainImage, type TerrainTilesDocument } from '../src/terrain/tiles';

const T = 9, TILES = 4, N = TILES * (T - 1) + 1, SIZE = 640, HEIGHT = 100;
const ground = (u: number, v: number): number => 0.5 + 0.4 * Math.sin(u * 7) * Math.cos(v * 5);
const params = { sizeX: SIZE, sizeZ: SIZE, height: HEIGHT, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };

function image(width: number, height: number, at: (i: number, j: number) => number): TerrainImage {
    const pixels = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        const v = Math.round(at(i, j) * 65535);
        pixels.set([v >> 8, v & 255, 0, 255], (j * width + i) * 4);
    }
    return { width, height, pixels };
}

function world(budget?: number) {
    const files = new Map<string, TerrainImage>();
    const doc: TerrainTilesDocument = { version: 1, tileSamples: T, tilesX: TILES, tilesZ: TILES, format: HeightmapFormat.RedGreen16, overview: 'o.png', tiles: [] };
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
        const name = `t${tx}_${tz}.png`;
        files.set(name, image(T, T, (i, j) => ground((tx * (T - 1) + i) / (N - 1), (tz * (T - 1) + j) / (N - 1))));
        doc.tiles.push({ x: tx, z: tz, height: name });
    }
    const o = image(5, 5, (i, j) => ground(i / 4, j / 4));
    const overview: Heightfield = { width: 5, height: 5, data: Float32Array.from({ length: 25 }, (_, k) => (o.pixels[k * 4]! * 256 + o.pixels[k * 4 + 1]!) / 65535) };
    const reads: string[] = [];
    const read = async (path: string) => { reads.push(path); return files.get(path) ?? null; };
    return { source: new TiledSource(doc, params, overview, null, null, read, budget), reads };
}

const exact = (x: number, z: number): number => {
    const whole: Heightfield = { width: N, height: N, data: Float32Array.from({ length: N * N }, (_, k) => {
        const v = ground((k % N) / (N - 1), Math.floor(k / N) / (N - 1));
        return Math.round(v * 65535) / 65535;
    }) };
    return HEIGHT * sampleHeight(whole, x / SIZE + 0.5, z / SIZE + 0.5);
};

describe('ground kept as tiles', () => {
    it('reads nothing until a height is asked for, then only the tile under it', async () => {
        const { source, reads } = world();
        expect(reads).toEqual([]);
        expect(source.height(-300, -300)).toBeNull();
        await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
        expect(reads).toEqual(['t0_0.png']);
        expect(source.height(-300, -300)).toBeCloseTo(exact(-300, -300), 6);
    });

    it('answers a seam from either tile the same as the whole field does', async () => {
        const { source } = world();
        const seam = -SIZE / 2 + (T - 1) * SIZE / (N - 1);
        await source.region(seam - 20, 0, 5, 9);
        for (const x of [seam - 1e-3, seam, seam + 1e-3]) expect(source.height(x, 3)).toBeCloseTo(exact(x, 3), 4);
    });

    it('makes a page as coarse as the overview from it alone, and a finer one from the tiles it covers', async () => {
        const { source, reads } = world();
        const coarse = source.region(-320, -320, 160, 5);
        expect(coarse).not.toBeInstanceOf(Promise);
        expect(reads).toEqual([]);
        const fine = await source.region(-320, -320, 30, 9);
        expect(reads.sort()).toEqual(['t0_0.png', 't1_0.png', 't0_1.png', 't1_1.png'].sort());
        expect(fine.heights[0]).toBeCloseTo(exact(-320, -320), 4);
        expect(source.region(-320, -320, 30, 9)).not.toBeInstanceOf(Promise);
    });

    it('lets go of the least recently used tiles past its budget, and reads them again when asked', async () => {
        const one = T * T * 4;
        const { source, reads } = world(one * 2);
        for (const x of [-300, -140, 20]) await source.region(x, -300, 1, 2);
        expect(source.stats()).toMatchObject({ resident: 2, evictions: 1, bytes: one * 2 });
        reads.length = 0;
        await source.region(-300, -300, 1, 2);
        expect(reads).toEqual(['t0_0.png']);
    });

    it('refuses a document whose tiles fall outside its grid, or are listed twice', () => {
        const doc = { version: 1, tileSamples: 9, tilesX: 1, tilesZ: 1, overview: 'o.png', tiles: [{ x: 0, z: 0, height: 'a.png' }] };
        expect(parseTerrainTiles(doc).tiles).toHaveLength(1);
        expect(() => parseTerrainTiles({ ...doc, tiles: [{ x: 1, z: 0, height: 'a.png' }] })).toThrow(/outside/);
        expect(() => parseTerrainTiles({ ...doc, tiles: [doc.tiles[0], doc.tiles[0]] })).toThrow(/twice/);
    });
});
