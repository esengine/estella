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
