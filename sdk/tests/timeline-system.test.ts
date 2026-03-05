import { describe, it, expect, beforeEach } from 'vitest';
import {
    WrapMode,
    TrackType,
    type TimelineAsset,
    type PropertyTrack,
} from '../src/timeline/TimelineTypes';
import {
    TimelineInstance,
    advanceTimeline,
    applyWrapMode,
} from '../src/timeline/TimelineSystem';

function createSimpleAsset(duration: number, wrapMode: WrapMode): TimelineAsset {
    return {
        version: '1.0',
        type: 'timeline',
        duration,
        wrapMode,
        tracks: [
            {
                type: TrackType.Property,
                name: 'Fade',
                childPath: '',
                component: 'Sprite',
                channels: [
                    {
                        property: 'color.a',
                        keyframes: [
                            { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                            { time: duration, value: 1, inTangent: 0, outTangent: 0 },
                        ],
                    },
                ],
            } as PropertyTrack,
        ],
    };
}

describe('TimelineSystem', () => {
    describe('applyWrapMode', () => {
        it('should clamp time for Once mode', () => {
            const result = applyWrapMode(3.5, 3.0, WrapMode.Once);
            expect(result.time).toBe(3.0);
            expect(result.stopped).toBe(true);
        });

        it('should not clamp if time is within duration for Once', () => {
            const result = applyWrapMode(1.5, 3.0, WrapMode.Once);
            expect(result.time).toBe(1.5);
            expect(result.stopped).toBe(false);
        });

        it('should wrap around for Loop mode', () => {
            const result = applyWrapMode(3.5, 3.0, WrapMode.Loop);
            expect(result.time).toBeCloseTo(0.5, 5);
            expect(result.stopped).toBe(false);
        });

        it('should handle exact duration for Loop', () => {
            const result = applyWrapMode(3.0, 3.0, WrapMode.Loop);
            expect(result.time).toBeCloseTo(0, 5);
            expect(result.stopped).toBe(false);
        });

        it('should ping-pong for PingPong mode (first bounce)', () => {
            const result = applyWrapMode(3.5, 3.0, WrapMode.PingPong);
            expect(result.time).toBeCloseTo(2.5, 5);
            expect(result.stopped).toBe(false);
        });

        it('should ping-pong for PingPong mode (second bounce)', () => {
            const result = applyWrapMode(7.0, 3.0, WrapMode.PingPong);
            expect(result.time).toBeCloseTo(1.0, 5);
            expect(result.stopped).toBe(false);
        });

        it('should handle negative time', () => {
            const result = applyWrapMode(-1, 3.0, WrapMode.Once);
            expect(result.time).toBe(0);
            expect(result.stopped).toBe(false);
        });
    });

    describe('TimelineInstance', () => {
        it('should create with initial state', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            expect(inst.currentTime).toBe(0);
            expect(inst.playing).toBe(false);
            expect(inst.speed).toBe(1);
        });

        it('should advance time when playing', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.playing = true;
            advanceTimeline(inst, 0.5);
            expect(inst.currentTime).toBeCloseTo(0.5, 5);
        });

        it('should not advance when not playing', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.playing = false;
            advanceTimeline(inst, 0.5);
            expect(inst.currentTime).toBe(0);
        });

        it('should respect speed multiplier', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.playing = true;
            inst.speed = 2;
            advanceTimeline(inst, 0.5);
            expect(inst.currentTime).toBeCloseTo(1.0, 5);
        });

        it('should stop at end for Once mode', () => {
            const asset = createSimpleAsset(1, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.playing = true;
            advanceTimeline(inst, 1.5);
            expect(inst.currentTime).toBe(1.0);
            expect(inst.playing).toBe(false);
        });

        it('should loop for Loop mode', () => {
            const asset = createSimpleAsset(1, WrapMode.Loop);
            const inst = new TimelineInstance(asset);
            inst.playing = true;
            advanceTimeline(inst, 1.5);
            expect(inst.currentTime).toBeCloseTo(0.5, 5);
            expect(inst.playing).toBe(true);
        });

        it('should evaluate property tracks', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.playing = true;
            advanceTimeline(inst, 1.0);

            const results = inst.evaluatePropertyTracks();
            expect(results).toHaveLength(1);
            expect(results[0].childPath).toBe('');
            expect(results[0].component).toBe('Sprite');
            expect(results[0].values.get('color.a')).toBeCloseTo(0.5, 1);
        });

        it('play() should set playing and reset time', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.currentTime = 1.0;
            inst.play();
            expect(inst.playing).toBe(true);
            expect(inst.currentTime).toBe(0);
        });

        it('pause() should stop advancing', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.play();
            advanceTimeline(inst, 0.5);
            inst.pause();
            expect(inst.playing).toBe(false);
            expect(inst.currentTime).toBeCloseTo(0.5, 5);
        });

        it('stop() should reset time to 0', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.play();
            advanceTimeline(inst, 0.5);
            inst.stop();
            expect(inst.playing).toBe(false);
            expect(inst.currentTime).toBe(0);
        });

        it('setTime() should jump to a specific time', () => {
            const asset = createSimpleAsset(2, WrapMode.Once);
            const inst = new TimelineInstance(asset);
            inst.setTime(1.5);
            expect(inst.currentTime).toBe(1.5);
        });
    });
});
