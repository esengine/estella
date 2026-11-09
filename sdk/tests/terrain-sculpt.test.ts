// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Brushes on an area's ground: what each one does to a field and to the splatmaps, and that a stroke can be taken back.
 */
import { describe, expect, it, vi } from 'vitest';
import { GroundEdit } from '../src/terrain/groundEdit';
import { Terrains } from '../src/terrain/terrainPlugin';
import { FieldSource, ModifiedSource, type Splat } from '../src/terrain/source';
import type { Heightfield } from '../src/terrain/heightfield';
import { SculptMode, brushWeight, encodeHeightmap, paintSplat, sculptField } from '../src/terrain/sculpt';

const flat = (n: number, v = 0.5): Heightfield => ({ width: n, height: n, data: new Float32Array(n * n).fill(v) });
const at = (f: Heightfield, i: number, j: number): number => f.data[j * f.width + i]!;
const data = { sizeX: 100, sizeZ: 100, height: 50, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };

describe('brushWeight', () => {
    it('is one over the core and nothing at the edge, easing between', () => {
        expect(brushWeight(0, 10, 0.5)).toBe(1);
        expect(brushWeight(5, 10, 0.5)).toBe(1);
        expect(brushWeight(10, 10, 0.5)).toBe(0);
        const mid = brushWeight(7.5, 10, 0.5);
        expect(mid).toBeGreaterThan(0.4);
        expect(mid).toBeLessThan(0.6);
        expect(brushWeight(9.99, 10, 0)).toBe(1);
    });
});

describe('sculptField', () => {
    it('raises the ground under the brush and only there', () => {
        const f = flat(101);
        const hit = sculptField(f, 100, 100, { mode: SculptMode.Raise, brush: { x: 0, z: 0, radius: 10, falloff: 0.5 }, amount: 0.1 });
        expect(hit).not.toBeNull();
        expect(at(f, 50, 50)).toBeCloseTo(0.6, 5);
        expect(at(f, 60, 50)).toBe(0.5);
        expect(at(f, 0, 0)).toBe(0.5);
        expect(hit!.i0).toBeGreaterThanOrEqual(40);
        expect(hit!.i1).toBeLessThanOrEqual(60);
    });

    it('lowers it, and never past the range of the field', () => {
        const f = flat(101, 0.05);
        sculptField(f, 100, 100, { mode: SculptMode.Lower, brush: { x: 0, z: 0, radius: 10, falloff: 0 }, amount: 0.5 });
        expect(at(f, 50, 50)).toBe(0);
        const g = flat(101, 0.95);
        sculptField(g, 100, 100, { mode: SculptMode.Raise, brush: { x: 0, z: 0, radius: 10, falloff: 0 }, amount: 0.5 });
        expect(at(g, 50, 50)).toBe(1);
    });

    it('flattens toward a height', () => {
        const f = flat(101, 0.2);
        f.data[50 * 101 + 50] = 0.9;
        sculptField(f, 100, 100, { mode: SculptMode.Flatten, brush: { x: 0, z: 0, radius: 10, falloff: 0 }, amount: 1, target: 0.4 });
        expect(at(f, 50, 50)).toBeCloseTo(0.4, 5);
        expect(at(f, 52, 50)).toBeCloseTo(0.4, 5);
    });

    it('smooths a spike toward its neighbours without reading what it has just changed', () => {
        const f = flat(101, 0.2);
        f.data[50 * 101 + 50] = 0.9;
        sculptField(f, 100, 100, { mode: SculptMode.Smooth, brush: { x: 0, z: 0, radius: 10, falloff: 0 }, amount: 1 });
        expect(at(f, 50, 50)).toBeCloseTo((0.9 + 8 * 0.2) / 9, 5);
        // A neighbour saw the spike as it was, not as it had just become.
        expect(at(f, 51, 50)).toBeCloseTo((0.9 + 8 * 0.2) / 9, 5);
    });

    it('does nothing for a brush off the area', () => {
        const f = flat(33);
        expect(sculptField(f, 100, 100, { mode: SculptMode.Raise, brush: { x: 500, z: 0, radius: 10, falloff: 0 }, amount: 1 })).toBeNull();
        expect(Array.from(f.data).every((v) => v === 0.5)).toBe(true);
    });
});

describe('paintSplat', () => {
    const splat = (n: number, r: number, g = 0): Splat => {
        const pixels = new Uint8Array(n * n * 4);
        for (let i = 0; i < n * n; i++) { pixels[i * 4] = r; pixels[i * 4 + 1] = g; }
        return { width: n, height: n, pixels };
    };
    const weights = (a: Splat, b: Splat | null, i: number, j: number): number[] => {
        const o = (j * a.width + i) * 4;
        return [0, 1, 2, 3].map((c) => a.pixels[o + c]! / 255).concat([0, 1, 2, 3].map((c) => b ? b.pixels[o + c]! / 255 : 0));
    };

    it('lays a layer and takes the others down in proportion, so the weights still add to one', () => {
        const a = splat(33, 128, 127);
        paintSplat(a, null, 100, 100, { layer: 2, brush: { x: 0, z: 0, radius: 20, falloff: 0 }, strength: 0.5 });
        const w = weights(a, null, 16, 16);
        expect(w[2]).toBeGreaterThan(0.45);
        expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 1);
        expect(w[0]! / w[1]!).toBeCloseTo(128 / 127, 1);
    });

    it('reaches layers five to eight through the second map and refuses them without one', () => {
        const a = splat(33, 255), b = splat(33, 0);
        expect(paintSplat(a, null, 100, 100, { layer: 5, brush: { x: 0, z: 0, radius: 20, falloff: 0 }, strength: 1 })).toBeNull();
        paintSplat(a, b, 100, 100, { layer: 5, brush: { x: 0, z: 0, radius: 20, falloff: 0 }, strength: 1 });
        const w = weights(a, b, 16, 16);
        expect(w[5]).toBe(1);
        expect(w[0]).toBe(0);
    });

    it('erases a layer back to the others, or to the first one when it was alone', () => {
        const a = splat(33, 0, 255);
        paintSplat(a, null, 100, 100, { layer: 1, brush: { x: 0, z: 0, radius: 20, falloff: 0 }, strength: 1, erase: true });
        const w = weights(a, null, 16, 16);
        expect(w[1]).toBe(0);
        expect(w[0]).toBe(1);
    });
});

describe('Terrains.load', () => {
    it('counts what is still loading and the ground and paint held in memory', () => {
        const terrains = new Terrains();
        const field = flat(65);
        const source = new FieldSource(field, data, { width: 8, height: 8, pixels: new Uint8Array(256) }, null);
        const wrapped = new ModifiedSource(source, () => [], { x: 0, y: 0, z: 0 }, 1);
        terrains.built_.set(1 as never, { loading: false, source: wrapped } as never);
        terrains.built_.set(2 as never, { loading: true, source: null } as never);
        expect(terrains.load()).toEqual({ loading: 1, cpuBytes: field.data.byteLength + 256, tiles: 0 });
    });
});

describe('GroundEdit', () => {
    const make = (): { edit: GroundEdit; field: Heightfield; remade: number[][] } => {
        const field = flat(65);
        const source = new FieldSource(field, data, null, null);
        const modified = new ModifiedSource(source, () => [], { x: 0, y: 0, z: 0 }, 1);
        const remade: number[][] = [];
        return { edit: new GroundEdit({ remake: (b) => remade.push([...b]) }, source, modified, 100, 100), field, remade };
    };

    it('changes the ground a source answers and has the terrain make again only what the stroke reached', () => {
        const { edit, remade } = make();
        edit.sculpt(SculptMode.Raise, 0, 0, 10, 0.5, 5);
        expect(edit.heightAt(0, 0)).toBeCloseTo(25 + 5, 3);
        expect(edit.heightAt(40, 40)).toBeCloseTo(25, 3);
        expect(remade).toHaveLength(1);
        const [x0, z0, x1, z1] = remade[0]!;
        expect(x0).toBeLessThanOrEqual(-10);
        expect(x1).toBeLessThan(20);
        expect(z0).toBeLessThanOrEqual(-10);
        expect(z1).toBeLessThan(20);
    });

    it('takes a stroke back and puts it again', () => {
        const { edit, field } = make();
        edit.begin();
        edit.sculpt(SculptMode.Raise, 0, 0, 10, 0.5, 5);
        edit.sculpt(SculptMode.Raise, 12, 0, 10, 0.5, 5);
        const patch = edit.end();
        expect(patch).not.toBeNull();
        const peak = Float32Array.from(field.data);
        edit.apply(patch!, 'before');
        expect(Array.from(field.data).every((v) => v === 0.5)).toBe(true);
        edit.apply(patch!, 'after');
        expect(Array.from(field.data)).toEqual(Array.from(peak));
    });

    it('makes a splatmap on the first paint and gives it up on undo', () => {
        const { edit } = make();
        expect(edit.splatmapPixels().a).toBeNull();
        edit.begin();
        edit.paint(3, 0, 0, 10, 0.5, 1);
        const patch = edit.end();
        const a = edit.splatmapPixels().a!;
        expect(a).not.toBeNull();
        const mid = ((a.height >> 1) * a.width + (a.width >> 1)) * 4;
        expect(a.pixels[mid + 3]).toBe(255);
        edit.apply(patch!, 'before');
        expect(a.pixels[mid + 3]).toBe(0);
    });

    it('copies nothing of the ground to begin a stroke', () => {
        const { edit, field } = make();
        const slice = vi.spyOn(field.data, 'slice');
        edit.begin();
        edit.sculpt(SculptMode.Raise, 0, 0, 5, 0.5, 5);
        edit.end();
        expect(slice).not.toHaveBeenCalled();
    });

    it('keeps what a diagonal stroke touched, not the square round it', () => {
        const field = flat(513);
        const source = new FieldSource(field, data, null, null);
        const modified = new ModifiedSource(source, () => [], { x: 0, y: 0, z: 0 }, 1);
        const edit = new GroundEdit({ remake: () => {} }, source, modified, 100, 100);
        edit.begin();
        for (let t = -45; t <= 45; t += 2) edit.sculpt(SculptMode.Raise, t, t, 2, 0.5, 5);
        const patch = edit.end()!;
        const { rect, tiles } = patch.heights!;
        const kept = tiles.reduce((n, tile) => n + tile.before.length, 0);
        expect(kept).toBeLessThan((rect.i1 - rect.i0 + 1) * (rect.j1 - rect.j0 + 1) / 3);
        const peak = Float32Array.from(field.data);
        edit.apply(patch, 'before');
        expect(field.data.every((v) => v === 0.5)).toBe(true);
        edit.apply(patch, 'after');
        expect(field.data).toEqual(peak);
    });

    it('takes a first paint back to the ground it was laid over', () => {
        const { edit } = make();
        const ground = (() => {
            const { edit: untouched } = make();
            untouched.paint(0, 0, 0, 0.001, 0, 0);
            return Uint8Array.from(untouched.splatmapPixels().a!.pixels);
        })();
        edit.begin();
        edit.paint(2, 0, 0, 10, 0.5, 1);
        const patch = edit.end()!;
        edit.apply(patch, 'before');
        expect(edit.splatmapPixels().a!.pixels).toEqual(ground);
    });

    it('encodes heights as sixteen bits across red and green', () => {
        const f = flat(2, 0);
        f.data[1] = 1; f.data[2] = 0.5;
        const px = encodeHeightmap(f);
        expect(Array.from(px.slice(4, 8))).toEqual([255, 255, 0, 255]);
        const v = (px[8]! << 8) | px[9]!;
        expect(v).toBe(Math.round(0.5 * 65535));
    });
});
