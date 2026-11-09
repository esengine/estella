// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
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

describe('text too large on screen for a bitmap glyph', () => {
    const flat = (contentScale: number) => ({ contentScale, perspective: false });
    const unscaled = { worldScale: { x: 1, y: 1, z: 1 } } as never;

    it('leaves the bitmap pipeline once it would rasterize past the limit', async () => {
        const { glyphKind } = await import('../src/ui/text/plugin');
        const label = { renderMode: TextRenderMode.Auto, fontSize: 10 };
        expect(glyphKind(label, unscaled, 'Arial', flat(1))).toBe('bitmap');
        expect(glyphKind(label, unscaled, 'Arial', flat(12.7))).toBe('bitmap');
        expect(glyphKind(label, unscaled, 'Arial', flat(12.8))).toBe('large');
        expect(glyphKind(label, unscaled, 'Arial', flat(58))).toBe('large');
        expect(glyphKind(label, unscaled, 'Arial', flat(6.4), 2)).toBe('large');
        expect(glyphKind(label, unscaled, 'Arial', flat(1))).toBe('bitmap');
    });

    it('does not override a mode the author chose, or a view it does not apply to', async () => {
        const { glyphKind, drawsLarge } = await import('../src/ui/text/plugin');
        expect(glyphKind({ renderMode: TextRenderMode.Bitmap, fontSize: 10 }, unscaled, 'Arial', flat(58))).toBe('bitmap');
        expect(glyphKind({ renderMode: TextRenderMode.Sdf, fontSize: 10 }, unscaled, 'Arial', flat(58))).toBe('sdf');
        expect(drawsLarge({ renderMode: TextRenderMode.Auto, fontSize: 200 }, 'Arial', { contentScale: 1, perspective: true }, 1)).toBe(false);
    });

    it('holds a ring as wide as a fifth of the em in its distance field', async () => {
        const { LARGE_GLYPH_ATLAS } = await import('../src/ui/text/plugin');
        expect(LARGE_GLYPH_ATLAS.padding).toBeGreaterThanOrEqual(0.2 * LARGE_GLYPH_ATLAS.renderSize);
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
    it('refreshes bitmap DPR and invalidates layouts only when the density changes', async () => {
        const { GlyphAtlas } = await import('../src/ui/text/glyph-atlas');
        const source = { renderSize: 48, spread: 0, rasterize: () => null };
        const atlas = new GlyphAtlas(source, null, { sdf: false });
        atlas.setContentScale(0.75);
        const initial = atlas.generation;
        for (const [density, size, generation] of [[1, 24, initial], [2, 48, initial + 1],
            [2, 48, initial + 1], [3, 72, initial + 2], [1, 24, initial + 3]]) {
            atlas.setDevicePixelRatio(density);
            expect(atlas.pixelSizeFor(32)).toBe(size);
            expect(atlas.generation).toBe(generation);
        }
        atlas.setDevicePixelRatio(NaN);
        atlas.setDevicePixelRatio(Infinity);
        atlas.setDevicePixelRatio(0);
        expect(atlas.pixelSizeFor(32)).toBe(24);
        expect(atlas.generation).toBe(initial + 3);
        const invalid = new GlyphAtlas(source, null, { sdf: false, dpr: Infinity });
        expect(invalid.pixelSizeFor(32)).toBe(32);
        const sdf = new GlyphAtlas(source, null, { sdf: true });
        sdf.setDevicePixelRatio(3);
        expect(sdf.pixelSizeFor(32)).toBe(48);
        expect(sdf.generation).toBe(0);
    });

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
    // Element 0 of an orthographic projection: 2 / the span it shows. It takes
    // the PROJECTION, not a camera — world text asks with the camera's and screen
    // text with the overlay's.
    const projFor = (span: number) => 2 / span;

    it('is device pixels per world unit, so a 1:1 view rasterizes 1:1', () => {
        expect(glyphContentScale(projFor(1920), 1920, 1)).toBeCloseTo(1, 5);
        expect(glyphContentScale(projFor(1920), 1920, 2)).toBeCloseTo(0.5, 5); // dpr folded in by the atlas
    });

    // The editor holds the layout box at the design size on purpose, so UI does
    // not reflow while the view zooms. Reading the span from that box asked for
    // design-sized glyphs and let the camera scale them — the blur this fixes.
    it('follows the projection when it shows less than the layout box (zoomed in)', () => {
        expect(glyphContentScale(projFor(480), 1920, 1)).toBeCloseTo(4, 5); // 4x in
    });

    it('follows the projection when it shows more than the layout box (zoomed out)', () => {
        expect(glyphContentScale(projFor(3840), 1920, 1)).toBeCloseTo(0.5, 5); // 2x out
    });

    it('is 1 when the projection says nothing, rather than guessing from a box', () => {
        expect(glyphContentScale(0, 1920, 1)).toBe(1);
        expect(glyphContentScale(NaN, 1920, 1)).toBe(1);
    });

    it('is 1 with no viewport, or a nonsense dpr', () => {
        expect(glyphContentScale(projFor(1920), 0, 1)).toBe(1);
        expect(glyphContentScale(projFor(1920), 1920, 0)).toBe(1);
    });
});

describe('world text under a perspective camera', () => {
    const ortho = (span: number) => { const m = new Float32Array(16); m[0] = 2 / span; m[5] = 2 / span; m[10] = -1; m[15] = 1; return m; };
    const perspective = (fovDeg: number, aspect: number) => {
        const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
        const m = new Float32Array(16);
        m[0] = f / aspect; m[5] = f; m[10] = -1.0002; m[11] = -1; m[14] = -0.2;
        return m;
    };

    it('has no single scale to rasterize for, and says it is a perspective', async () => {
        const { domainViewOf } = await import('../src/ui/text/plugin');
        expect(domainViewOf(perspective(55, 2670 / 1200), 2670, 2.75)).toEqual({ contentScale: 1, perspective: true });
        const flat = domainViewOf(ortho(960), 1920, 1);
        expect(flat.perspective).toBe(false);
        expect(flat.contentScale).toBeCloseTo(2, 5);
    });

    it('draws Auto text as SDF there, at any scale, and keeps a forced mode', async () => {
        const { domainViewOf, glyphKind } = await import('../src/ui/text/plugin');
        const view = domainViewOf(perspective(55, 16 / 9), 1920, 1);
        const at = (scale: number, renderMode: TextRenderMode = TextRenderMode.Auto) =>
            glyphKind({ renderMode, fontSize: 32 }, { worldScale: { x: scale, y: scale, z: scale } }, 'sans-serif', view);
        expect(at(1)).toBe('sdf');
        expect(at(1.5)).toBe('sdf');
        expect(at(1, TextRenderMode.Bitmap)).toBe('bitmap');
        const flat = domainViewOf(ortho(1920), 1920, 1);
        expect(glyphKind({ renderMode: TextRenderMode.Auto, fontSize: 32 }, { worldScale: { x: 1, y: 1, z: 1 } }, 'sans-serif', flat)).toBe('bitmap');
    });

    it('never rasterizes a bitmap glyph larger than half an atlas page, and says so once', async () => {
        const { GlyphAtlas } = await import('../src/ui/text/glyph-atlas');
        const { log } = await import('../src/util/logger');
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        const atlas = new GlyphAtlas({ renderSize: 48, rasterize: () => null } as never, { createPage: () => 1, uploadRegion: () => {} } as never, { sdf: false, dpr: 2.75 });
        atlas.setContentScale(380);
        expect(atlas.pixelSizeFor(32)).toBe(512);
        expect(atlas.pixelSizeFor(48)).toBe(512);
        expect(warn).toHaveBeenCalledTimes(1);
        atlas.setContentScale(1);
        expect(atlas.pixelSizeFor(32)).toBe(88);
        warn.mockRestore();
    });
});
