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
import { sampleKeyframes, linearKey, loadKeyframes, InterpType, type Keyframe } from '../src/math/keyframes';
import { evaluateChannel } from '../src/timeline/TimelineEvaluator';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';

const key = (time: number, value: number, interpolation?: InterpType, tangents = 0): Keyframe =>
    ({ time, value, inTangent: tangents, outTangent: tangents, interpolation });

const timelineWithKeys = (keyframes: Keyframe[]) => ({ version: '1.3', tracks: [{
    type: 'property', component: 'Transform', channels: [{ property: 'position.x', keyframes }],
}] });

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

    it('scrubs a dense curve across mixed interpolation and repeated timestamps', () => {
        const modes = Object.values(InterpType);
        const keys = Array.from({ length: 195 }, (_, i) =>
            key(Math.floor(i / 3) ** 2, Math.sin(i), modes[Math.floor(i / 3) % modes.length], i / 100));
        const last = keys[keys.length - 1];
        expect(sampleKeyframes(keys, 0)).toBe(keys[0].value);
        expect(sampleKeyframes(keys, last.time)).toBe(last.value);
        for (let frame = 0; frame < 64; frame++) {
            const index = 3 * (frame * 37 % 64) + 2;
            const left = keys[index], right = keys[index + 1];
            const at = left.time + (right.time - left.time) * 0.375;
            expect(sampleKeyframes(keys, at)).toBe(sampleKeyframes([left, right], at));
            if (left.time > 0) expect(sampleKeyframes(keys, left.time)).toBe(left.value);
        }
    });

    it('reads time, value and interpolation edits and removed keys on the next sample', () => {
        const keys = Array.from({ length: 257 }, (_, i) => linearKey(i, i));
        expect(sampleKeyframes(keys, 128.75)).toBe(128.75);
        keys[128] = key(128.5, 75, InterpType.Step);
        expect(sampleKeyframes(keys, 127.75)).toBe(101);
        expect(sampleKeyframes(keys, 128.75)).toBe(75);
        keys.splice(128, 1);
        expect(sampleKeyframes(keys, 128.75)).toBe(128.75);
    });

    it('retains first-later-key behavior for a dense curve authored out of order', () => {
        const keys = Array.from({ length: 190 }, (_, i) => key(i, i, InterpType.Step));
        keys[9].time = 150;
        const track = parseTimelineAsset(JSON.stringify(timelineWithKeys(keys))).tracks[0];
        if (track.type !== 'property') throw new Error('Expected a property track');
        for (const curve of [keys, loadKeyframes(keys), track.channels[0].keyframes]) {
            expect(sampleKeyframes(curve, 100)).toBe(8);
            expect(sampleKeyframes(curve, 151)).toBe(151);
        }
    });

    it.each(['object', 'text'])('can seek on the first playback frame after loading a dense curve from %s', source => {
        const doc = timelineWithKeys(Array.from({ length: 2048 }, (_, i) => linearKey(i, i)));
        const asset = parseTimelineAsset(source === 'text' ? JSON.stringify(doc) : doc);
        const track = asset.tracks[0];
        if (track.type !== 'property') throw new Error('Expected a property track');
        const channel = track.channels[0];
        let reads = 0;
        channel.keyframes.forEach((key, i) => Object.defineProperty(key, 'time', {
            get() { reads++; return i; },
        }));
        expect(evaluateChannel(channel, 2045.75)).toBe(2045.75);
        expect(reads).toBeLessThan(32);
    });
});
