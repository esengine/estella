// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    color.ts
 * @brief   Color helpers on the canonical `Color` ({r,g,b,a}, 0..1 floats — the
 *          engine convention, e.g. white = {1,1,1,1}). Pure. Exposed as the
 *          `col` namespace (the bare `color` name is already an SDK export).
 */

import type { Color } from '../types';
import { scalar } from './scalar';

function to2(x: number): string {
    return Math.round(scalar.clamp01(x) * 255).toString(16).padStart(2, '0');
}

export const col = {
    create(r = 0, g = 0, b = 0, a = 1): Color { return { r, g, b, a }; },
    /** Opaque color from RGB (0..1). */
    rgb(r: number, g: number, b: number): Color { return { r, g, b, a: 1 }; },
    /** From 0..255 channels (alpha defaults opaque). */
    from255(r: number, g: number, b: number, a = 255): Color {
        return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
    },
    clone(c: Color): Color { return { r: c.r, g: c.g, b: c.b, a: c.a }; },

    /** HSV uses degrees for hue and 0..1 for saturation/value/alpha. @beta */
    fromHsv(h: number, s: number, v: number, a = 1): Color {
        const hue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
        const saturation = Number.isFinite(s) ? scalar.clamp01(s) : 0;
        const value = Number.isFinite(v) ? scalar.clamp01(v) : 0;
        const c = value * saturation, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = value - c;
        const rgb = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
            : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
        return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m,
            a: Number.isFinite(a) ? scalar.clamp01(a) : 1 };
    },

    /** Preserve a caller's hue at zero saturation/value; no color-space conversion. @beta */
    toHsv(color: Color, fallbackHue = 0): { h: number; s: number; v: number } {
        const channel = (v: number): number => Number.isFinite(v) ? scalar.clamp01(v) : 0;
        const r = channel(color.r), g = channel(color.g), b = channel(color.b);
        const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
        const h = delta === 0 ? fallbackHue : 60 * (max === r ? (g - b) / delta
            : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
        return { h: Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0, s: max ? delta / max : 0, v: max };
    },

    /** Per-channel linear interpolate a→b by t (t not clamped). */
    lerp(a: Color, b: Color, t: number): Color {
        return {
            r: a.r + (b.r - a.r) * t,
            g: a.g + (b.g - a.g) * t,
            b: a.b + (b.b - a.b) * t,
            a: a.a + (b.a - a.a) * t,
        };
    },
    withAlpha(c: Color, a: number): Color { return { r: c.r, g: c.g, b: c.b, a }; },
    /** Per-channel multiply (tint). */
    multiply(a: Color, b: Color): Color {
        return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b, a: a.a * b.a };
    },
    /** Scale RGB by `s` (alpha unchanged). */
    scaleRgb(c: Color, s: number): Color { return { r: c.r * s, g: c.g * s, b: c.b * s, a: c.a }; },

    /**
     * Parse `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` (with or without `#`) to a
     * 0..1 Color (alpha defaults opaque). Throws on malformed input.
     */
    fromHex(hex: string): Color {
        let h = hex.replace(/^#/, '');
        if (h.length === 3 || h.length === 4) {
            h = h.split('').map((c) => c + c).join('');
        }
        if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) {
            throw new Error(`invalid hex color "${hex}": must be #rgb, #rgba, #rrggbb or #rrggbbaa`);
        }
        const n = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
        return { r: n(0), g: n(2), b: n(4), a: h.length >= 8 ? n(6) : 1 };
    },

    /** Format as `#rrggbb` (or `#rrggbbaa` when `withAlpha`). Clamps to [0,1]. */
    toHex(c: Color, withAlpha = false): string {
        return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}${withAlpha ? to2(c.a) : ''}`;
    },

    equals(a: Color, b: Color, epsilon = 1e-6): boolean {
        return Math.abs(a.r - b.r) <= epsilon
            && Math.abs(a.g - b.g) <= epsilon
            && Math.abs(a.b - b.b) <= epsilon
            && Math.abs(a.a - b.a) <= epsilon;
    },
} as const;
