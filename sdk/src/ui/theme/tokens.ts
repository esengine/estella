// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/theme/tokens.ts
 * @brief   ThemeTokens — semantic design tokens for the widget layer,
 *          replacing the deleted per-widget UITheme god-object.
 *
 * Widgets read their default colors from the active theme via {@link getTheme}
 * instead of hard-coding RGBA ("去裸色"): one place defines the palette, and an
 * app can re-theme every widget by calling {@link setTheme} before constructing
 * them. Semantic names (surface/control/primary/…) decouple widgets from literal
 * colors. `DARK_TOKENS` is the built-in default.
 */
import type { Color } from '../../types';

/** Semantic color roles consumed by widgets. */
export interface ThemeColors {
    /** Dialog / panel background. */
    surface: Color;
    /** Raised surface — popup / dropdown list background. */
    surfaceElevated: Color;
    /** Interactive control resting fill (button/option). */
    control: Color;
    controlHover: Color;
    controlActive: Color;
    /** Slider / progress track. */
    track: Color;
    /** Accent — slider fill, progress fill, selected option. */
    primary: Color;
    primaryHover: Color;
    primaryActive: Color;
    /** Content/handle drawn on top of primary or controls. */
    onPrimary: Color;
    /** Modal scrim. */
    backdrop: Color;
}

export interface ThemeTokens {
    colors: ThemeColors;
}

/** Built-in dark palette (mirrors the values the widgets used to hard-code). */
export const DARK_TOKENS: ThemeTokens = {
    colors: {
        surface:        { r: 0.16, g: 0.16, b: 0.18, a: 1 },
        surfaceElevated:{ r: 0.14, g: 0.14, b: 0.16, a: 1 },
        control:        { r: 0.22, g: 0.22, b: 0.26, a: 1 },
        controlHover:   { r: 0.28, g: 0.28, b: 0.32, a: 1 },
        controlActive:  { r: 0.18, g: 0.18, b: 0.22, a: 1 },
        track:          { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        primary:        { r: 0.25, g: 0.56, b: 0.96, a: 1 },
        primaryHover:   { r: 0.30, g: 0.50, b: 0.90, a: 1 },
        primaryActive:  { r: 0.20, g: 0.40, b: 0.75, a: 1 },
        onPrimary:      { r: 1,    g: 1,    b: 1,    a: 1 },
        backdrop:       { r: 0,    g: 0,    b: 0,    a: 0.5 },
    },
};

let activeTheme: ThemeTokens = DARK_TOKENS;

/** The active design tokens widgets resolve their defaults from. */
export function getTheme(): ThemeTokens {
    return activeTheme;
}

/** Replace the active design tokens (affects widgets constructed afterwards). */
export function setTheme(tokens: ThemeTokens): void {
    activeTheme = tokens;
}

/** Convenience: the active color palette. */
export function themeColors(): ThemeColors {
    return activeTheme.colors;
}
