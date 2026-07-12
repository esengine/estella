// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ThemeTokens — the design-token palette + type scale widgets resolve
 *        defaults from, and the built-in dark/light themes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    DARK_TOKENS,
    LIGHT_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    themeType,
    type ThemeTokens,
} from '../src/ui/theme/tokens';
import { themeButtonStates } from '../src/ui/widgets/button';

describe('ThemeTokens', () => {
    afterEach(() => setTheme(DARK_TOKENS));

    it('defaults to the built-in dark palette + type scale', () => {
        expect(getTheme()).toBe(DARK_TOKENS);
        expect(themeColors().primary).toEqual({ r: 0.25, g: 0.56, b: 0.96, a: 1 });
        expect(themeType()).toEqual({ label: 14, body: 15, title: 20 });
    });

    it('ships a light theme: light surfaces, dark text, same type scale', () => {
        expect(LIGHT_TOKENS.colors.surface.r).toBeGreaterThan(0.8);
        expect(DARK_TOKENS.colors.surface.r).toBeLessThan(0.3);
        expect(LIGHT_TOKENS.colors.text.r).toBeLessThan(0.3);
        expect(DARK_TOKENS.colors.text.r).toBeGreaterThan(0.8);
        expect(LIGHT_TOKENS.type).toEqual(DARK_TOKENS.type);
    });

    it('every color role is defined in both themes (no missing role)', () => {
        expect(Object.keys(LIGHT_TOKENS.colors).sort()).toEqual(Object.keys(DARK_TOKENS.colors).sort());
    });

    it('setTheme swaps the active palette + type for later widget construction', () => {
        setTheme(LIGHT_TOKENS);
        expect(themeColors().surface).toEqual(LIGHT_TOKENS.colors.surface);
        const custom: ThemeTokens = {
            colors: { ...DARK_TOKENS.colors, primary: { r: 1, g: 0, b: 0, a: 1 } },
            type: DARK_TOKENS.type,
        };
        setTheme(custom);
        expect(themeColors().primary).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(themeColors().surface).toEqual(DARK_TOKENS.colors.surface); // unrelated roles preserved
    });

    it('themeButtonStates derives the canonical states from the ACTIVE theme', () => {
        expect(themeButtonStates().normal.color).toEqual(DARK_TOKENS.colors.control);
        setTheme(LIGHT_TOKENS);
        const s = themeButtonStates();
        expect(s.normal.color).toEqual(LIGHT_TOKENS.colors.control);
        expect(s.hover.color).toEqual(LIGHT_TOKENS.colors.controlHover);
        expect(s.disabled.color).toMatchObject({ a: LIGHT_TOKENS.colors.control.a * 0.5 });
    });
});
