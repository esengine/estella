// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { GlyphAtlas, distanceShadowRaster, shadowRaster, type AtlasPageStore, type GlyphRasterizer, type RasterGlyph } from '../src/ui/text/glyph-atlas';
import { SHADOW_COVERAGE_BIAS, drawTextWith, shadowTaps, tapAlpha } from '../src/ui/text/text-renderer';
import { TEXT_VERTEX_FLOATS } from '../src/ui/text/submit';

function distanceDisk(size: number, radius: number, spread: number): RasterGlyph {
    const pixels = new Uint8Array(size * size * 4);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const inside = radius - Math.hypot(x - c, y - c);
            const o = (y * size + x) * 4;
            pixels[o] = spread * 2; pixels[o + 1] = 255; pixels[o + 2] = 255;
            pixels[o + 3] = Math.max(0, Math.min(255, Math.round(128 + inside / spread * 128)));
        }
    }
    return { pixels, width: size, height: size, advance: size, bearingX: 0, bearingY: size };
}

function ring(size: number): RasterGlyph {
    const pixels = new Uint8Array(size * size * 4);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x - c, y - c);
            const ink = Math.max(0, Math.min(1, 1.5 - Math.abs(d - size * 0.32)));
            pixels[(y * size + x) * 4 + 3] = Math.round(ink * 255);
        }
    }
    return { pixels, width: size, height: size, advance: size, bearingX: 0, bearingY: size };
}

function stacked(raster: RasterGlyph, taps: ReadonlyArray<readonly [number, number]>, strength: number, margin: number, x: number, y: number): number {
    const at = (sx: number, sy: number): number => (sx < 0 || sy < 0 || sx >= raster.width || sy >= raster.height) ? 0 : raster.pixels[(sy * raster.width + sx) * 4 + 3] / 255;
    const a = tapAlpha(strength, taps.length);
    let clear = 1;
    for (const [ox, oy] of taps) {
        const fx = x - margin - ox, fy = y - margin + oy;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const c = at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty;
        clear *= 1 - a * c;
    }
    return 1 - clear;
}

function coverageAtlas(tile: RasterGlyph, onPage?: (paint: (pixels: Uint8Array) => void) => void): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 16, spread: 0,
        rasterize: (cp: number): RasterGlyph | null => cp === 32
            ? { pixels: new Uint8Array(0), width: 0, height: 0, advance: 6, bearingX: 0, bearingY: 0 }
            : tile,
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: (_size, paint) => { onPage?.(paint); return next++; }, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1, sdf: false });
}

describe('a blurred text shadow drawn once from a baked cell', () => {
    it('composites like the stacked copies it replaces', () => {
        const glyph = ring(18);
        for (const [blur, fontSize, strength] of [[6, 12, 0.9], [2, 16, 0.5], [9, 24, 0.75]] as const) {
            const taps = shadowTaps(blur, fontSize);
            const cell = shadowRaster(glyph, taps, strength);
            const margin = (cell.width - glyph.width) / 2;
            expect(cell.height - glyph.height).toBe(margin * 2);
            let worst = 0;
            for (let y = 0; y < cell.height; y++) {
                for (let x = 0; x < cell.width; x++) {
                    const baked = strength * cell.pixels[(y * cell.width + x) * 4 + 3] / 255;
                    worst = Math.max(worst, Math.abs(baked - stacked(glyph, taps, strength, margin, x, y)));
                }
            }
            expect(worst).toBeLessThan(4 / 255);
        }
    });

    it('reaches the full strength inside the glyph and nothing past the farthest copy', () => {
        const solid: RasterGlyph = { pixels: new Uint8Array(20 * 20 * 4).fill(255), width: 20, height: 20, advance: 20, bearingX: 0, bearingY: 20 };
        const taps = shadowTaps(6, 12);
        const cell = shadowRaster(solid, taps, 0.9);
        const margin = (cell.width - 20) / 2;
        const alpha = (x: number, y: number): number => cell.pixels[(y * cell.width + x) * 4 + 3];
        expect(alpha(margin + 10, margin + 10)).toBe(255);
        expect(alpha(0, 0)).toBe(0);
        expect(cell.bearingX).toBe(solid.bearingX - margin);
        expect(cell.bearingY).toBe(solid.bearingY + margin);
    });

    it('draws the whole label\'s shadow as one batch behind the fill on a coverage atlas', () => {
        const atlas = coverageAtlas(ring(12));
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'A B', fontFamily: 'Arial', fontSizePx: 12, color: [1, 1, 1, 0.8], opacity: 0.5,
            shadow: { color: [0, 0.02, 0.04, 0.9], dx: 0, dy: 1, blur: 6 },
        });
        expect(sink).toHaveBeenCalledTimes(2);
        expect(sink.mock.calls[0][3]).toBe(sink.mock.calls[1][3]);
        const shadow = sink.mock.calls[0][0] as Float32Array;
        const fill = sink.mock.calls[1][0] as Float32Array;
        expect(shadow.length).toBe(fill.length);
        for (let i = 8; i < shadow.length; i += TEXT_VERTEX_FLOATS) expect(shadow[i]).toBe(0);
        for (let i = 4; i < shadow.length; i += TEXT_VERTEX_FLOATS) {
            expect(Array.from(shadow.subarray(i, i + 3)).map((v) => +v.toFixed(5))).toEqual([0, 0.02, 0.04]);
            expect(shadow[i + 3]).toBeCloseTo(0.9 * 0.8 * 0.5, 5);
        }
        const width = (v: Float32Array) => v[TEXT_VERTEX_FLOATS] - v[0];
        const height = (v: Float32Array) => v[2 * TEXT_VERTEX_FLOATS + 1] - v[1];
        expect(width(shadow)).toBeGreaterThan(width(fill));
        expect(height(shadow) - height(fill)).toBeCloseTo(width(shadow) - width(fill), 5);
        const centre = (v: Float32Array, axis: number) => (v[axis] + v[2 * TEXT_VERTEX_FLOATS + axis]) / 2;
        expect(centre(shadow, 0)).toBeCloseTo(centre(fill, 0), 5);
        expect(centre(shadow, 1) - centre(fill, 1)).toBeCloseTo(-1, 5);
    });

    it('keeps one cell per glyph, size and shadow, and bakes another for another strength', () => {
        const atlas = coverageAtlas(ring(12));
        const glyph = atlas.getGlyph(65, 'Arial', 0, 12)!;
        const taps = shadowTaps(6, 12);
        const soft = atlas.shadowed(glyph, { key: 'k', taps, strength: 0.9, downsample: 1 })!;
        expect(atlas.shadowed(glyph, { key: 'k', taps, strength: 0.9, downsample: 1 })).toBe(soft);
        expect(atlas.shadowed(glyph, { key: 'k2', taps, strength: 0.5, downsample: 1 })).not.toBe(soft);
        expect(atlas.shadowed(soft, { key: 'k', taps, strength: 0.9, downsample: 1 })).toBeNull();
    });

    it('bakes the cell again into a page that lost its pixels', () => {
        let paint: ((pixels: Uint8Array) => void) | null = null;
        const tile = ring(12);
        const atlas = coverageAtlas(tile, (p) => { paint = p; });
        const glyph = atlas.getGlyph(65, 'Arial', 0, 12)!;
        const taps = shadowTaps(6, 12);
        const soft = atlas.shadowed(glyph, { key: 'k', taps, strength: 0.9, downsample: 1 })!;
        const expected = shadowRaster(tile, taps, 0.9);
        const page = new Uint8Array(256 * 256 * 4);
        paint!(page);
        const x0 = Math.round(soft.u0 * 256), y0 = Math.round(soft.v0 * 256);
        for (let y = 0; y < expected.height; y++) {
            for (let x = 0; x < expected.width; x++) {
                expect(page[((y0 + y) * 256 + x0 + x) * 4 + 3]).toBe(expected.pixels[(y * expected.width + x) * 4 + 3]);
            }
        }
    });

    it('bakes a distance-field glyph\'s shadow smaller, beside the glyph, drawn once with it', () => {
        const kinds: (boolean | undefined)[] = [];
        const rasterizer: GlyphRasterizer = { renderSize: 48, spread: 4, rasterize: () => distanceDisk(40, 12, 4) };
        const store: AtlasPageStore = { createPage: (_size, _paint, distance) => { kinds.push(distance); return kinds.length; }, uploadSubRegion: () => {} };
        const atlas = new GlyphAtlas(rasterizer, store, { pageSize: 512, padding: 1, sdf: true });
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'A', fontFamily: 'Arial', fontSizePx: 12, color: [1, 1, 1, 1],
            shadow: { color: [0, 0, 0, 0.9], dx: 0, dy: 1, blur: 6 },
        });
        expect(sink).toHaveBeenCalledTimes(2);
        expect(kinds).toEqual([true]);
        expect(sink.mock.calls[0][2]).toBe(sink.mock.calls[1][2]);
        expect(sink.mock.calls[0][3]).toBe(sink.mock.calls[1][3]);
        const shadow = sink.mock.calls[0][0] as Float32Array;
        const fill = sink.mock.calls[1][0] as Float32Array;
        for (let i = 8; i < shadow.length; i += TEXT_VERTEX_FLOATS) expect(shadow[i]).toBe(SHADOW_COVERAGE_BIAS);
        for (let i = 8; i < fill.length; i += TEXT_VERTEX_FLOATS) expect(fill[i]).toBe(0);
        const centreX = (v: Float32Array) => (v[0] + v[TEXT_VERTEX_FLOATS]) / 2;
        const width = (v: Float32Array) => v[TEXT_VERTEX_FLOATS] - v[0];
        expect(centreX(shadow)).toBeCloseTo(centreX(fill), 1);
        expect(width(shadow)).toBeGreaterThan(width(fill) * 1.4);
        expect(shadow[7]).toBeCloseTo(0.9, 5);
    });

    it('turns distances into the disk they bound before it spreads them', () => {
        const disk = distanceDisk(72, 30, 4);
        const taps = shadowTaps(6, 12).map(([x, y]) => [x * 4, y * 4] as const);
        const cell = distanceShadowRaster(disk, 4, taps, 0.9, 2);
        const margin = Math.round((disk.bearingX - cell.bearingX) / 2);
        expect(cell.width).toBe(36 + margin * 2);
        expect(cell.bearingY - disk.bearingY).toBe(margin * 2);
        const alpha = (x: number, y: number): number => cell.pixels[(y * cell.width + x) * 4 + 3];
        const centre = margin + 18;
        expect(alpha(centre, centre)).toBe(255);
        expect(alpha(0, 0)).toBe(0);
        expect(alpha(centre, centre - 28)).toBe(0);
        expect(alpha(centre, centre - 20)).toBeGreaterThan(0);
        const ideal = new Uint8Array(36 * 36 * 4);
        for (let y = 0; y < 36; y++) {
            for (let x = 0; x < 36; x++) {
                let sum = 0;
                for (let sy = y * 2; sy < y * 2 + 2; sy++) {
                    for (let sx = x * 2; sx < x * 2 + 2; sx++) sum += Math.min(1, Math.max(0, 0.5 + (30 - Math.hypot(sx - 35.5, sy - 35.5)) / 2));
                }
                ideal[(y * 36 + x) * 4 + 3] = Math.round(sum / 4 * 255);
            }
        }
        const reference: RasterGlyph = { pixels: ideal, width: 36, height: 36, advance: 72, bearingX: 0, bearingY: 36 };
        const small = taps.map(([x, y]) => [x / 2, y / 2] as const);
        let worst = 0;
        for (let y = 0; y < cell.height; y++) {
            for (let x = 0; x < cell.width; x++) {
                worst = Math.max(worst, Math.abs(0.9 * alpha(x, y) / 255 - stacked(reference, small, 0.9, margin, x, y)));
            }
        }
        expect(worst).toBeLessThan(6 / 255);
    });
});

describe('a second text shadow', () => {
    it('is drawn behind the first, each as one batch, and a clear one is not drawn', () => {
        const atlas = coverageAtlas(ring(12));
        const sink = vi.fn();
        drawTextWith(atlas, sink, {
            text: 'A B', fontFamily: 'Arial', fontSizePx: 12, color: [1, 1, 1, 1],
            shadow: { color: [0, 0, 0, 0.5], dx: 0, dy: 1, blur: 3 },
            shadow2: { color: [0.1, 0, 0, 0.5], dx: 0, dy: 1, blur: 14 },
        });
        expect(sink).toHaveBeenCalledTimes(3);
        const red = (call: number) => (sink.mock.calls[call][0] as Float32Array)[4];
        expect(red(0)).toBeCloseTo(0.1, 5);
        expect(red(1)).toBe(0);
        // The wide one spreads further than the tight one.
        const width = (call: number) => { const v = sink.mock.calls[call][0] as Float32Array; return v[TEXT_VERTEX_FLOATS] - v[0]; };
        expect(width(0)).toBeGreaterThan(width(1));

        const none = vi.fn();
        drawTextWith(atlas, none, {
            text: 'A B', fontFamily: 'Arial', fontSizePx: 12, color: [1, 1, 1, 1],
            shadow2: { color: [0, 0, 0, 0], dx: 0, dy: 1, blur: 14 },
        });
        expect(none).toHaveBeenCalledTimes(1);
    });
});
