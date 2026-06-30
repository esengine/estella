// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scalar.ts
 * @brief   Scalar math helpers — the single TS source for the clamp/lerp/remap
 *          family game code previously re-implemented inline. Exposed as the
 *          `scalar` namespace (e.g. `scalar.lerp(a, b, t)`).
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export const scalar = {
    /** Clamp `x` to [min, max]. */
    clamp(x: number, min: number, max: number): number {
        return x < min ? min : x > max ? max : x;
    },
    /** Clamp `x` to [0, 1]. */
    clamp01(x: number): number {
        return x < 0 ? 0 : x > 1 ? 1 : x;
    },
    /** Linear interpolate a→b by t (t is not clamped). */
    lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    },
    /** Inverse of lerp: the t for which lerp(a,b,t)===value (0 if a===b). */
    inverseLerp(a: number, b: number, value: number): number {
        return a === b ? 0 : (value - a) / (b - a);
    },
    /** Map `value` from [inMin,inMax] onto [outMin,outMax]. */
    remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
        return outMin + (outMax - outMin) * (inMin === inMax ? 0 : (value - inMin) / (inMax - inMin));
    },
    deg2rad(deg: number): number { return deg * DEG2RAD; },
    rad2deg(rad: number): number { return rad * RAD2DEG; },
    /** Within `epsilon` (default 1e-6). */
    approximately(a: number, b: number, epsilon = 1e-6): boolean {
        return Math.abs(a - b) <= epsilon;
    },
    /** Hermite smoothstep of `x` across the [edge0, edge1] edge (clamped). */
    smoothstep(edge0: number, edge1: number, x: number): number {
        const t = scalar.clamp01(edge0 === edge1 ? 0 : (x - edge0) / (edge1 - edge0));
        return t * t * (3 - 2 * t);
    },
    /** Euclidean modulo — result has the sign of `n` (unlike JS `%`). */
    mod(x: number, n: number): number {
        return ((x % n) + n) % n;
    },
    sign(x: number): number {
        return x > 0 ? 1 : x < 0 ? -1 : 0;
    },
} as const;
