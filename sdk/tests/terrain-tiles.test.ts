// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { HeightmapFormat, sampleHeight, type Heightfield } from '../src/terrain/heightfield';
import { TiledSource, parseTerrainTiles, type TerrainImage, type TerrainTilesDocument } from '../src/terrain/tiles';
import { terrainPaintTargets } from '../src/terrain/paintLayers';
import { makePage, PAGE_SIDE, PAGE_TEXELS } from '../src/terrain/pages';

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
    return { source: new TiledSource(doc, params, overview, null, null, read, budget), files, reads };
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

    it('reports a height tile whose dimensions do not match the manifest grid', async () => {
        const { source, files } = world();
        files.set('t0_0.png', image(8, T, () => 0.5));
        await expect(source.region(-300, -300, 1, 2)).rejects.toThrow('terrain tile 0:0 (t0_0.png) is 8 by 9, not 9 a side');
        expect(source.stats().resident).toBe(0);
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

    it('uses a standalone second paint map in overview, detailed pages and point queries', async () => {
        const { source: base, files } = world();
        const overlay = (alpha: number): TerrainImage => ({ width: 2, height: 2,
            pixels: Uint8Array.from([alpha, 0, 0, 0, alpha, 0, 0, 0, alpha, 0, 0, 0, alpha, 0, 0, 0]) });
        base.doc.tiles[0].splat2 = 'detail-paint.png';
        files.set('detail-paint.png', overlay(192));
        const source = new TiledSource(base.doc, params, base.overview, null, overlay(64), async path => files.get(path) ?? null);
        const names = ['grass', 'dirt', 'snow', 'rock', 'trail'];
        source.paintLayout = terrainPaintTargets(names, [
            { name: 'trail', slot: 4, blend: 'alpha', info: '', physicalMaterial: '', hardness: 0.5 },
        ]);
        const x = -300, z = -300;
        const overview = await source.region(x, z, source.overviewSpacing, 1);
        expect(overview.paint?.[0]).toBeCloseTo(191 / 255);
        expect(overview.paint2?.[0]).toBeCloseTo(64 / 255);
        expect(source.paint(x, z, 0, 1)[4]).toBeCloseTo(64 / 255);
        expect((await makePage(source, x, z, source.overviewSpacing * PAGE_TEXELS)).paint2[0]).toBe(64);

        const detail = await source.region(x, z, 1, 1);
        expect(detail.paint?.[0]).toBeCloseTo(63 / 255);
        expect(detail.paint2?.[0]).toBeCloseTo(192 / 255);
        expect(source.paint(x, z, 0, 1)[4]).toBeCloseTo(192 / 255);
        expect((await makePage(source, x, z, 32)).paint2[0]).toBe(192);
    });

    it('composites each overview sample like a point query across both paint banks', async () => {
        const { source: base } = world();
        const primary = { width: 2, height: 2, pixels: Uint8Array.of(0, 255, 0, 0, 0, 0, 0, 0, 0, 32, 128, 0, 255, 0, 0, 0) };
        const secondary = { width: 2, height: 2, pixels: Uint8Array.of(128, 0, 0, 0, 0, 0, 0, 0, 64, 192, 0, 0, 0, 255, 0, 0) };
        const source = new TiledSource(base.doc, params, base.overview, primary, secondary, async () => null);
        const names = ['grass', 'dirt', 'snow', 'rock', 'mud', 'trail'];
        source.paintLayout = terrainPaintTargets(names, names.slice(4).map((name, i) => ({
            name, slot: 5 - i, blend: 'alpha', info: '', physicalMaterial: '', hardness: 0.5,
        })));
        const start = -SIZE / 2, spacing = source.overviewSpacing, count = base.overview.width;
        const region = await source.region(start, start, spacing, count);
        for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) {
            const at = (z * count + x) * 4;
            const point = Float32Array.from(source.paint(start + x * spacing, start + z * spacing, 0, 1));
            expect(region.paint?.slice(at, at + 4)).toEqual(point.slice(0, 4));
            expect(region.paint2?.slice(at, at + 4)).toEqual(point.slice(4, 8));
        }
    });

    it.each([0, 255])('keeps procedural paint beside a tile whose authored snow weight is %i', async snow => {
        const { source: base, files } = world();
        base.doc.tiles[0].splat = 'paint.png';
        files.set('paint.png', { width: 2, height: 2, pixels: Uint8Array.from({ length: 16 }, (_, i) => i % 4 === 2 ? snow : 0) });
        for (const tile of base.doc.tiles.slice(0, 2)) files.set(tile.height, image(T, T, () => 0.72));
        const source = new TiledSource(base.doc, params, base.overview, null, null, async path => files.get(path) ?? null);
        source.paintLayout = terrainPaintTargets(['grass', 'dirt', 'snow', 'rock']);
        const x = -192, z = -300;
        const page = await makePage(source, x, z, PAGE_TEXELS);
        const bytes = (i: number) => [...page.paint.slice((PAGE_SIDE + i) * 4, (PAGE_SIDE + i + 1) * 4)];
        expect(bytes(1)).toEqual([255 - snow, 0, snow, 0]);
        const unpaintedX = x + 40;
        const expected = source.paint(unpaintedX, z, source.height(unpaintedX, z)!, 1).slice(0, 4).map(w => Math.round(w * 255));
        expect(expected[1]).toBeGreaterThan(0);
        expect(bytes(41)).toEqual(expected);
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

    it('keeps to a budget lowered after it was made, as a quality level changing hands it one', async () => {
        const one = T * T * 4;
        const { source } = world();
        for (const x of [-300, -140, 20]) await source.region(x, -300, 1, 2);
        expect(source.stats().resident).toBe(3);
        source.budget = one;
        await source.region(180, -300, 1, 2);
        expect(source.stats()).toMatchObject({ resident: 1, bytes: one });
    });

    it('requires in-grid, unique tiles with named heights', () => {
        const doc = { version: 1, tileSamples: 9, tilesX: 1, tilesZ: 1, overview: 'o.png', tiles: [{ x: 0, z: 0, height: 'a.png' }] };
        expect(parseTerrainTiles(doc).tiles).toHaveLength(1);
        expect(() => parseTerrainTiles({ ...doc, tiles: [{ x: 1, z: 0, height: 'a.png' }] })).toThrow(/outside/);
        expect(() => parseTerrainTiles({ ...doc, tiles: [doc.tiles[0], doc.tiles[0]] })).toThrow(/twice/);
        expect(() => parseTerrainTiles({ ...doc, tiles: [{ x: 0, z: 0, height: '' }] })).toThrow(/names no heights/);
    });

    it('rejects invalid paint image references and unsupported height formats', () => {
        const doc = { version: 1, tileSamples: 9, tilesX: 1, tilesZ: 1, overview: 'o.png', tiles: [{ x: 0, z: 0, height: 'a.png' }] };
        expect(() => parseTerrainTiles({ ...doc, overviewSplat: 42 })).toThrow(/overviewSplat/);
        expect(() => parseTerrainTiles({ ...doc, tiles: [{ ...doc.tiles[0], splat2: { path: 'paint.png' } }] })).toThrow(/tile 0:0.*splat2/);
        expect(() => parseTerrainTiles({ ...doc, format: 2 })).toThrow(/heightmap format/);
        expect(parseTerrainTiles({ ...doc, overviewSplat: null, overviewSplat2: '' }).format).toBe(HeightmapFormat.RedGreen16);
    });
});
