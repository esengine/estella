// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.3b — pure text layout + glyph-vertex building. Driven via
 *        a real GlyphAtlas backed by mock rasterizer/store (no Canvas/GL), so the
 *        scaling, pen advance, quad geometry and vertex/index packing are fully
 *        verified headless.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { layoutLine, buildGlyphVertices } from '../src/ui/text/layout';

const SPACE = 32;
const UNKNOWN = 0xffff;

function makeAtlas(): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        rasterize: (cp: number): RasterGlyph | null => {
            if (cp === UNKNOWN) return null;
            if (cp === SPACE) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 12, bearingX: 0, bearingY: 0 };
            return { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 };
        },
    };
    let next = 1;
    const store: AtlasPageStore = {
        createPage: () => next++,
        uploadSubRegion: () => { /* no-op */ },
    };
    return new GlyphAtlas(rasterizer, store, { pageSize: 64, padding: 1 });
}

describe('REARCH_GUI P1.3b: text layout', () => {
    it('scales metrics by fontSize/renderSize and advances the pen', () => {
        const atlas = makeAtlas();
        const layout = layoutLine('AB', atlas, 'Arial', { fontSizePx: 24 }); // scale 0.5
        expect(layout.glyphs.length).toBe(2);
        expect(layout.width).toBeCloseTo(11);        // 2 × advance(11)×0.5
        const a = layout.glyphs[0];
        expect(a.x0).toBeCloseTo(0.5);               // bearingX(1)×0.5
        expect(a.y1).toBeCloseTo(5);                 // bearingY(10)×0.5
        expect(a.x1).toBeCloseTo(5.5);               // x0 + width(10)×0.5
        expect(a.y0).toBeCloseTo(-1);                // y1 - height(12)×0.5
        expect(layout.glyphs[1].x0).toBeCloseTo(6);  // advance 5.5 + bearingX 0.5
    });

    it('whitespace advances without emitting a quad', () => {
        const atlas = makeAtlas();
        const layout = layoutLine('A B', atlas, 'Arial', { fontSizePx: 24 });
        expect(layout.glyphs.length).toBe(2);                 // space has no quad
        expect(layout.width).toBeCloseTo(5.5 + 6 + 5.5);      // A + space(12×0.5) + B
        expect(layout.glyphs[1].x0).toBeCloseTo(12);          // (5.5+6) + 0.5
    });

    it('skips glyphs the atlas cannot produce (no advance)', () => {
        const atlas = makeAtlas();
        const layout = layoutLine('A￿B', atlas, 'Arial', { fontSizePx: 24 });
        expect(layout.glyphs.length).toBe(2);
        expect(layout.width).toBeCloseTo(11);
    });

    it('letterSpacing adds between glyphs', () => {
        const atlas = makeAtlas();
        const layout = layoutLine('AB', atlas, 'Arial', { fontSizePx: 24, letterSpacing: 3 });
        expect(layout.width).toBeCloseTo(11 + 2 * 3);
    });

    it('builds 4 verts + 6 indices per glyph with correct stride and color', () => {
        const atlas = makeAtlas();
        const layout = layoutLine('AB', atlas, 'Arial', { fontSizePx: 24 });
        const { vertices, indices } = buildGlyphVertices(layout.glyphs, [1, 0, 0, 1], 100, 200);
        expect(vertices.length).toBe(2 * 4 * 8);
        expect(indices.length).toBe(2 * 6);
        // first vertex = bottom-left of glyph 0, with origin applied
        expect(vertices[0]).toBeCloseTo(0.5 + 100); // x
        expect(vertices[1]).toBeCloseTo(-1 + 200);  // y
        expect(vertices[4]).toBe(1);                // r
        expect(vertices[5]).toBe(0);                // g
        expect(vertices[7]).toBe(1);                // a
        // quad winding
        expect(Array.from(indices.slice(0, 6))).toEqual([0, 1, 2, 0, 2, 3]);
    });
});
