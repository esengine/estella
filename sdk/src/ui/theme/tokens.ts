// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/theme/tokens.ts
 * @brief   ThemeTokens — semantic design tokens for the widget layer.
 *
 * Widgets read their defaults from the active theme via {@link getTheme} instead
 * of hard-coding values ("去裸色"): one place defines the palette + type scale, and
 * an app re-themes every widget it constructs afterwards by calling {@link setTheme}
 * first. Semantic roles (surface/control/primary/text/…) decouple widgets from
 * literal values, so the same widget code renders correctly under {@link DARK_TOKENS}
 * or {@link LIGHT_TOKENS}. `DARK_TOKENS` is the built-in default.
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
    /** Content/handle drawn on top of `primary`. */
    onPrimary: Color;
    /** Default foreground (label text / icon) drawn on `surface`/`control`. */
    text: Color;
    /** Modal scrim. */
    backdrop: Color;
}

/** Every color role, in display order — THE list a theme editor or a project
 *  format validator iterates (keyof ThemeColors, as a runtime value). */
export const THEME_COLOR_ROLES: readonly (keyof ThemeColors)[] = [
    'surface', 'surfaceElevated', 'control', 'controlHover', 'controlActive',
    'track', 'primary', 'primaryHover', 'primaryActive', 'onPrimary', 'text', 'backdrop',
];

/** Typographic scale (font sizes in px) consumed by widget text. */
export interface ThemeType {
    /** Control / label text (buttons, options). */
    label: number;
    /** Body / default text. */
    body: number;
    /** Headings (dialog titles). */
    title: number;
}

export interface ThemeTokens {
    colors: ThemeColors;
    type: ThemeType;
}

/** Shared type scale (the same across light/dark). */
const TYPE_SCALE: ThemeType = { label: 14, body: 15, title: 20 };

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
        text:           { r: 0.92, g: 0.92, b: 0.94, a: 1 },
        backdrop:       { r: 0,    g: 0,    b: 0,    a: 0.5 },
    },
    type: TYPE_SCALE,
};

/** Built-in light palette — the same roles on light surfaces with dark text. */
export const LIGHT_TOKENS: ThemeTokens = {
    colors: {
        surface:        { r: 0.96, g: 0.96, b: 0.97, a: 1 },
        surfaceElevated:{ r: 1,    g: 1,    b: 1,    a: 1 },
        control:        { r: 0.90, g: 0.90, b: 0.92, a: 1 },
        controlHover:   { r: 0.84, g: 0.84, b: 0.87, a: 1 },
        controlActive:  { r: 0.78, g: 0.78, b: 0.82, a: 1 },
        track:          { r: 0.86, g: 0.86, b: 0.88, a: 1 },
        primary:        { r: 0.20, g: 0.52, b: 0.92, a: 1 },
        primaryHover:   { r: 0.26, g: 0.58, b: 0.96, a: 1 },
        primaryActive:  { r: 0.16, g: 0.42, b: 0.80, a: 1 },
        onPrimary:      { r: 1,    g: 1,    b: 1,    a: 1 },
        text:           { r: 0.12, g: 0.12, b: 0.14, a: 1 },
        backdrop:       { r: 0,    g: 0,    b: 0,    a: 0.35 },
    },
    type: TYPE_SCALE,
};

/** A project's partial re-skin over a base theme: any subset of color roles
 *  and type-scale steps. Absent keys inherit from the base. */
export interface ThemeOverrides {
    colors?: Partial<ThemeColors>;
    type?: Partial<ThemeType>;
}

/**
 * Parse a JSON-transportable color override map (role → `#rrggbb[aa]` hex — the
 * shape project manifests and shipped game configs carry) into {@link ThemeOverrides}.
 * Unknown roles and malformed hex are dropped; undefined when nothing valid remains.
 * The ONE config→overrides converter shared by the editor and every shipped host.
 */
export function parseThemeOverrides(colors?: Record<string, string>): ThemeOverrides | undefined {
    if (!colors) return undefined;
    const out: Partial<ThemeColors> = {};
    let any = false;
    for (const role of THEME_COLOR_ROLES) {
        const hex = colors[role];
        const m = typeof hex === 'string' ? /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim()) : null;
        if (!m) continue;
        const n = parseInt(m[1]!, 16);
        out[role] = {
            r: ((n >> 16) & 255) / 255,
            g: ((n >> 8) & 255) / 255,
            b: (n & 255) / 255,
            a: m[2] ? parseInt(m[2], 16) / 255 : 1,
        };
        any = true;
    }
    return any ? { colors: out } : undefined;
}

/**
 * The effective tokens for a base theme name plus a project's partial overrides —
 * the ONE merge every runtime and the editor resolve through, so a project that
 * overrides `primary` alone re-tints the accent while inheriting the rest.
 */
export function resolveThemeTokens(base: 'dark' | 'light', overrides?: ThemeOverrides): ThemeTokens {
    const baseTokens = base === 'light' ? LIGHT_TOKENS : DARK_TOKENS;
    if (!overrides || (!overrides.colors && !overrides.type)) return baseTokens;
    return {
        colors: { ...baseTokens.colors, ...overrides.colors },
        type: { ...baseTokens.type, ...overrides.type },
    };
}

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

/** Convenience: the active type scale. */
export function themeType(): ThemeType {
    return activeTheme.type;
}
