// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  keyframes.test.ts — the one curve both a timeline and a particle sample.
 *
 * These hold the behaviour the two shapes disagreed about before they were one:
 * a timeline had tangents and six interpolations, a particle curve had straight
 * lines. Whichever a caller relies on, it is decided here now.
 */
import { describe, it, expect } from 'vitest';
import { sampleKeyframes, linearKey, InterpType, type Keyframe } from '../src/math/keyframes';
import { evaluateChannel } from '../src/timeline/TimelineEvaluator';

const key = (time: number, value: number, interpolation?: InterpType, tangents = 0): Keyframe =>
    ({ time, value, inTangent: tangents, outTangent: tangents, interpolation });

describe('sampleKeyframes', () => {
    it('answers 0 for nothing and the lone value for one key', () => {
        expect(sampleKeyframes([], 0.5)).toBe(0);
        expect(sampleKeyframes([linearKey(3, 7)], -99)).toBe(7);
        expect(sampleKeyframes([linearKey(3, 7)], 99)).toBe(7);
    });

    // Endpoints CLAMP rather than extrapolate: a curve states what it states, which is
    // what lets a particle at age 1.0 and a timeline past its last key both be sampled.
    it('clamps outside the authored span', () => {
        const keys = [linearKey(1, 10), linearKey(2, 20)];
        expect(sampleKeyframes(keys, 0)).toBe(10);
        expect(sampleKeyframes(keys, 0.5)).toBe(10);
        expect(sampleKeyframes(keys, 5)).toBe(20);
        expect(sampleKeyframes(keys, 2.5)).toBe(20);
    });

    it('interpolates the way the LEFT key says, per segment', () => {
        const keys = [key(0, 0, InterpType.Step), key(1, 10, InterpType.Linear), key(2, 20)];
        expect(sampleKeyframes(keys, 0.9)).toBe(0);
        expect(sampleKeyframes(keys, 1.5)).toBeCloseTo(15, 5);
    });

    it('eases in, out and both, each bending the way its name says', () => {
        const at = (kind: InterpType) => sampleKeyframes([key(0, 0, kind), key(1, 1, kind)], 0.5);
        expect(at(InterpType.Linear)).toBeCloseTo(0.5, 5);
        expect(at(InterpType.EaseIn)).toBeCloseTo(0.25, 5);
        expect(at(InterpType.EaseOut)).toBeCloseTo(0.75, 5);
        expect(at(InterpType.EaseInOut)).toBeCloseTo(0.5, 5);
    });

    it('uses the tangents by default, and a zero tangent is not a straight line', () => {
        expect(sampleKeyframes([key(0, 0), key(1, 1)], 0.5)).toBeCloseTo(0.5, 5);
        // Hermite with flat tangents eases at both ends, so it is BELOW the straight
        // line early on. Equal here would mean the default silently became linear.
        const hermiteQuarter = sampleKeyframes([key(0, 0), key(1, 1)], 0.25);
        const linearQuarter = sampleKeyframes([key(0, 0, InterpType.Linear), key(1, 1)], 0.25);
        expect(hermiteQuarter).toBeLessThan(linearQuarter);
    });

    // The tangent's VALUE has to reach the result. Every other case here passes on a
    // sampler that read the tangents as zero — it would just be a different smooth curve.
    it('gives a steeper tangent a higher value early in the segment', () => {
        const flat = sampleKeyframes([key(0, 0, undefined, 0), key(1, 1, undefined, 0)], 0.25);
        const steep = sampleKeyframes([key(0, 0, undefined, 2), key(1, 1, undefined, 2)], 0.25);
        expect(steep).toBeGreaterThan(flat);
    });

    // Tangents are value-per-unit-TIME, so the sampler scales them BY the segment: the
    // same shape over three times the span, at a third the slope, must sample alike.
    // A one-unit segment cannot tell scaled from unscaled, so neither of these is one.
    it('scales tangents by the segment, so the same shape samples alike at any width', () => {
        // Steeper than the straight line between the keys (which is slope 1 over the
        // narrow span) — at slope 1 exactly, hermite IS the straight line and this
        // could not tell a scaled tangent from an unscaled one.
        const narrow = sampleKeyframes([key(0, 0, undefined, 2), key(1, 1, undefined, 2)], 0.25);
        const wide = sampleKeyframes([key(0, 0, undefined, 2 / 3), key(3, 1, undefined, 2 / 3)], 0.75);
        expect(wide).toBeCloseTo(narrow, 5);
        expect(narrow).not.toBeCloseTo(0.25, 2);
    });

    it('is what a timeline channel is evaluated by', () => {
        const keyframes = [key(0, 0, InterpType.Linear), key(2, 8, InterpType.Linear)];
        expect(evaluateChannel({ property: 'x', keyframes }, 1)).toBe(sampleKeyframes(keyframes, 1));
        expect(evaluateChannel({ property: 'x', keyframes }, 1)).toBeCloseTo(4, 5);
    });

    it('holds a segment of zero width rather than dividing by it', () => {
        expect(sampleKeyframes([linearKey(1, 5), linearKey(1, 9)], 1)).toBe(5);
    });
});
