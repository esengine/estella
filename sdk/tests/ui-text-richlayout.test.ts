/**
 * @file  REARCH_GUI P1.4 — rich text layout for the SDF path. Verifies parseRichText
 *        runs become glyphs carrying per-run color, size and bold/italic style.
 *        Pure (mock atlas), so headless-tested.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { layoutRichLine, buildGlyphVertices } from '../src/ui/text/layout';
import { UI_TEXT_BOLD } from '../src/ui/text/ui-text';

function makeAtlas(calls: Array<{ cp: number; style: number }>): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        rasterize: (cp: number, _f: string, style: number): RasterGlyph | null => {
            calls.push({ cp, style });
            return { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 };
        },
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

describe('REARCH_GUI P1.4: rich text layout', () => {
    it('applies per-run color, size and bold style', () => {
        const calls: Array<{ cp: number; style: number }> = [];
        const atlas = makeAtlas(calls);
        const layout = layoutRichLine(
            '<b>A</b><color=#ff0000>B</color><font size=48>C</font>',
            atlas, 'Arial',
            { fontSizePx: 24, color: [1, 1, 1, 1] },
        );

        expect(layout.glyphs.length).toBe(3);

        // A: base white, bold style passed to the rasterizer
        expect(layout.glyphs[0].color).toEqual([1, 1, 1, 1]);
        const aCall = calls.find(c => c.cp === 65)!;
        expect(aCall.style & UI_TEXT_BOLD).toBeTruthy();

        // B: red (<color=#ff0000>), non-bold
        const b = layout.glyphs[1].color!;
        expect(b[0]).toBeGreaterThan(0);
        expect(b[1]).toBe(0);
        expect(b[2]).toBe(0);
        expect(calls.find(c => c.cp === 66)!.style & UI_TEXT_BOLD).toBeFalsy();

        // C: <font size=48> ⇒ scale 48/48 = 1 (vs A's 24/48 = 0.5) ⇒ twice as wide
        const aW = layout.glyphs[0].x1 - layout.glyphs[0].x0;
        const cW = layout.glyphs[2].x1 - layout.glyphs[2].x0;
        expect(cW).toBeCloseTo(aW * 2);
    });

    it('buildGlyphVertices honors per-glyph color over the batch color', () => {
        const calls: Array<{ cp: number; style: number }> = [];
        const atlas = makeAtlas(calls);
        const layout = layoutRichLine('<color=#ff0000>B</color>', atlas, 'Arial', { fontSizePx: 24, color: [1, 1, 1, 1] });
        const { vertices } = buildGlyphVertices(layout.glyphs, [1, 1, 1, 1]);
        // vertex 0 color = the glyph's red, not the white batch color
        expect(vertices[4]).toBeGreaterThan(0); // r
        expect(vertices[5]).toBe(0);            // g
        expect(vertices[6]).toBe(0);            // b
    });
});
