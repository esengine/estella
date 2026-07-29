// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { Text, TextRenderMode, resolveTextRenderMode, glyphContentScale, buildText } from '../src/ui';

describe('TextRenderMode', () => {
    it('defines Auto / Bitmap / Sdf', () => {
        expect(TextRenderMode.Auto).toBe(0);
        expect(TextRenderMode.Bitmap).toBe(1);
        expect(TextRenderMode.Sdf).toBe(2);
    });

    it('Text defaults to Auto and declares the editor dropdown', () => {
        expect((Text._default as { renderMode: number }).renderMode).toBe(TextRenderMode.Auto);
        const meta = Text.fieldMeta['renderMode'];
        expect(meta?.enum?.map(o => o.label)).toEqual(['Auto', 'Bitmap', 'Sdf']);
    });

    it('Text defaults enabled (the render toggle the editor eye flips)', () => {
        expect((Text._default as { enabled: boolean }).enabled).toBe(true);
    });

    it('buildText defaults renderMode to Auto and passes overrides through', () => {
        expect(buildText().renderMode).toBe(TextRenderMode.Auto);
        expect(buildText({ renderMode: TextRenderMode.Sdf }).renderMode).toBe(TextRenderMode.Sdf);
        expect(buildText().enabled).toBe(true);
        expect(buildText({ enabled: false }).enabled).toBe(false);
    });
});

describe('resolveTextRenderMode', () => {
    it('forced modes win regardless of scale', () => {
        expect(resolveTextRenderMode(TextRenderMode.Bitmap, 3)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Sdf, 1)).toBe('sdf');
    });

    it('Auto keeps bitmap for unscaled entities (within 2% of 1)', () => {
        // The canvas design-fit is NOT part of this input — the bitmap atlas
        // compensates it via setContentScale, so only the entity's own world
        // scale routes here.
        expect(resolveTextRenderMode(TextRenderMode.Auto, 1)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, 1.019)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, 0.981)).toBe('bitmap');
    });

    it('Auto switches to SDF once the entity itself is scaled', () => {
        // e.g. a pressed-state scale tween or an animated pop-in.
        expect(resolveTextRenderMode(TextRenderMode.Auto, 0.82)).toBe('sdf');
        expect(resolveTextRenderMode(TextRenderMode.Auto, 1.5)).toBe('sdf');
        expect(resolveTextRenderMode(TextRenderMode.Auto, 0.5)).toBe('sdf');
    });

    it('Auto falls back to bitmap on unknown / degenerate scales', () => {
        expect(resolveTextRenderMode(TextRenderMode.Auto, 0)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, -1)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, NaN)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, Infinity)).toBe('bitmap');
    });

    it('treats a missing mode (pre-upgrade scene data) as Auto', () => {
        expect(resolveTextRenderMode(undefined, 1)).toBe('bitmap');
        expect(resolveTextRenderMode(undefined, 0.82)).toBe('sdf');
    });
});

describe('GlyphAtlas content scale (bitmap rasterization density)', () => {
    it('folds the content scale into bitmap pixel sizes, but never SDF', async () => {
        const { GlyphAtlas } = await import('../src/ui/text/glyph-atlas');
        const fakeRasterizer = { renderSize: 48, rasterize: () => null };
        const fakeStore = { createPage: () => 1, uploadRegion: () => {} };

        const bitmap = new GlyphAtlas(fakeRasterizer as never, fakeStore as never, { sdf: false, dpr: 2 });
        expect(bitmap.pixelSizeFor(13)).toBe(26);          // 13 × dpr2
        bitmap.setContentScale(0.823);                      // 800×600 design in a smaller view
        expect(bitmap.pixelSizeFor(13)).toBe(21);          // 13 × 2 × 0.823 ≈ 21.4 → hinted at final px
        bitmap.setContentScale(NaN);                        // degenerate input resets to 1
        expect(bitmap.pixelSizeFor(13)).toBe(26);

        const sdf = new GlyphAtlas(fakeRasterizer as never, fakeStore as never, { sdf: true });
        sdf.setContentScale(0.5);
        expect(sdf.pixelSizeFor(13)).toBe(48);             // SDF is one fixed source
    });
});

describe('glyphContentScale (what size to rasterize FOR)', () => {
    const cam = (over: Record<string, unknown> = {}) => ({
        valid: true, vpW: 1920, worldLeft: -960, worldRight: 960,
        viewProjection: new Float32Array([2 / 1920, 0, 0, 0]),
        ...over,
    } as never);

    it('is device pixels per world unit, so a 1:1 view rasterizes 1:1', () => {
        expect(glyphContentScale(cam(), 1)).toBeCloseTo(1, 5);
        expect(glyphContentScale(cam(), 2)).toBeCloseTo(0.5, 5); // dpr folded in by the atlas
    });

    // The editor holds the layout box at the design size on purpose, so UI does
    // not reflow while the view zooms. Reading the span from that box asked for
    // design-sized glyphs and let the camera scale them — the blur this fixes.
    it('follows the camera when it shows less than the layout box (zoomed in)', () => {
        const zoomed = cam({ viewProjection: new Float32Array([2 / 480, 0, 0, 0]) }); // 4× in
        expect(glyphContentScale(zoomed, 1)).toBeCloseTo(4, 5);
    });

    it('follows the camera when it shows more than the layout box (zoomed out)', () => {
        const wide = cam({ viewProjection: new Float32Array([2 / 3840, 0, 0, 0]) }); // 2× out
        expect(glyphContentScale(wide, 1)).toBeCloseTo(0.5, 5);
    });

    it('falls back to the layout box when the projection says nothing', () => {
        expect(glyphContentScale(cam({ viewProjection: new Float32Array(4) }), 1)).toBeCloseTo(1, 5);
    });

    it('is 1 when there is no valid camera, or a nonsense dpr', () => {
        expect(glyphContentScale(undefined, 1)).toBe(1);
        expect(glyphContentScale(cam({ valid: false }), 1)).toBe(1);
        expect(glyphContentScale(cam(), 0)).toBe(1);
    });
});
