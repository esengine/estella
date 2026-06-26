// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    curve.ts
 * @brief   Scalar over-life curve + LUT baking (the size-over-life sibling of
 *          gradient.ts). The editor authors a curve (points over [0,1]); this
 *          bakes it to a fixed scalar lookup table the C++ particle sim samples by
 *          normalized particle age. Same "TS bakes, C++ samples" keystone.
 */
import { GRADIENT_LUT_SIZE } from './gradient';

export interface CurveKey {
    /** Position along life, 0..1. */
    t: number;
    /** Value at this key (size-over-life: a multiplier of the particle's start size). */
    v: number;
}

export interface Curve {
    keys: CurveKey[];
}

function sampleCurve(sorted: CurveKey[], t: number): number {
    const first = sorted[0];
    if (t <= first.t) return first.v;
    const last = sorted[sorted.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (t >= a.t && t <= b.t) {
            const span = b.t - a.t;
            const f = span > 1e-6 ? (t - a.t) / span : 0;
            return a.v + (b.v - a.v) * f;
        }
    }
    return last.v;
}

/**
 * Bake a curve into an `n`-sample scalar table over [0,1] (piecewise linear).
 * Returns null for an empty/absent curve — the caller clears the LUT so the sim
 * falls back to start/end size + easing.
 */
export function bakeCurve(curve: Curve | null | undefined, n = GRADIENT_LUT_SIZE): Float32Array | null {
    const keys = curve?.keys;
    if (!keys || keys.length === 0) return null;
    const sorted = [...keys].sort((a, b) => a.t - b.t);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = sampleCurve(sorted, n > 1 ? i / (n - 1) : 0);
    return out;
}
