// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Brushes on an area's ground: what each one does to a field and to the splatmaps, and that a stroke can be taken back.
 */
import { describe, expect, it, vi } from 'vitest';
import { Material } from '../src/render/material';
import { GroundEdit } from '../src/terrain/groundEdit';
import { Terrains } from '../src/terrain/terrainPlugin';
import { FieldSource, ModifiedSource, type Splat } from '../src/terrain/source';
import type { Heightfield } from '../src/terrain/heightfield';
import { type BrushMask, SculptMode, brushDistance, brushWeight, encodeHeightmap, paintSplat, sculptField } from '../src/terrain/sculpt';

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

describe('brush profiles', () => {
    it('keeps the same core and rim for every curve, including hard and fully soft edges', () => {
        for (const curve of ['smooth', 'linear', 'spherical', 'tip'] as const) {
            expect(brushWeight(9.999, 10, 0, curve)).toBe(1);
            expect(brushWeight(5, 10, 0.5, curve)).toBe(1);
            expect(brushWeight(10, 10, 0.5, curve)).toBe(0);
            expect(brushWeight(0, 10, 1, curve)).toBe(1);
            expect(brushWeight(0.1, 10, 1, curve)).toBeLessThan(1);
        }
        const w = (curve: 'smooth' | 'linear' | 'spherical' | 'tip') => brushWeight(9, 10, 0.4, curve);
        expect(w('smooth')).toBeCloseTo(0.15625);
        expect(w('linear')).toBeCloseTo(0.25);
        expect(w('spherical')).toBeCloseTo(Math.sqrt(7) / 4);
        expect(w('tip')).toBeCloseTo(1 - Math.sqrt(15) / 4);
    });

    it('gives sculpt and paint the same footprint and falloff on a rectangular world area', () => {
        for (const shape of ['circle', 'diamond', 'square'] as const) {
            const brush = { x: 0, z: 0, radius: 10, falloff: 0.8, shape, curve: 'linear' as const };
            const f = flat(33, 0);
            const splat = { width: 33, height: 33, pixels: new Uint8Array(33 * 33 * 4) };
            for (let i = 0; i < 33 * 33; i++) splat.pixels[i * 4] = 255;
            sculptField(f, 32, 64, { mode: SculptMode.Raise, brush, amount: 1 });
            paintSplat(splat, null, 32, 64, { layer: 1, brush, strength: 1 });
            expect(brushDistance(3, -4, shape)).toBe({ circle: 5, square: 4, diamond: 7 }[shape]);
            for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) {
                const weight = brushWeight(brushDistance(i - 16, (j - 16) * 2, shape), 10, 0.8, 'linear');
                expect(at(f, i, j)).toBeCloseTo(weight);
                expect(splat.pixels[(j * 33 + i) * 4 + 1]).toBe(Math.round(weight * 255));
            }
        }
    });

    it('samples every stamp channel as linear data with the same orientation for heights and paint', () => {
        // Distinct non-opaque data at each corner also catches a vertical flip or premultiplied RGB.
        const image = { width: 2, height: 2, pixels: Uint8Array.of(0, 200, 30, 150, 64, 100, 90, 25, 128, 50, 0, 200, 255, 0, 180, 85) };
        for (const channel of [0, 1, 2, 3] as const) {
            const mask: BrushMask = { image, channel, axisU: { x: 0.25, z: 0 }, axisV: { x: 0, z: 0.25 }, u: 0.5, v: 0.5, repeat: false };
            const brush = { x: 0, z: 0, radius: 2, falloff: 0, mask };
            const f = flat(9, 0), splat = { width: 9, height: 9, pixels: new Uint8Array(9 * 9 * 4) };
            for (let i = 0; i < 81; i++) splat.pixels[i * 4] = 255;
            sculptField(f, 8, 8, { mode: SculptMode.Raise, brush, amount: 1 });
            paintSplat(splat, null, 8, 8, { brush, layer: 1, strength: 1 });
            for (const [i, j, p] of [[3, 3, 0], [5, 3, 4], [3, 5, 8], [5, 5, 12]] as const) {
                const value = image.pixels[p + channel]!;
                expect(at(f, i, j)).toBeCloseTo(value / 255);
                expect(splat.pixels[(j * 9 + i) * 4 + 1]).toBe(value);
            }
            expect(at(f, 4, 4)).toBeCloseTo([0, 4, 8, 12].reduce((v, p) => v + image.pixels[p + channel]!, 0) / (4 * 255));
            expect(at(f, 1, 4)).toBe(0);
        }
    });

    it('wraps bilinearly across the pattern seam and clips component interiors to their rectangle', () => {
        const image = { width: 2, height: 1, pixels: Uint8Array.of(0, 0, 0, 255, 255, 0, 0, 255) };
        const mask: BrushMask = { image, channel: 0, axisU: { x: 0.25, z: 0 }, axisV: { x: 0, z: 0.25 }, u: 0, v: 0, repeat: true };
        const f = flat(17, 0);
        sculptField(f, 16, 16, { mode: SculptMode.Raise, amount: 1, brush: { x: 0, z: 0, radius: 7, falloff: 0, mask } });
        expect(Array.from(f.data.slice(8 * 17 + 4, 8 * 17 + 12))).toEqual([0.5, 0, 0.5, 1, 0.5, 0, 0.5, 1]);
        f.data.fill(0);
        const dirty = sculptField(f, 16, 16, { mode: SculptMode.Raise, amount: 1,
            brush: { x: 0, z: 0, radius: 4, falloff: 0, component: { halfX: 4, halfZ: 2 } } });
        expect(dirty).toEqual({ i0: 4, i1: 12, j0: 6, j1: 10 });
        for (let j = 0; j < 17; j++) for (let i = 0; i < 17; i++)
            expect(at(f, i, j)).toBe(Math.abs(i - 8) <= 4 && Math.abs(j - 8) <= 2 ? 1 : 0);
    });

    it('builds clay along a slope, fills a hollow before raising a crest, and carves in reverse', () => {
        const brush = { x: 0, z: 0, radius: 5, falloff: 0.4 };
        for (const sign of [-1, 1]) {
            const f = flat(17);
            for (let j = 0; j < 17; j++) for (let i = 0; i < 17; i++) f.data[j * 17 + i] = 0.35 + 0.02 * i;
            const centre = 8 * 17 + 8;
            f.data[centre - 1] = 0.5 - 0.25 * sign;
            f.data[centre + 1] = 0.5 + 0.25 * sign;
            const before = f.data.slice();
            for (let i = 0; i < 2; i++) sculptField(f, 16, 16, { mode: SculptMode.Clay, brush, amount: 0.04 * sign });
            expect(f.data[centre - 1]).toBeCloseTo(before[centre - 1]! + 0.08 * sign);
            expect(f.data[centre + 1]).toBe(before[centre + 1]);
            const slopeChange = (at(f, 8, 6) - before[6 * 17 + 8]!) * sign;
            expect(slopeChange).toBeGreaterThan(0.04);
            expect(slopeChange).toBeLessThanOrEqual(0.081);
            expect(at(f, 0, 0)).toBe(before[0]);
        }
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

it('clears the previous terrain when the preview moves to a custom material or leaves the view', () => {
    const terrains = new Terrains();
    terrains.built_.set(1 as never, { instance: 11 } as never);
    terrains.built_.set(2 as never, { instance: 12 } as never);
    const brush = { x: 1, z: 2, radius: 10, falloff: 0.5, shape: 'square', curve: 'tip' } as const;
    const declaring = vi.spyOn(Material, 'materialsDeclaring').mockImplementation(name => name === 'u_sculptBrush' ? [11] : []);
    const uniform = vi.spyOn(Material, 'setUniform').mockImplementation(() => {});
    try {
        expect(terrains.previewBrush(1 as never, brush)).toBe(true);
        expect(uniform).toHaveBeenCalledWith(11, 'u_sculptBrush', { x: 1, y: 2, z: 10, w: 0.5 });
        expect(uniform).toHaveBeenCalledWith(11, 'u_sculptProfile', { x: 1, y: 3 });
        expect(terrains.previewBrush(1 as never, { ...brush, component: { halfX: 4, halfZ: 2 } })).toBe(false);
        expect(uniform).toHaveBeenLastCalledWith(11, 'u_sculptBrush', { x: 0, y: 0, z: 0, w: 0 });
        expect(terrains.previewBrush(2 as never, brush)).toBe(false);
        expect(uniform).toHaveBeenLastCalledWith(11, 'u_sculptBrush', { x: 0, y: 0, z: 0, w: 0 });
        expect(terrains.previewBrush(1 as never, brush)).toBe(true);
        expect(terrains.previewBrush(null, null)).toBe(false);
        expect(uniform).toHaveBeenLastCalledWith(11, 'u_sculptBrush', { x: 0, y: 0, z: 0, w: 0 });
        declaring.mockReturnValue([11]);
        expect(terrains.previewBrush(1 as never, { ...brush, component: { halfX: 4, halfZ: 2 } })).toBe(true);
        expect(uniform).toHaveBeenCalledWith(11, 'u_sculptBrush', { x: 1, y: 2, z: 10, w: 0 });
    } finally {
        declaring.mockRestore();
        uniform.mockRestore();
    }
});

describe('Terrains.load', () => {
    it('counts what is still loading and the ground and paint held in memory', () => {
        const terrains = new Terrains();
        const field = flat(65);
        const source = new FieldSource(field, data, { width: 8, height: 8, pixels: new Uint8Array(256) }, null);
        const wrapped = new ModifiedSource(source, () => [], { x: 0, y: 0, z: 0 }, 1);
        terrains.built_.set(1 as never, { loading: false, source: wrapped } as never);
        terrains.built_.set(2 as never, { loading: true, source: null } as never);
        expect(terrains.load()).toEqual({ loading: 1, cpuBytes: field.data.byteLength + 256, tiles: 0, unsaved: 0 });
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

    it.each([SculptMode.Raise, SculptMode.Clay])('undoes and redoes a full stroke in sculpt mode %i', mode => {
        const { edit, field } = make();
        edit.begin();
        edit.sculpt(mode, 0, 0, 10, 0.5, 5);
        edit.sculpt(mode, 12, 0, 10, 0.5, 5);
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
