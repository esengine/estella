/**
 * @file  REARCH_GUI P1.4c — word-wrap (parity step toward retiring Canvas2D Text,
 *        which has wordWrap). Greedy space-wrap + char-break for long words / CJK
 *        (no spaces). Pure → headless-tested.
 */
import { describe, it, expect } from 'vitest';
import {
    GlyphAtlas, type GlyphRasterizer, type AtlasPageStore, type RasterGlyph,
} from '../src/ui/text/glyph-atlas';
import { wrapLine, measureWidth, layoutText } from '../src/ui/text/layout';

function makeAtlas(): GlyphAtlas {
    const rasterizer: GlyphRasterizer = {
        renderSize: 48,
        rasterize: (cp: number): RasterGlyph =>
            cp === 32
                ? { pixels: new Uint8Array(0), width: 0, height: 0, advance: 6, bearingX: 0, bearingY: 0 }
                : { pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10 },
    };
    let next = 1;
    const store: AtlasPageStore = { createPage: () => next++, uploadSubRegion: () => {} };
    return new GlyphAtlas(rasterizer, store, { pageSize: 256, padding: 1 });
}

// At fontSize 24 / renderSize 48 → scale 0.5: letter advance 5.5, space advance 3.
const F = 24;

describe('REARCH_GUI P1.4c: word-wrap', () => {
    it('measureWidth sums scaled advances', () => {
        expect(measureWidth('AA', makeAtlas(), 'Arial', F, 0)).toBeCloseTo(11);   // 2 × 5.5
        expect(measureWidth('AA AA', makeAtlas(), 'Arial', F, 0)).toBeCloseTo(25); // 11 + 3 + 11
    });

    it('wraps at spaces when a word would overflow', () => {
        expect(wrapLine('AA AA AA', makeAtlas(), 'Arial', F, 0, 12)).toEqual(['AA', 'AA', 'AA']);
    });

    it('keeps words on one line when they fit', () => {
        expect(wrapLine('AA AA', makeAtlas(), 'Arial', F, 0, 30)).toEqual(['AA AA']);
    });

    it('char-breaks a single token wider than the line (long word / CJK)', () => {
        expect(wrapLine('AAAA', makeAtlas(), 'Arial', F, 0, 12)).toEqual(['AA', 'AA']);
        expect(wrapLine('文文文文', makeAtlas(), 'Arial', F, 0, 12)).toEqual(['文文', '文文']);
    });

    it('layoutText applies maxWidth, producing stacked wrapped lines', () => {
        const layout = layoutText('AA AA AA', makeAtlas(), 'Arial', { fontSizePx: F, maxWidth: 12 });
        expect(layout.glyphs.length).toBe(6);     // 3 lines × "AA"
        expect(layout.width).toBeCloseTo(11);     // widest wrapped line
        // glyphs of line 3 sit below line 1
        expect(layout.glyphs[5].y0).toBeLessThan(layout.glyphs[0].y0);
    });
});
