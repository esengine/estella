// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { HeightmapFormat, type Heightfield } from '../src/terrain/heightfield';
import { GroundEdit } from '../src/terrain/groundEdit';
import { TiledGroundEdit } from '../src/terrain/tiledGroundEdit';
import { FieldSource, ModifiedSource } from '../src/terrain/source';
import { SculptMode } from '../src/terrain/sculpt';
import { TiledSource, type TerrainImage, type TerrainTilesDocument } from '../src/terrain/tiles';

const T = 17, TILES = 3, N = TILES * (T - 1) + 1, SIZE = 480, HEIGHT = 100;
const params = { sizeX: SIZE, sizeZ: SIZE, height: HEIGHT, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
const q = (v: number): number => Math.round(v * 65535) / 65535;
const ground = (i: number, j: number): number => q(0.5 + 0.3 * Math.sin(i / 5) * Math.cos(j / 7));

function image(width: number, at: (i: number, j: number) => number): TerrainImage {
    const pixels = new Uint8Array(width * width * 4);
    for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) {
        const v = Math.round(at(i, j) * 65535);
        pixels.set([v >> 8, v & 255, 0, 255], (j * width + i) * 4);
    }
    return { width, height: width, pixels };
}

function tiled(budget?: number) {
    const files = new Map<string, TerrainImage>();
    const doc: TerrainTilesDocument = { version: 1, tileSamples: T, tilesX: TILES, tilesZ: TILES, format: HeightmapFormat.RedGreen16, overview: 'o.png', tiles: [] };
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
        files.set(`t${tx}_${tz}.png`, image(T, (i, j) => ground(tx * (T - 1) + i, tz * (T - 1) + j)));
        doc.tiles.push({ x: tx, z: tz, height: `t${tx}_${tz}.png` });
    }
    const overview: Heightfield = { width: 9, height: 9, data: Float32Array.from({ length: 81 }, (_, k) => ground((k % 9) * 6, Math.floor(k / 9) * 6)) };
    const reads: string[] = [];
    const source = new TiledSource(doc, params, overview, null, null, async (p) => { reads.push(p); return files.get(p) ?? null; }, budget);
    const modified = new ModifiedSource(source, () => [], { x: 0, y: 0, z: 0 }, 1);
    const remade: number[][] = [];
    const edit = new TiledGroundEdit({ remake: (b) => remade.push([...b]) }, source, modified, SIZE, SIZE);
    return { source, edit, reads, remade };
}

function whole() {
    const field: Heightfield = { width: N, height: N, data: Float32Array.from({ length: N * N }, (_, k) => ground(k % N, Math.floor(k / N))) };
    const source = new FieldSource(field, params, null, null);
    return { field, edit: new GroundEdit({ remake: () => {} }, source, new ModifiedSource(source, () => [], { x: 0, y: 0, z: 0 }, 1), SIZE, SIZE) };
}

async function loadAll(source: TiledSource): Promise<void> {
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) await source.readTile(tx, tz);
}

function stitched(source: TiledSource): Float32Array {
    const out = new Float32Array(N * N), n = T - 1;
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
        const tile = source.tileAt(tx, tz)!;
        for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
            const g = (tz * n + j) * N + tx * n + i, v = tile.field.data[j * T + i]!;
            out[g] = v;
        }
    }
    return out;
}

const seam = -SIZE / 2 + (T - 1) * SIZE / (N - 1);

describe('brushes on ground kept as tiles', () => {
    for (const [name, mode, amount] of [['raise', SculptMode.Raise, 12], ['smooth', SculptMode.Smooth, 0.8], ['flatten', SculptMode.Flatten, 0.6]] as const) {
        it(`${name} across a seam leaves the same ground as on one heightfield, and the seam one height`, async () => {
            const t = tiled(), w = whole();
            await loadAll(t.source);
            for (const [x, z] of [[seam, seam], [seam + 7, seam - 11], [-200, 150]]) {
                t.edit.sculpt(mode, x!, z!, 40, 0.5, amount, 60);
                w.edit.sculpt(mode, x!, z!, 40, 0.5, amount, 60);
            }
            const got = stitched(t.source);
            let worst = 0;
            for (let k = 0; k < N * N; k++) worst = Math.max(worst, Math.abs(got[k]! - w.field.data[k]!));
            expect(worst).toBeLessThan(1e-6);
            const n = T - 1, a = t.source.tileAt(0, 0)!, b = t.source.tileAt(1, 0)!;
            for (let j = 0; j < T; j++) expect(a.field.data[j * T + n]).toBe(b.field.data[j * T]);
        });
    }

    it('skips a dab over a tile not in memory, and reads it for the next', async () => {
        const t = tiled();
        await t.source.readTile(0, 0);
        t.reads.length = 0;
        t.edit.sculpt(SculptMode.Raise, seam, -200, 30, 0.5, 10);
        expect(t.remade).toEqual([]);
        expect(t.reads).toEqual(['t1_0.png']);
        await t.source.readTile(1, 0);
        t.edit.sculpt(SculptMode.Raise, seam, -200, 30, 0.5, 10);
        expect(t.remade).toHaveLength(1);
    });

    it('keeps a changed tile in memory past the budget until it is saved', async () => {
        const one = T * T * 4;
        const t = tiled(one);
        await t.source.readTile(0, 0);
        t.edit.sculpt(SculptMode.Raise, -220, -220, 10, 0.5, 10);
        await t.source.readTile(2, 2);
        expect(t.source.tileAt(0, 0)).toBeDefined();
        expect(t.edit.unsaved).toEqual(['0:0']);
        t.edit.saved();
        await t.source.readTile(2, 1);
        expect(t.source.tileAt(0, 0)).toBeUndefined();
    });

    it('takes a stroke back and puts it again, in the tiles and the overview', async () => {
        const t = tiled();
        await loadAll(t.source);
        const before = stitched(t.source), overview = Float32Array.from(t.source.overview.data);
        t.edit.begin();
        t.edit.sculpt(SculptMode.Raise, seam, seam, 50, 0.5, 30);
        t.edit.sculpt(SculptMode.Raise, seam + 20, seam, 50, 0.5, 30);
        const patch = t.edit.end()!;
        const after = stitched(t.source), overviewAfter = Float32Array.from(t.source.overview.data);
        expect(overviewAfter).not.toEqual(overview);
        t.edit.apply(patch, 'before');
        expect(stitched(t.source)).toEqual(before);
        expect(t.source.overview.data).toEqual(overview);
        t.edit.apply(patch, 'after');
        expect(stitched(t.source)).toEqual(after);
        expect(t.source.overview.data).toEqual(overviewAfter);
    });

    it('draws distant ground from the overview as the stroke left it', async () => {
        const t = tiled();
        await loadAll(t.source);
        const at = () => t.source.region(0, 0, 60, 1);
        const was = (at() as { heights: Float32Array }).heights[0]!;
        t.edit.sculpt(SculptMode.Raise, 0, 0, 80, 0.5, 30);
        expect((at() as { heights: Float32Array }).heights[0]!).toBeGreaterThan(was + 10);
    });

    it('saves the changed tiles and the overview, and names the splatmaps it made', async () => {
        const t = tiled();
        await loadAll(t.source);
        t.edit.paint(2, -220, -220, 20, 0.5, 1);
        const out = t.edit.saveImages();
        expect(out.images.map((i) => i.path).sort()).toEqual(['o.png', 'o_splat.png', 't0_0.png', 't0_0_splat.png']);
        expect(out.document?.tiles.find((e) => e.x === 0 && e.z === 0)?.splat).toBe('t0_0_splat.png');
        expect(out.document?.overviewSplat).toBe('o_splat.png');
    });
});

describe('a heightmap in and out of ground kept as tiles', () => {
    const heightsOf = (img: { width: number; height: number; pixels: Uint8Array }): Float32Array =>
        Float32Array.from({ length: img.width * img.height }, (_, k) => (img.pixels[k * 4]! * 256 + img.pixels[k * 4 + 1]!) / 65535);

    it('exports every tile as the whole field', async () => {
        const t = tiled();
        const out = (await t.edit.exportImage('all'))!;
        expect([out.width, out.height]).toEqual([N, N]);
        const got = heightsOf(out);
        for (let k = 0; k < N * N; k++) expect(got[k]).toBeCloseTo(ground(k % N, Math.floor(k / N)), 4);
    });

    it('exports what is loaded at the whole size, the rest from the overview, reading nothing', async () => {
        const t = tiled();
        await t.source.readTile(1, 0);
        await t.source.readTile(2, 1);
        t.reads.length = 0;
        const out = (await t.edit.exportImage('loaded'))!;
        expect(t.reads).toEqual([]);
        expect([out.width, out.height]).toEqual([N, N]);
        const got = heightsOf(out);
        expect(got[3 * N + T - 1 + 3]).toBeCloseTo(ground(T - 1 + 3, 3), 4);
        const off = -SIZE / 2 + 3 * SIZE / (N - 1);
        const fromOverview = (t.source.region(off, off, 1e9, 1) as { heights: Float32Array }).heights[0]! / HEIGHT;
        expect(got[3 * N + 3]).toBeCloseTo(fromOverview, 4);
        expect(await tiled().edit.exportImage('loaded')).toBeNull();
    });

    it('imports onto every tile, or only those in memory, and the overview follows', async () => {
        const flat: Heightfield = { width: 5, height: 5, data: new Float32Array(25).fill(0.25) };
        const all = tiled();
        await all.source.readTile(0, 0);
        const written = all.edit.importImage(flat, 'all').map((i) => i.path);
        expect(written.length).toBe(TILES * TILES + 1);
        expect(all.source.height(-230, -230)).toBeCloseTo(25, 4);
        expect(all.source.overview.data.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);

        const some = tiled();
        await some.source.readTile(0, 0);
        expect(some.edit.importImage(flat, 'loaded').map((i) => i.path)).toEqual(['t0_0.png', 'o.png']);
        expect(some.source.overview.data[0]).toBeCloseTo(0.25, 6);
        expect(some.source.overview.data[80]).not.toBeCloseTo(0.25, 3);
    });

    it('refuses to import over changes not saved', async () => {
        const t = tiled();
        await loadAll(t.source);
        t.edit.sculpt(SculptMode.Raise, 0, 0, 30, 0.5, 10);
        expect(() => t.edit.importImage({ width: 2, height: 2, data: new Float32Array(4) }, 'all')).toThrow(/save or undo/);
    });
});
