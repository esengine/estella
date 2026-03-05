import { describe, it, expect } from 'vitest';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../src/timeline/TimelineLoader';
import { WrapMode, TrackType, type TimelineAsset } from '../src/timeline/TimelineTypes';

const MINIMAL_TIMELINE = {
    version: '1.0',
    type: 'timeline',
    duration: 2.0,
    wrapMode: 'once',
    tracks: [
        {
            type: 'property',
            name: 'Fade',
            childPath: '',
            component: 'Sprite',
            channels: [
                {
                    property: 'color.a',
                    keyframes: [
                        { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                        { time: 2, value: 1, inTangent: 0, outTangent: 0 },
                    ],
                },
            ],
        },
    ],
};

const FULL_TIMELINE = {
    version: '1.0',
    type: 'timeline',
    duration: 5.0,
    wrapMode: 'loop',
    tracks: [
        {
            type: 'property',
            name: 'Move',
            childPath: 'child1',
            component: 'Transform',
            channels: [
                {
                    property: 'position.x',
                    keyframes: [
                        { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                        { time: 5, value: 100, inTangent: 0, outTangent: 0 },
                    ],
                },
            ],
        },
        {
            type: 'spine',
            name: 'CharAnim',
            childPath: 'character',
            clips: [
                { start: 0, duration: 2, animation: 'attack', loop: false, speed: 1 },
                { start: 2, duration: 3, animation: 'idle', loop: true, speed: 1 },
            ],
            blendIn: 0.2,
        },
        {
            type: 'spriteAnim',
            name: 'Explosion',
            childPath: 'fx',
            clip: 'assets/fx/boom.esanim',
            startTime: 1.0,
        },
        {
            type: 'audio',
            name: 'SFX',
            childPath: '',
            events: [
                { time: 0, clip: 'assets/audio/whoosh.mp3', volume: 0.8 },
                { time: 1, clip: 'assets/audio/boom.mp3', volume: 1.0 },
            ],
        },
        {
            type: 'activation',
            name: 'ShowHide',
            childPath: 'particles',
            ranges: [{ start: 0.5, end: 4.0 }],
        },
    ],
};

describe('TimelineLoader', () => {
    describe('parseTimelineAsset', () => {
        it('should parse a minimal timeline with property track', () => {
            const result = parseTimelineAsset(MINIMAL_TIMELINE);
            expect(result.version).toBe('1.0');
            expect(result.type).toBe('timeline');
            expect(result.duration).toBe(2.0);
            expect(result.wrapMode).toBe(WrapMode.Once);
            expect(result.tracks).toHaveLength(1);
            expect(result.tracks[0].type).toBe(TrackType.Property);
        });

        it('should parse wrapMode strings to enum values', () => {
            expect(parseTimelineAsset({ ...MINIMAL_TIMELINE, wrapMode: 'once' }).wrapMode).toBe(WrapMode.Once);
            expect(parseTimelineAsset({ ...MINIMAL_TIMELINE, wrapMode: 'loop' }).wrapMode).toBe(WrapMode.Loop);
            expect(parseTimelineAsset({ ...MINIMAL_TIMELINE, wrapMode: 'pingPong' }).wrapMode).toBe(WrapMode.PingPong);
        });

        it('should default wrapMode to Once when missing', () => {
            const data = { ...MINIMAL_TIMELINE };
            delete (data as any).wrapMode;
            expect(parseTimelineAsset(data).wrapMode).toBe(WrapMode.Once);
        });

        it('should parse all track types', () => {
            const result = parseTimelineAsset(FULL_TIMELINE);
            expect(result.tracks).toHaveLength(5);
            expect(result.tracks[0].type).toBe(TrackType.Property);
            expect(result.tracks[1].type).toBe(TrackType.Spine);
            expect(result.tracks[2].type).toBe(TrackType.SpriteAnim);
            expect(result.tracks[3].type).toBe(TrackType.Audio);
            expect(result.tracks[4].type).toBe(TrackType.Activation);
        });

        it('should preserve keyframe data in property tracks', () => {
            const result = parseTimelineAsset(MINIMAL_TIMELINE);
            const track = result.tracks[0];
            if (track.type !== TrackType.Property) throw new Error('Expected property track');
            expect(track.channels[0].keyframes).toHaveLength(2);
            expect(track.channels[0].keyframes[0].time).toBe(0);
            expect(track.channels[0].keyframes[1].value).toBe(1);
        });

        it('should preserve spine clip data', () => {
            const result = parseTimelineAsset(FULL_TIMELINE);
            const track = result.tracks[1];
            if (track.type !== TrackType.Spine) throw new Error('Expected spine track');
            expect(track.clips).toHaveLength(2);
            expect(track.clips[0].animation).toBe('attack');
            expect(track.blendIn).toBe(0.2);
        });
    });

    describe('extractTimelineAssetPaths', () => {
        it('should extract audio clip paths', () => {
            const asset = parseTimelineAsset(FULL_TIMELINE);
            const paths = extractTimelineAssetPaths(asset);
            expect(paths.audio).toContain('assets/audio/whoosh.mp3');
            expect(paths.audio).toContain('assets/audio/boom.mp3');
        });

        it('should extract spriteAnim clip paths', () => {
            const asset = parseTimelineAsset(FULL_TIMELINE);
            const paths = extractTimelineAssetPaths(asset);
            expect(paths.animClips).toContain('assets/fx/boom.esanim');
        });

        it('should return empty arrays for property-only timeline', () => {
            const asset = parseTimelineAsset(MINIMAL_TIMELINE);
            const paths = extractTimelineAssetPaths(asset);
            expect(paths.audio).toHaveLength(0);
            expect(paths.animClips).toHaveLength(0);
        });
    });
});
