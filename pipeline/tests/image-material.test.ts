// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A picture that repeats, and a picture as a surface: that what leaves one edge comes in at the other, that the join
 * shows no more than any other row of the picture, and that the maps say what the layers drew.
 */
import { describe, expect, it } from 'vitest';
import { renderImage } from '../src/image/imageRaster';
import { applyImageEdits, validateImageSource, type ImageLayer, type ImageSource } from '../src/image/imageSource';
import { laidTwice, litPreview, normalFromHeight, renderMaterialMaps, seamOf } from '../src/image/imageMaterial';

const draw = (source: Partial<ImageSource> & { layers: ImageLayer[] }) => renderImage(validateImageSource({ size: 64, ...source }));
const at = (img: { width: number; rgba: Uint8Array }, x: number, y: number): number[] => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const noise: ImageLayer = { shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'noise', scale: 12, octaves: 3, seed: 5, stops: [[0, '#101010'], [1, '#f0f0f0']] } } as never;

describe('a picture that repeats', () => {
    it('brings what leaves one edge in at the opposite one', () => {
        const disc: ImageLayer = { shape: 'ellipse', at: [0, 32], radii: [10, 10], fill: '#ff0000' } as never;
        const plain = draw({ layers: [disc] });
        const tiled = draw({ tile: true, layers: [disc] });
        // Centred on the left edge: half of it is in the picture either way, and the other half only when it repeats.
        expect(at(plain, 3, 32)[3]).toBe(255);
        expect(at(plain, 60, 32)[3]).toBe(0);
        expect(at(tiled, 3, 32)[3]).toBe(255);
        expect(at(tiled, 60, 32)[3]).toBe(255);
        expect(at(tiled, 32, 32)[3]).toBe(0);
    });

    it('does so at a corner, in all four', () => {
        const tiled = draw({ tile: true, layers: [{ shape: 'ellipse', at: [0, 0], radii: [8, 8], fill: '#00ff00' } as never] });
        for (const [x, y] of [[2, 2], [61, 2], [2, 61], [61, 61]]) expect(at(tiled, x!, y!)[3]).toBe(255);
    });

    it('brings a line round, and a brush stroke', () => {
        const line = draw({ tile: true, layers: [{ shape: 'line', points: [[50, 10], [80, 10]], stroke: { color: '#ffffff', width: 4 } } as never] });
        expect(at(line, 8, 10)[3]).toBe(255);
        expect(at(line, 30, 10)[3]).toBe(0);
        const stroke = draw({ tile: true, layers: [{ shape: 'paint', strokes: [{ points: [[50, 40], [80, 40]], color: '#ffffff', size: 8 }] } as never] });
        expect(at(stroke, 8, 40)[3]).toBeGreaterThan(100);
        const once = draw({ layers: [{ shape: 'paint', strokes: [{ points: [[50, 40], [80, 40]], color: '#ffffff', size: 8 }] } as never] });
        expect(at(once, 8, 40)[3]).toBe(0);
    });

    it('carries a shadow and a blur round with it', () => {
        const shadowed: ImageLayer = { shape: 'rect', at: [44, 24], size: [16, 16], fill: '#ffffff', effects: [{ type: 'shadow', x: 10, y: 0, blur: 0, color: '#000000' }] } as never;
        const tiled = draw({ tile: true, layers: [shadowed] });
        // The shadow runs off the right edge and lands on the left.
        expect(at(tiled, 3, 32)[3]).toBeGreaterThan(200);
        expect(at(draw({ layers: [shadowed] }), 3, 32)[3]).toBe(0);
    });

    it('makes a noise that meets itself, where one that does not repeat shows its join', () => {
        expect(seamOf(draw({ layers: [noise] }))).toBeGreaterThan(2.5);
        expect(seamOf(draw({ tile: true, layers: [noise] }))).toBeLessThan(1.6);
    });

    it('is the same picture drawn twice, and leaves the next picture alone', () => {
        const a = draw({ tile: true, layers: [noise] });
        const plain = draw({ layers: [noise] });
        const b = draw({ tile: true, layers: [noise] });
        expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
        // A picture drawn after a repeating one does not repeat: the setting is the draw's, not the module's.
        expect(Buffer.from(plain.rgba).equals(Buffer.from(draw({ layers: [noise] }).rgba))).toBe(true);
        expect(Buffer.from(plain.rgba).equals(Buffer.from(a.rgba))).toBe(false);
    });

    it('measures a join against the picture it is in', () => {
        const flat = draw({ background: '#808080', layers: [] });
        expect(seamOf(flat)).toBe(1);
        const halves = draw({ background: '#000000', layers: [{ shape: 'rect', at: [32, 0], size: [32, 64], fill: '#ffffff' } as never] });
        expect(seamOf(halves)).toBeGreaterThan(3);
        expect(laidTwice(flat).width).toBe(128);
    });
});

describe('a picture as a surface', () => {
    it('turns a height into a normal map: flat is straight out, a slope leans away from the rise', () => {
        const [w, h] = [16, 16];
        const flat = normalFromHeight(new Float32Array(w * h).fill(0.5), w, h, 4, false);
        expect(at(flat, 8, 8)).toEqual([128, 128, 255, 255]);
        // Rising to the right: the surface faces left, so red is below the middle.
        const ramp = new Float32Array(w * h).map((_, i) => (i % w) / (w - 1));
        const right = normalFromHeight(ramp, w, h, 8, false);
        expect(at(right, 8, 8)[0]).toBeLessThan(110);
        expect(at(right, 8, 8)[1]).toBe(128);
        // Rising toward the top of the picture: the surface faces down it, so green is below the middle.
        const up = normalFromHeight(new Float32Array(w * h).map((_, i) => 1 - Math.floor(i / w) / (h - 1)), w, h, 8, false);
        expect(at(up, 8, 8)[1]).toBeLessThan(110);
        expect(at(up, 8, 8)[0]).toBe(128);
    });

    it('reads a deeper relief as a steeper normal, and none as flat', () => {
        const [w, h] = [16, 16];
        const ramp = new Float32Array(w * h).map((_, i) => (i % w) / (w - 1));
        const lean = (relief: number): number => 128 - at(normalFromHeight(ramp, w, h, relief, false), 8, 8)[0]!;
        expect(lean(16)).toBeGreaterThan(lean(4));
        expect(lean(0)).toBe(0);
    });

    it('goes round the edge of a picture that repeats, and stops at it otherwise', () => {
        const [w, h] = [16, 16];
        // High on the left edge only: across the join the right-hand column sees the rise when the picture repeats.
        const edge = new Float32Array(w * h).map((_, i) => (i % w === 0 ? 1 : 0));
        expect(at(normalFromHeight(edge, w, h, 8, true), 15, 8)[0]).toBeLessThan(110);
        expect(at(normalFromHeight(edge, w, h, 8, false), 15, 8)[0]).toBe(128);
    });

    it('takes the relief from the colour when none is drawn, and from the layers when one is', () => {
        const stripe: ImageLayer = { shape: 'rect', at: [24, 0], size: [16, 64], fill: '#ffffff' } as never;
        const fromColour = renderMaterialMaps(validateImageSource({ size: 64, background: '#000000', material: {}, layers: [stripe] }), draw({ background: '#000000', layers: [stripe] }));
        expect(at(fromColour.normal, 24, 32)[0]).toBeLessThan(120);
        expect(at(fromColour.normal, 8, 32)).toEqual([128, 128, 255, 255]);
        // A painted stripe that is not a ridge: the relief is drawn flat, and the normal map is flat with it.
        const source = validateImageSource({ size: 64, background: '#000000', material: { height: [{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#808080' }] }, layers: [stripe] });
        const drawn = renderMaterialMaps(source, renderImage(source));
        expect(at(drawn.normal, 24, 32)).toEqual([128, 128, 255, 255]);
        expect(drawn.notes.join(' ')).toMatch(/relief is flat/);
    });

    it('holds roughness in green and metal in blue, drawn or one value', () => {
        const half: ImageLayer[] = [{ shape: 'rect', at: [0, 0], size: [32, 64], fill: '#ffffff' } as never];
        const source = validateImageSource({ size: 64, background: '#444444', material: { roughness: half, metal: 0.25 }, layers: [] });
        const maps = renderMaterialMaps(source, renderImage(source));
        expect(at(maps.surface!, 8, 8)).toEqual([255, 255, 64, 255]);
        expect(at(maps.surface!, 56, 8)).toEqual([255, 0, 64, 255]);
        const plain = validateImageSource({ size: 64, background: '#444444', material: { roughness: 0.3 }, layers: [] });
        const constant = renderMaterialMaps(plain, renderImage(plain));
        expect(constant.surface).toBeNull();
        expect(constant.roughness).toBe(0.3);
        expect(constant.metal).toBe(0);
    });

    it('draws a preview that the relief changes', () => {
        const stripe: ImageLayer = { shape: 'rect', at: [24, 0], size: [16, 64], fill: '#b0b0b0' } as never;
        const source = validateImageSource({ size: 64, background: '#808080', material: { relief: 12 }, layers: [stripe] });
        const colour = renderImage(source);
        const lit = litPreview(colour, renderMaterialMaps(source, colour));
        // The stripe's left edge faces the light from the upper left, and its right edge faces away.
        expect(at(lit, 24, 32)[0]).toBeGreaterThan(at(lit, 39, 32)[0]! + 20);
    });

    it('keeps one set of ids across the picture and its maps, and says what is wrong', () => {
        const rect = { shape: 'rect', at: [0, 0], size: [8, 8], fill: '#ffffff' };
        expect(() => validateImageSource({ size: 64, material: { height: [{ ...rect, id: 'a' }] }, layers: [{ ...rect, id: 'a' }] })).toThrow(/material\.height layer 0 "a"/);
        expect(() => validateImageSource({ size: 64, material: { depth: 2 }, layers: [] })).toThrow(/material has unknown "depth"; it takes relief, height, roughness, metal/);
        expect(() => validateImageSource({ size: 64, material: { relief: 100 }, layers: [] })).toThrow(/material\.relief must be 0\.\.64/);
        expect(() => validateImageSource({ size: 64, material: { roughness: 2 }, layers: [] })).toThrow(/material\.roughness must be 0\.\.1, or layers/);
        expect(() => validateImageSource({ size: 64, material: { height: [] }, layers: [] })).toThrow(/material\.height must be layers, one or more/);
        expect(() => validateImageSource({ size: 64, tile: 'yes', layers: [] })).toThrow(/tile must be true or false/);
    });

    it('is set, replaced and taken off by an edit', () => {
        const source = validateImageSource({ size: 64, layers: [] });
        const made = applyImageEdits(source, [{ op: 'settings', fields: { tile: true, material: { relief: 6, roughness: 0.4 } } }]);
        expect(made.tile).toBe(true);
        expect(made.material).toEqual({ relief: 6, roughness: 0.4 });
        const off = applyImageEdits(made, [{ op: 'settings', fields: { tile: null, material: null } }]);
        expect(off.tile).toBeUndefined();
        expect(off.material).toBeUndefined();
    });
});
