// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    text-default-family.test.ts
 * @brief   Which typeface a Text that names none is drawn in.
 *
 *          A Text that names no family gets the project's, answered where the
 *          family is decided — one place, which is what keeps the measured wrap
 *          and the rendered glyphs on the same font.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveTextFamily, registerProjectFont, resetProjectFonts } from '../src/ui/text/font-registry';
import { measureText } from '../src/ui/text/measure-text';
import { RuntimeConfig, DEFAULT_FONT_FAMILY } from '../src/defaults';

afterEach(() => {
    RuntimeConfig.defaultFontFamily = DEFAULT_FONT_FAMILY;
    resetProjectFonts();
});

describe('the family a Text is rasterized with', () => {
    it('falls back to the project default when the Text names none', () => {
        RuntimeConfig.defaultFontFamily = 'ProjectSans';
        expect(resolveTextFamily(undefined, '')).toBe('ProjectSans');
    });

    it('is the authored family when there is one', () => {
        RuntimeConfig.defaultFontFamily = 'ProjectSans';
        expect(resolveTextFamily(undefined, 'Georgia')).toBe('Georgia');
    });

    it('is a shipped project font ahead of both', () => {
        RuntimeConfig.defaultFontFamily = 'ProjectSans';
        const handle = registerProjectFont('assets/fonts/x.ttf', 'Shipped');
        expect(resolveTextFamily(handle, 'Georgia')).toBe('Shipped');
    });

    it('measures with the same default it draws with', () => {
        RuntimeConfig.defaultFontFamily = 'ProjectSans';
        // No DOM and no platform glyph source here, so the measurer is the
        // average-advance estimate — what it must NOT do is measure a family of
        // "" while the renderer draws ProjectSans.
        const withDefault = measureText('hello', { fontSize: 16 });
        const named = measureText('hello', { fontSize: 16, fontFamily: 'ProjectSans' });
        expect(withDefault.width).toBeCloseTo(named.width, 6);
    });
});
