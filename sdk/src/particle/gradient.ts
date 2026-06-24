// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gradient.ts
 * @brief   Color gradient (over particle life) + LUT baking. The editor authors a
 *          gradient (color stops); this bakes it to a fixed RGBA lookup table the
 *          C++ particle sim samples by normalized particle age. Curve math lives
 *          here (TS) only — the runtime just indexes the baked table.
 */
import type { Color } from '../types';

export interface GradientStop {
    /** Position along life, 0..1. */
    t: number;
    color: Color;
}

export interface Gradient {
    stops: GradientStop[];
}

/** LUT resolution — MUST match the C++ `particle::kColorLutSize`. */
export const GRADIENT_LUT_SIZE = 32;

function sampleGradient(sorted: GradientStop[], t: number): Color {
    const first = sorted[0];
    if (t <= first.t) return first.color;
    const last = sorted[sorted.length - 1];
    if (t >= last.t) return last.color;
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (t >= a.t && t <= b.t) {
            const span = b.t - a.t;
            const f = span > 1e-6 ? (t - a.t) / span : 0;
            return {
                r: a.color.r + (b.color.r - a.color.r) * f,
                g: a.color.g + (b.color.g - a.color.g) * f,
                b: a.color.b + (b.color.b - a.color.b) * f,
                a: a.color.a + (b.color.a - a.color.a) * f,
            };
        }
    }
    return last.color;
}

/**
 * Bake a gradient into an `n`×4 RGBA table sampled uniformly over [0,1]. Returns
 * null for an empty/absent gradient — the caller clears the LUT so the particle
 * sim falls back to start/end + easing.
 */
export function bakeGradient(gradient: Gradient | null | undefined, n = GRADIENT_LUT_SIZE): Float32Array | null {
    const stops = gradient?.stops;
    if (!stops || stops.length === 0) return null;
    const sorted = [...stops].sort((a, b) => a.t - b.t);
    const out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const c = sampleGradient(sorted, n > 1 ? i / (n - 1) : 0);
        out[i * 4] = c.r;
        out[i * 4 + 1] = c.g;
        out[i * 4 + 2] = c.b;
        out[i * 4 + 3] = c.a;
    }
    return out;
}
