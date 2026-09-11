// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    curve.ts
 * @brief   Baking a size-over-life curve into the LUT the C++ sim samples.
 *
 * The curve is the engine's one curve (math/keyframes), so the editor's curve control
 * authors exactly what the sim samples. Time runs 0..1 over a particle's life. Same
 * "TS bakes, C++ samples" keystone as gradient.ts.
 */
import { GRADIENT_LUT_SIZE } from './gradient';
import { sampleKeyframes, type Curve } from '../math/keyframes';

export type { Curve, Keyframe } from '../math/keyframes';

/**
 * Bake a curve into an `n`-sample scalar table over [0,1].
 * Returns null for an empty/absent curve — the caller clears the LUT so the sim
 * falls back to start/end size + easing.
 */
export function bakeCurve(curve: Curve | null | undefined, n = GRADIENT_LUT_SIZE): Float32Array | null {
    const keys = curve?.keys;
    if (!keys || keys.length === 0) return null;
    // A key that is not a number bakes to NaN, and a particle sized NaN does not draw:
    // the emitter vanishes with nothing said. Refusing the curve falls back to
    // start/end size instead, which is wrong but visible — and says so once.
    if (!keys.every((k) => Number.isFinite(k?.time) && Number.isFinite(k?.value))) {
        console.warn('[particle] a size curve has keys without finite time/value — ignoring it '
            + '(a curve is { keys: [{ time, value, inTangent, outTangent }] })');
        return null;
    }
    const sorted = [...keys].sort((a, b) => a.time - b.time);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = sampleKeyframes(sorted, n > 1 ? i / (n - 1) : 0);
    return out;
}
