// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { Text, TextRenderMode, resolveTextRenderMode, buildText } from '../src/ui';

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

    it('buildText defaults renderMode to Auto and passes overrides through', () => {
        expect(buildText().renderMode).toBe(TextRenderMode.Auto);
        expect(buildText({ renderMode: TextRenderMode.Sdf }).renderMode).toBe(TextRenderMode.Sdf);
    });
});

describe('resolveTextRenderMode', () => {
    it('forced modes win regardless of scale', () => {
        expect(resolveTextRenderMode(TextRenderMode.Bitmap, 3)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Sdf, 1)).toBe('sdf');
    });

    it('Auto keeps bitmap at (or within 2% of) pixel-exact 1:1', () => {
        expect(resolveTextRenderMode(TextRenderMode.Auto, 1)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, 1.019)).toBe('bitmap');
        expect(resolveTextRenderMode(TextRenderMode.Auto, 0.981)).toBe('bitmap');
    });

    it('Auto switches to SDF once the text is actually scaled', () => {
        // The design-fit case that motivated the mode: 800×600 design in a
        // 1070×494 viewport lands at ~0.82 texels per pixel.
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
