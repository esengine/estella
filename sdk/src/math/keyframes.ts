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

// Short authored curves are cheaper to scan. Only longer arrays need an order
// check. Cache that fact alone so time, tangent and value edits stay live.
const LINEAR_SEARCH_LIMIT = 32;
const LINEAR_SEARCH_WINDOW = 4;
const orderedCurves = new WeakMap<readonly Keyframe[], boolean>();

function hasOrderedTimes(keys: readonly Keyframe[]): boolean {
    let ordered = orderedCurves.get(keys);
    if (ordered !== undefined) return ordered;
    ordered = true;
    for (let i = 1; i < keys.length; i++) {
        if (!(keys[i - 1].time <= keys[i].time)) {
            ordered = false;
            break;
        }
    }
    orderedCurves.set(keys, ordered);
    return ordered;
}

type StoredKeyframe = Pick<Keyframe, 'time' | 'value'> & Partial<Keyframe>;

/** Copy stored keys and record their order before the first playback frame. */
export function loadKeyframes(raw: readonly StoredKeyframe[]): Keyframe[] {
    let previousTime = -Infinity;
    let ordered = true;
    const keys = raw.map(key => {
        ordered = ordered && previousTime <= key.time;
        previousTime = key.time;
        // Missing Hermite tangents on hand-authored keys mean zero slope.
        return { ...key, inTangent: key.inTangent ?? 0, outTangent: key.outTangent ?? 0 };
    });
    if (keys.length > LINEAR_SEARCH_LIMIT) orderedCurves.set(keys, ordered);
    return keys;
}

/** File decoding owns these arrays and objects. Fill missing tangents in place. */
export function adoptDecodedKeyframes(raw: StoredKeyframe[]): Keyframe[] {
    for (let i = 0; i < raw.length; i++) {
        const key = raw[i];
        if (key.inTangent != null && key.outTangent != null) continue;
        if (typeof key === 'object' && !Array.isArray(key)) {
            key.inTangent ??= 0;
            key.outTangent ??= 0;
        } else {
            // Match the object-input reader for a non-record entry in an older file.
            raw[i] = { ...key, inTangent: key.inTangent ?? 0, outTangent: key.outTangent ?? 0 };
        }
    }
    const keys = raw as Keyframe[];
    if (keys.length > LINEAR_SEARCH_LIMIT) hasOrderedTimes(keys);
    return keys;
}

function denseSearchStart(keys: readonly Keyframe[], at: number): number {
    // The first few keys are already close enough to scan. An unordered legacy
    // curve must always start at zero to preserve its first-later-key behavior.
    if (at < keys[LINEAR_SEARCH_WINDOW].time || !hasOrderedTimes(keys)) return 0;

    let left = 0;
    let right = keys.length - 1;
    while (right - left > LINEAR_SEARCH_WINDOW) {
        const middle = left + ((right - left) >>> 1);
        if (keys[middle].time <= at) left = middle;
        else right = middle;
    }
    return left;
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
    let k0 = keys[0];
    if (keys.length === 1 || at <= k0.time) return k0.value;
    const last = keys[keys.length - 1];
    if (at >= last.time) return last.value;

    let i = 1;
    if (keys.length > LINEAR_SEARCH_LIMIT) {
        i = denseSearchStart(keys, at) + 1;
        k0 = keys[i - 1];
    }
    let k1 = keys[i];
    while (k1.time <= at) {
        k0 = k1;
        k1 = keys[++i];
    }
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
