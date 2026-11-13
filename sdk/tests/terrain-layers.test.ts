// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { setWorldUnitsPerMeter, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';
import { packLayers, parseTerrainLayer, type LayerImage } from '../src/terrain/layers';
import { FieldSource } from '../src/terrain/source';
import { makePage, PAGE_SIDE } from '../src/terrain/pages';

const solid = (size: number, rgba: [number, number, number, number]): LayerImage => {
    const pixels = new Uint8Array(size * size * 4);
    for (let k = 0; k < size * size; k++) pixels.set(rgba, k * 4);
    return { width: size, height: size, pixels };
};

afterEach(() => setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER));

describe('a terrain layer file', () => {
    it('takes what it names and puts the rest at their defaults', () => {
        const l = parseTerrainLayer({ albedo: 'assets/grass.png', tile: 3 });
        expect(l).toMatchObject({ albedo: 'assets/grass.png', normal: undefined, mask: undefined, tile: 3, tint: [1, 1, 1], roughness: 0.9, normalStrength: 1 });
    });

    it('repeats every 4 m when it names no tile, in the units of the project', () => {
        expect(parseTerrainLayer({}).tile).toBe(400);
        setWorldUnitsPerMeter(1);
        expect(parseTerrainLayer({}).tile).toBeCloseTo(4);
        // What a file states is the project's already.
        expect(parseTerrainLayer({ tile: 3 }).tile).toBe(3);
    });

    it('keeps a height blend of its own only when it names one', () => {
        expect(parseTerrainLayer({ tile: 3 }).heightBlend).toBeUndefined();
        expect(parseTerrainLayer({ tile: 3, heightBlend: 0.15 }).heightBlend).toBe(0.15);
        expect(() => parseTerrainLayer({ heightBlend: 2 }, 'g.esterrainlayer')).toThrow(/g\.esterrainlayer\.heightBlend/);
    });

    it('says which field it cannot take', () => {
        expect(() => parseTerrainLayer({ tile: -1 }, 'g.esterrainlayer')).toThrow(/g\.esterrainlayer\.tile/);
        expect(() => parseTerrainLayer({ tint: [1, 1] })).toThrow(/tint/);
    });
});

describe('packing layers', () => {
    const grass = parseTerrainLayer({ tile: 2, tint: [0.5, 1, 1] });
    const rock = parseTerrainLayer({ tile: 8, roughness: 0.4, normalStrength: 0 });

    it('packs every layer at the largest texture\'s size, to a power of two within the limit', () => {
        const packed = packLayers([
            { def: grass, albedo: solid(48, [200, 100, 50, 255]), normal: null, mask: null },
            { def: rock, albedo: null, normal: solid(16, [255, 128, 128, 255]), mask: null },
        ], 1024);
        expect(packed.size).toBe(64);
        expect(packed.albedo).toHaveLength(2);
        expect(packed.albedo[0]!.length).toBe(64 * 64 * 4);
        expect(packed.tiles).toEqual([2, 8]);
        // A layer with no height blend of its own is -1, which the shader reads as the material's.
        expect(packed.heightBlends).toEqual([-1, -1]);
        const own = packLayers([{ def: parseTerrainLayer({ heightBlend: 0.2 }), albedo: null, normal: null, mask: null }, { def: rock, albedo: null, normal: null, mask: null }]);
        expect(own.heightBlends).toEqual([0.2, -1]);
        expect(packLayers([{ def: grass, albedo: solid(4096, [0, 0, 0, 255]), normal: null, mask: null }], 512).size).toBe(512);
    });

    it('multiplies the tint into the albedo through sRGB, and makes up what a layer leaves out', () => {
        const packed = packLayers([
            { def: grass, albedo: solid(16, [200, 100, 50, 255]), normal: null, mask: null },
            { def: rock, albedo: null, normal: solid(16, [255, 128, 128, 255]), mask: null },
        ]);
        const [r, g] = packed.albedo[0]!;
        expect(g).toBe(100);
        expect(r).toBe(Math.round(200 * Math.pow(0.5, 1 / 2.2)));
        // No normal: flat. A strength of 0 flattens one that bends.
        expect(Array.from(packed.normal[0]!.slice(0, 3))).toEqual([128, 128, 255]);
        expect(Array.from(packed.normal[1]!.slice(0, 3))).toEqual([128, 128, 255]);
        // No mask: no occlusion, the layer's roughness, the albedo's brightness for height (half way without an albedo).
        expect(packed.mask[1]![0]).toBe(255);
        expect(packed.mask[1]![1]).toBe(Math.round(0.4 * 255));
        expect(packed.mask[1]![2]).toBe(128);
    });
});

describe('eight layers of paint', () => {
    it('reads layers 5 to 8 from the second splatmap and pages them in the second image', () => {
        const field = { width: 2, height: 2, data: new Float32Array(4) };
        const data = { sizeX: 100, sizeZ: 100, height: 10, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
        const first = solid(2, [0, 0, 0, 0]), second = solid(2, [0, 255, 0, 0]);
        const source = new FieldSource(field, data, first, null, [0, 10], second);
        expect(source.paint(0, 0, 0, 1)).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
        const page = makePage(source, -50, -50, 100);
        if (page instanceof Promise) throw new Error('a field pages at once');
        const k = (Math.floor(PAGE_SIDE / 2) * PAGE_SIDE + Math.floor(PAGE_SIDE / 2)) * 4;
        expect(Array.from(page.paint.slice(k, k + 4))).toEqual([0, 0, 0, 0]);
        expect(Array.from(page.paint2.slice(k, k + 4))).toEqual([0, 255, 0, 0]);
    });

    it('leaves the second image empty for ground of four layers', () => {
        const field = { width: 2, height: 2, data: new Float32Array(4) };
        const data = { sizeX: 100, sizeZ: 100, height: 10, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
        const page = makePage(new FieldSource(field, data, null, null), -50, -50, 100);
        if (page instanceof Promise) throw new Error('a field pages at once');
        expect(page.paint2.every((v) => v === 0)).toBe(true);
    });
});

describe('a splatmap read by the ground', () => {
    it('is read between its pixels, so a page finer than the paint is a ramp and not a row of squares', () => {
        const field = { width: 2, height: 2, data: new Float32Array(4) };
        const data = { sizeX: 100, sizeZ: 100, height: 10, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
        // Two pixels across: all of layer 1 on the west, all of layer 2 on the east.
        const pixels = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0]);
        const source = new FieldSource(field, data, { width: 2, height: 2, pixels }, null, [0, 10]);
        expect(source.paint(-50, 0, 0, 1).slice(0, 2)).toEqual([1, 0]);
        expect(source.paint(50, 0, 0, 1).slice(0, 2)).toEqual([0, 1]);
        const mid = source.paint(0, 0, 0, 1), quarter = source.paint(-25, 0, 0, 1);
        expect(mid[0]).toBeCloseTo(0.5, 5);
        expect(mid[1]).toBeCloseTo(0.5, 5);
        expect(quarter[0]).toBeCloseTo(0.75, 5);
        expect(quarter[1]).toBeCloseTo(0.25, 5);
        // Every step across is a little more of the second: nowhere two samples the same and then a jump.
        let last = -1;
        for (let x = -50; x <= 50; x += 5) { const w = source.paint(x, 0, 0, 1)[1]!; expect(w).toBeGreaterThanOrEqual(last); expect(w - Math.max(last, 0)).toBeLessThan(0.06); last = w; }
    });
});
