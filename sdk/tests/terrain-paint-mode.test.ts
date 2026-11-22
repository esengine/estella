// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { paintSplat } from '../src/terrain/sculpt';
import { materialPaintWeights, terrainPaintTargets, parseTerrainLayerInfo } from '../src/terrain/paintLayers';
import { erodeHeightfield } from '../src/terrain/heightfield';
import type { TerrainPaintSettings } from '../src/terrain/weightBrush';

const n = 17, center = (8 * n + 8) * 4;
function splat(bytes = [0, 0, 0, 0]) {
    const pixels = new Uint8Array(n * n * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set(bytes, i);
    return { width: n, height: n, pixels };
}
const brush = { x: 0, z: 0, radius: 50, falloff: 0 };
const dab = (map: ReturnType<typeof splat>, settings: TerrainPaintSettings, layer = 0, strength = 1) =>
    paintSplat(map, null, 16, 16, { layer, brush, strength, settings, worldCenter: { x: 40, z: -20 } });
const pixel = (map: ReturnType<typeof splat>, at = center) => [...map.pixels.slice(at, at + 4)];

describe('terrain weight painting', () => {
    it('erases equally, exhausts small peer weights first and conserves exactly 255 bytes', () => {
        const m = splat([240, 10, 5, 189]);
        dab(m, { weighted: 7, target: 0 }, 0, 0.5);
        expect(pixel(m)).toEqual([120, 70, 65, 189]);
        dab(m, { weighted: 7, target: 253 / 255 });
        expect(pixel(m)).toEqual([253, 2, 0, 189]);
        dab(m, { weighted: 7, target: 1 });
        expect(pixel(m)).toEqual([255, 0, 0, 189]);
        dab(m, { weighted: 1, target: 0 });
        expect(pixel(m)).toEqual([255, 0, 0, 189]);
    });
    it('paints independent overlays and composites them without consuming their base', () => {
        const m = splat([64, 191, 0, 0]);
        dab(m, { weighted: 3, target: 0.5 }, 2);
        expect(pixel(m)).toEqual([64, 191, 128, 0]);
        const b = { ...parseTerrainLayerInfo({ name: 'snow', blend: 'alpha' }), info: 'snow.info', slot: 2, painted: true };
        const w = materialPaintWeights(pixel(m).map(x => x / 255), terrainPaintTargets(['rock', 'dirt', 'snow'], [b]));
        expect(w[2]).toBeCloseTo(128 / 255); expect(w[0]! / w[1]!).toBeCloseTo(64 / 191);
        dab(m, { weighted: 3, target: 0 }, 2); expect(pixel(m)).toEqual([64, 191, 0, 0]);
        const removed = terrainPaintTargets(['rock', 'dirt', 'sand'], [b]);
        expect(removed.find(r => r.name === 'sand')!.slot).toBe(3);
        expect(removed.find(r => r.name === 'snow')).toMatchObject({ slot: 2, materialIndex: -1 });
        expect(terrainPaintTargets(['snow', 'rock'], [b])[0]).toMatchObject({ slot: 2, materialIndex: 0 });
    });
    it('flattens in one direction, includes zero and respects selection in world space', () => {
        const m = splat([64, 191, 0, 0]), region = [40, -20, 43, -16] as const;
        dab(m, { tool: 'flatten', weighted: 3, direction: 'lower', target: 0.8 }); expect(m.pixels[center]).toBe(64);
        dab(m, { tool: 'flatten', weighted: 3, region, direction: 'raise', target: 0.8 }); expect(m.pixels[center]).toBe(204);
        expect(m.pixels[center - 4]).toBe(64);
        dab(m, { tool: 'flatten', weighted: 3, region, inverse: true, target: 0 });
        expect(m.pixels[center - 4]).toBe(0); expect(m.pixels[center]).toBe(204);
    });
    it('uses immutable neighbours, an adjustable kernel and an edge-preserving range', () => {
        function impulse(kernel: number, detail?: number) {
            const m = splat(); m.pixels[center] = 255;
            dab(m, { tool: 'smooth', kernel, detail, weighted: 0 });
            expect(m.pixels[center - 4]).toBe(m.pixels[center + 4]);
            return m;
        }
        expect(impulse(1).pixels[center]).toBeGreaterThan(impulse(3).pixels[center]!);
        expect(impulse(2, 0).pixels[center]).toBe(255);
        expect(impulse(2, 1).pixels[center]).toBeLessThan(255);
    });
    it('keeps Perlin samples fixed across dabs and changes them with scale and direction', () => {
        const noise = (noiseScale: number, direction: 'both' | 'raise' | 'lower') => {
            const m = splat([128, 127, 0, 0]); dab(m, { tool: 'noise', weighted: 3, noiseScale, direction }); return m.pixels.filter((_, i) => i % 4 === 0);
        };
        const all = noise(5, 'both');
        expect(all).toEqual(noise(5, 'both')); expect(all).not.toEqual(noise(11, 'both'));
        expect(Math.min(...all)).toBeLessThan(128); expect(Math.max(...all)).toBeGreaterThan(128);
        expect(Math.min(...noise(5, 'raise'))).toBe(128); expect(Math.max(...noise(5, 'lower'))).toBe(128);
    });
    it('leaves fully resistant ground intact under hydraulic erosion', () => {
        const field = { width: n, height: n, data: Float32Array.from({ length: n*n }, (_, i) => (i % n) / (n - 1)) };
        const args = { seed: 3, amount: 1, height: 16, sizeX: 16, sizeZ: 16 };
        expect(erodeHeightfield(field, args).field.data).not.toEqual(field.data);
        expect(erodeHeightfield(field, { ...args, hardness: new Float32Array(n*n).fill(1) }).field.data).toEqual(field.data);
    });
});
