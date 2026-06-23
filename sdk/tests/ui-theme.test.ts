// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ThemeTokens — the design-token palette widgets resolve defaults from.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    DARK_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    type ThemeTokens,
} from '../src/ui/theme/tokens';

describe('ThemeTokens', () => {
    afterEach(() => setTheme(DARK_TOKENS));

    it('defaults to the built-in dark palette', () => {
        expect(getTheme()).toBe(DARK_TOKENS);
        expect(themeColors().primary).toEqual({ r: 0.25, g: 0.56, b: 0.96, a: 1 });
        expect(themeColors().backdrop).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    });

    it('setTheme swaps the active palette for later widget construction', () => {
        const custom: ThemeTokens = {
            colors: { ...DARK_TOKENS.colors, primary: { r: 1, g: 0, b: 0, a: 1 } },
        };
        setTheme(custom);
        expect(themeColors().primary).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        // unrelated roles are preserved
        expect(themeColors().surface).toEqual(DARK_TOKENS.colors.surface);
    });
});
