import { describe, it, expect } from 'vitest';
import {
    hermiteInterpolate,
    evaluateChannel,
    evaluatePropertyTrack,
} from '../src/timeline/TimelineEvaluator';
import { TrackType, type PropertyTrack, type PropertyChannel } from '../src/timeline/TimelineTypes';

describe('TimelineEvaluator', () => {
    describe('hermiteInterpolate', () => {
        it('should return start value at t=0', () => {
            const result = hermiteInterpolate(0, 10, 0, 0, 0);
            expect(result).toBe(0);
        });

        it('should return end value at t=1', () => {
            const result = hermiteInterpolate(0, 10, 0, 0, 1);
            expect(result).toBe(10);
        });

        it('should interpolate linearly when tangents are zero and values form a line', () => {
            const result = hermiteInterpolate(0, 10, 0, 0, 0.5);
            expect(result).toBeCloseTo(5, 1);
        });

        it('should respect outTangent of start keyframe', () => {
            const flat = hermiteInterpolate(0, 10, 0, 0, 0.25);
            const steep = hermiteInterpolate(0, 10, 20, 0, 0.25);
            expect(steep).toBeGreaterThan(flat);
        });

        it('should respect inTangent of end keyframe', () => {
            const flat = hermiteInterpolate(0, 10, 0, 0, 0.75);
            const steep = hermiteInterpolate(0, 10, 0, 20, 0.75);
            expect(steep).not.toBeCloseTo(flat, 0);
        });
    });

    describe('evaluateChannel', () => {
        const linearChannel: PropertyChannel = {
            property: 'test',
            keyframes: [
                { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                { time: 1, value: 10, inTangent: 0, outTangent: 0 },
            ],
        };

        it('should return first keyframe value before start', () => {
            expect(evaluateChannel(linearChannel, -0.5)).toBe(0);
        });

        it('should return last keyframe value after end', () => {
            expect(evaluateChannel(linearChannel, 1.5)).toBe(10);
        });

        it('should return exact value at keyframe time', () => {
            expect(evaluateChannel(linearChannel, 0)).toBe(0);
            expect(evaluateChannel(linearChannel, 1)).toBe(10);
        });

        it('should interpolate between keyframes', () => {
            expect(evaluateChannel(linearChannel, 0.5)).toBeCloseTo(5, 1);
        });

        it('should handle single keyframe (constant)', () => {
            const channel: PropertyChannel = {
                property: 'x',
                keyframes: [{ time: 0.5, value: 42, inTangent: 0, outTangent: 0 }],
            };
            expect(evaluateChannel(channel, 0)).toBe(42);
            expect(evaluateChannel(channel, 1)).toBe(42);
        });

        it('should handle multiple keyframes', () => {
            const channel: PropertyChannel = {
                property: 'x',
                keyframes: [
                    { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                    { time: 1, value: 10, inTangent: 0, outTangent: 0 },
                    { time: 2, value: 5, inTangent: 0, outTangent: 0 },
                ],
            };
            expect(evaluateChannel(channel, 0.5)).toBeCloseTo(5, 1);
            expect(evaluateChannel(channel, 1.5)).toBeCloseTo(7.5, 1);
        });

        it('should return empty map for empty keyframes', () => {
            const channel: PropertyChannel = {
                property: 'x',
                keyframes: [],
            };
            expect(evaluateChannel(channel, 0.5)).toBeUndefined();
        });
    });

    describe('evaluatePropertyTrack', () => {
        it('should evaluate all channels and return property map', () => {
            const track: PropertyTrack = {
                type: TrackType.Property,
                name: 'test',
                childPath: '',
                component: 'Sprite',
                channels: [
                    {
                        property: 'color.r',
                        keyframes: [
                            { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                            { time: 1, value: 1, inTangent: 0, outTangent: 0 },
                        ],
                    },
                    {
                        property: 'color.a',
                        keyframes: [
                            { time: 0, value: 1, inTangent: 0, outTangent: 0 },
                            { time: 1, value: 0, inTangent: 0, outTangent: 0 },
                        ],
                    },
                ],
            };

            const result = evaluatePropertyTrack(track, 0.5);
            expect(result.get('color.r')).toBeCloseTo(0.5, 1);
            expect(result.get('color.a')).toBeCloseTo(0.5, 1);
        });

        it('should skip channels with no keyframes', () => {
            const track: PropertyTrack = {
                type: TrackType.Property,
                name: 'test',
                childPath: '',
                component: 'Sprite',
                channels: [
                    { property: 'color.r', keyframes: [] },
                    {
                        property: 'color.g',
                        keyframes: [
                            { time: 0, value: 0.5, inTangent: 0, outTangent: 0 },
                        ],
                    },
                ],
            };

            const result = evaluatePropertyTrack(track, 0);
            expect(result.has('color.r')).toBe(false);
            expect(result.get('color.g')).toBe(0.5);
        });
    });
});
