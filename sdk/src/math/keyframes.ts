// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    keyframes.ts
 * @brief   A curve as authored: keys, tangents, and the one function that samples them.
 *
 * There were two curves. A timeline channel had tangents and six interpolations and an
 * editor that could draw it; a particle's size-over-life had `{t, v}` pairs, straight
 * lines, and no way to author one at all. Nothing about "a value that changes over a
 * span" is particular to either, so the shape and the sampler live here and both ask.
 *
 * Where `time` runs is the caller's: seconds for a timeline, 0..1 of a particle's life.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

/** How a key reaches the NEXT one. Set per key, so one curve can mix them. */
export const InterpType = {
    Hermite: 'hermite',
    Linear: 'linear',
    Step: 'step',
    EaseIn: 'easeIn',
    EaseOut: 'easeOut',
    EaseInOut: 'easeInOut',
} as const;

export type InterpType = (typeof InterpType)[keyof typeof InterpType];

/** One authored point on a curve. Tangents are in value-per-unit-of-time. */
export interface Keyframe {
    time: number;
    value: number;
    inTangent: number;
    outTangent: number;
    interpolation?: InterpType;
}

// ---------------------------------------------------------------------------
// Sampling — a 1:1 port of TimelineSystem.cpp::evaluateChannel (keep in lock-step)
// ---------------------------------------------------------------------------

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

function easeIn(t: number): number {
    return t * t;
}

function easeOut(t: number): number {
    return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/**
 * @brief The value @p keys hold at @p at. Endpoints CLAMP — a curve states what it
 *        states and nothing beyond, which is what lets a caller sample any time.
 *
 * @details Keys are expected in ascending time; an empty curve is 0 and a single key is
 *          that key everywhere. Hermite is the default: a key states tangents, so
 *          ignoring them would be a silent straight line.
 */
export function sampleKeyframes(keys: readonly Keyframe[], at: number): number {
    if (!keys || keys.length === 0) return 0;
    if (keys.length === 1) return keys[0].value;

    if (at <= keys[0].time) return keys[0].value;
    if (at >= keys[keys.length - 1].time) return keys[keys.length - 1].value;

    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].time <= at) i++;

    const k0 = keys[i];
    const k1 = keys[i + 1];
    const dt = k1.time - k0.time;
    if (dt <= 0) return k0.value;

    const t = (at - k0.time) / dt;

    switch (k0.interpolation) {
        case InterpType.Linear:
            return k0.value + (k1.value - k0.value) * t;
        case InterpType.Step:
            return k0.value;
        case InterpType.EaseIn:
            return k0.value + (k1.value - k0.value) * easeIn(t);
        case InterpType.EaseOut:
            return k0.value + (k1.value - k0.value) * easeOut(t);
        case InterpType.EaseInOut:
            return k0.value + (k1.value - k0.value) * easeInOut(t);
        case InterpType.Hermite:
        default:
            return hermite(k0.value, k1.value, k0.outTangent * dt, k1.inTangent * dt, t);
    }
}

/**
 * @brief A curve as a component or asset carries it.
 * @details A named shape rather than a bare array so a field can say "this is a curve"
 *          and an editor can offer a curve to author it.
 */
export interface Curve {
    keys: Keyframe[];
}

/** A key at @p time with straight lines either side — what a hand-written curve wants. */
export function linearKey(time: number, value: number): Keyframe {
    return { time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear };
}
