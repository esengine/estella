// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project fonts: the handle ↔ family map that lets `Text` name a font the
 *        game SHIPS the same way it names a system font.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    familyNameFor, registerProjectFont, projectFontFamily, unregisterProjectFont,
    resolveTextFamily, resetProjectFonts,
} from '../src/ui/text/font-registry';

beforeEach(() => resetProjectFonts());

describe('familyNameFor', () => {
    it('derives a CSS-safe family from the file stem', () => {
        expect(familyNameFor('assets/fonts/PassionOne-Regular.ttf')).toMatch(/^es-PassionOne-Regular-[0-9a-z]+$/);
    });

    it('sanitizes characters a CSS family cannot carry', () => {
        expect(familyNameFor('assets/f/My Font (bold)!.otf')).toMatch(/^es-My-Font-bold-[0-9a-z]+$/);
    });

    it('keeps same-named fonts in different folders apart', () => {
        const a = familyNameFor('assets/a/Body.ttf');
        const b = familyNameFor('assets/b/Body.ttf');
        expect(a).not.toBe(b);
    });

    it('is stable for the same path', () => {
        expect(familyNameFor('assets/x/Body.ttf')).toBe(familyNameFor('assets/x/Body.ttf'));
    });

    it('still produces a usable family for a nameless file', () => {
        expect(familyNameFor('.ttf')).toMatch(/^es-font-[0-9a-z]+$/);
    });
});

describe('registerProjectFont', () => {
    it('maps a handle back to its family', () => {
        const h = registerProjectFont('a.ttf', 'es-a');
        expect(projectFontFamily(h)).toBe('es-a');
    });

    it('is idempotent per path, so reloads share one handle', () => {
        const first = registerProjectFont('a.ttf', 'es-a');
        expect(registerProjectFont('a.ttf', 'es-a')).toBe(first);
    });

    it('gives distinct fonts distinct handles', () => {
        expect(registerProjectFont('a.ttf', 'es-a')).not.toBe(registerProjectFont('b.ttf', 'es-b'));
    });

    it('allocates clear of the ResourceManager handle space', () => {
        // BitmapText.font holds small C++ handles in the same `font` asset slot
        // vocabulary; a collision would make a .fnt silently resolve to a project
        // font's family.
        expect(registerProjectFont('a.ttf', 'es-a')).toBeGreaterThan(0x100000);
        expect(projectFontFamily(1)).toBeNull();
        expect(projectFontFamily(0)).toBeNull();
    });

    it('forgets a font on unload', () => {
        const h = registerProjectFont('a.ttf', 'es-a');
        unregisterProjectFont('a.ttf');
        expect(projectFontFamily(h)).toBeNull();
    });
});

describe('resolveTextFamily', () => {
    it('prefers a project font over the authored family', () => {
        const h = registerProjectFont('a.ttf', 'es-a');
        expect(resolveTextFamily(h, 'Arial')).toBe('es-a');
    });

    it('falls back to the authored family when no font is set', () => {
        expect(resolveTextFamily(0, 'Arial')).toBe('Arial');
        expect(resolveTextFamily(undefined, 'Arial')).toBe('Arial');
    });

    it('falls back when the handle is not a project font (a bitmap font handle)', () => {
        expect(resolveTextFamily(3, 'Arial')).toBe('Arial');
    });

    it('falls back after the font is unloaded, rather than rasterizing nothing', () => {
        const h = registerProjectFont('a.ttf', 'es-a');
        unregisterProjectFont('a.ttf');
        expect(resolveTextFamily(h, 'Arial')).toBe('Arial');
    });
});
