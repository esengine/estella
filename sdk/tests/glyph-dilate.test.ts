// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { dilateCoverage, GlyphAtlas, type AtlasPageStore, type GlyphRasterizer } from '../src/ui/text/glyph-atlas';

describe('growing a coverage glyph into its outline', () => {
    it('reaches the radius solid, fades over its last texel, and goes no further', () => {
        // One lit texel in a 1x1 tile, grown by 3.
        const { alpha, width, height, margin } = dilateCoverage(new Uint8Array([255]), 1, 1, 3);
        expect(margin).toBe(4);
        expect(width).toBe(9);
        expect(height).toBe(9);
        const at = (x: number, y: number) => alpha[(y + margin) * width + (x + margin)];
        expect(at(0, 0)).toBe(255);
        expect(at(2, 0)).toBe(255);       // inside the disk
        expect(at(3, 0)).toBe(128);       // the edge texel, half covered
        expect(at(4, 0)).toBe(0);         // past it
        expect(at(2, 2)).toBe(171);       // diagonal: distance 2.83, inside r + 0.5 by 0.67 → weighted
        expect(at(3, 3)).toBe(0);
    });

    it('keeps the glyph its own strength where it is weaker than full', () => {
        const { alpha, width, margin } = dilateCoverage(new Uint8Array([100]), 1, 1, 1);
        expect(alpha[margin * width + margin]).toBe(100);
        expect(alpha[margin * width + margin + 1]).toBe(50);   // on the radius: half
    });

    function inkedGlyph(size: number): Uint8Array {
        const ss = 16, a = new Uint8Array(size * size);
        const inside = (u: number, v: number) => {
            const ring = Math.hypot(u - 0.62, v - 0.62);
            return (u > 0.15 && u < 0.3 && v > 0.1 && v < 0.9) || (u > 0.15 && u < 0.75 && v > 0.1 && v < 0.22)
                || (ring < 0.24 && ring > 0.13) || (Math.abs((u - 0.3) - (v - 0.3) * 0.8) < 0.03 && v > 0.3 && v < 0.75);
        };
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let hits = 0;
            for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) if (inside((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size)) hits++;
            a[y * size + x] = Math.round(255 * hits / (ss * ss));
        }
        return a;
    }

    function everyTapAnswer(alpha: Uint8Array, size: number, r: number, margin: number, x: number, y: number): number {
        const reach = Math.ceil(r + 0.5);
        let best = 0;
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
            const sx = x - margin + dx, sy = y - margin + dy;
            if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
            const v = alpha[sy * size + sx] * Math.min(1, Math.max(0, r + 0.5 - Math.hypot(dx, dy)));
            if (v > best) best = v;
        }
        return best + 0.5;
    }

    it.each([[10, 0.5], [16, 2], [24, 3.5], [48, 9], [96, 20]])('draws the ring every tap would, a %i px glyph grown by %f', (size, r) => {
        const source = inkedGlyph(size);
        const { alpha, width, height, margin } = dilateCoverage(source, size, size, r);
        let off = 0, worst = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const d = Math.abs(alpha[y * width + x] - Math.floor(everyTapAnswer(source, size, r, margin, x, y)));
            if (d > 2) off++;
            if (d > worst) worst = d;
        }
        expect(worst).toBeLessThanOrEqual(32);
        expect(off / (width * height)).toBeLessThan(0.02);
    });

    it('keeps growing a glyph cheap however wide the ring is', () => {
        const source = inkedGlyph(512);
        const start = performance.now();
        const { alpha, width, margin } = dilateCoverage(source, 512, 512, 102);
        expect(performance.now() - start).toBeLessThan(2000);
        expect(alpha[(margin + 256) * width + margin + 77 - 102 + 1]).toBe(255);
    });

    it('places a grown glyph as its own cell, and repaints it grown', () => {
        const ink = new Uint8Array(4 * 4 * 4);
        for (let i = 3; i < ink.length; i += 4) ink[i] = 255;
        const rasterizer: GlyphRasterizer = {
            renderSize: 16, spread: 0,
            rasterize: () => ({ pixels: ink, width: 4, height: 4, advance: 5, bearingX: 0, bearingY: 4 }),
        };
        let paint: ((pixels: Uint8Array) => void) | null = null;
        const store: AtlasPageStore = {
            createPage: (_size, p) => { paint = p; return 1; },
            uploadSubRegion: () => {},
        };
        const atlas = new GlyphAtlas(rasterizer, store, { pageSize: 64, padding: 1, sdf: false });
        const glyph = atlas.getGlyph(65, 'Arial', 0, 16)!;
        const ring = atlas.outlined(glyph, 2)!;
        expect(ring.width).toBe(4 + 2 * 3);
        expect(ring.bearingX).toBe(glyph.bearingX - 3);
        expect(ring.bearingY).toBe(glyph.bearingY + 3);
        expect(atlas.outlined(glyph, 2)).toBe(ring);   // cached by glyph, size and radius
        // A lost page comes back with the ring grown again, not the bare glyph in its cell.
        const page = new Uint8Array(64 * 64 * 4);
        paint!(page);
        const ringX = Math.round(ring.u0 * 64), ringY = Math.round(ring.v0 * 64);
        expect(page[((ringY + 3) * 64 + ringX + 2) * 4 + 3]).toBe(255);  // grown texel one left of the ink
    });

    it('answers null on a distance-field atlas, which the shader grows instead', () => {
        const rasterizer: GlyphRasterizer = {
            renderSize: 16, spread: 4,
            rasterize: () => ({ pixels: new Uint8Array(16 * 4), width: 4, height: 4, advance: 5, bearingX: 0, bearingY: 4 }),
        };
        const store: AtlasPageStore = { createPage: () => 1, uploadSubRegion: () => {} };
        const atlas = new GlyphAtlas(rasterizer, store, { pageSize: 64, padding: 1, sdf: true });
        expect(atlas.outlined(atlas.getGlyph(65, 'Arial')!, 2)).toBeNull();
    });
});
