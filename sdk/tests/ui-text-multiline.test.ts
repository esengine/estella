// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.4c — multi-line + alignment text layout (parity step
 *        toward retiring the Canvas2D Text path). Pure → headless-tested.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { layoutText, TEXT_ALIGN_CENTER, TEXT_ALIGN_RIGHT } from '../src/ui/text/layout';

function makeAtlas(): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        rasterize: (): RasterGlyph => ({ pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 }),
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

describe('REARCH_GUI P1.4c: multi-line + alignment', () => {
    it('splits on \\n and stacks lines downward', () => {
        const layout = layoutText('AB\nC', makeAtlas(), 'Arial', { fontSizePx: 24, lineHeight: 30 });
        expect(layout.glyphs.length).toBe(3);            // A,B (line0) + C (line1)
        expect(layout.width).toBeCloseTo(11);            // widest line = "AB"
        // C is on the lower line ⇒ its y is one lineHeight below A's
        const a = layout.glyphs[0], c = layout.glyphs[2];
        expect(c.y0).toBeCloseTo(a.y0 - 30);
    });

    it('center-aligns shorter lines within the widest line block', () => {
        const layout = layoutText('AB\nC', makeAtlas(), 'Arial', { fontSizePx: 24, align: TEXT_ALIGN_CENTER });
        const left = layoutText('AB\nC', makeAtlas(), 'Arial', { fontSizePx: 24 });
        // line "C" (width 5.5) centered in block 11 ⇒ +2.75 vs left
        expect(layout.glyphs[2].x0).toBeCloseTo(left.glyphs[2].x0 + 2.75);
    });

    it('right-aligns shorter lines to the block edge', () => {
        const layout = layoutText('AB\nC', makeAtlas(), 'Arial', { fontSizePx: 24, align: TEXT_ALIGN_RIGHT });
        const left = layoutText('AB\nC', makeAtlas(), 'Arial', { fontSizePx: 24 });
        expect(layout.glyphs[2].x0).toBeCloseTo(left.glyphs[2].x0 + 5.5);
    });

    it('single line (no newline) behaves like a left-aligned line', () => {
        const layout = layoutText('AB', makeAtlas(), 'Arial', { fontSizePx: 24 });
        expect(layout.glyphs.length).toBe(2);
        expect(layout.width).toBeCloseTo(11);
    });

    it('centers within the box (maxWidth) when given, not just the line width', () => {
        const boxed = layoutText('AB', makeAtlas(), 'Arial', { fontSizePx: 24, align: TEXT_ALIGN_CENTER, maxWidth: 100 });
        // line width 11 centered in a 100 box ⇒ +44.5 from the left-aligned x0 (0.5)
        expect(boxed.glyphs[0].x0).toBeCloseTo(0.5 + (100 - 11) / 2);
    });
});
