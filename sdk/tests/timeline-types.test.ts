import { describe, it, expect } from 'vitest';
import {
    WrapMode,
    TrackType,
    type Keyframe,
    type PropertyChannel,
    type PropertyTrack,
    type SpineClip,
    type SpineTrack,
    type SpriteAnimTrack,
    type AudioEvent,
    type AudioTrack,
    type ActivationRange,
    type ActivationTrack,
    type Track,
    type TimelineAsset,
} from '../src/timeline/TimelineTypes';

describe('Timeline Types', () => {
    describe('WrapMode enum', () => {
        it('should define once, loop, pingPong', () => {
            expect(WrapMode.Once).toBe(0);
            expect(WrapMode.Loop).toBe(1);
            expect(WrapMode.PingPong).toBe(2);
        });
    });

    describe('TrackType enum', () => {
        it('should define all track types', () => {
            expect(TrackType.Property).toBe('property');
            expect(TrackType.Spine).toBe('spine');
            expect(TrackType.SpriteAnim).toBe('spriteAnim');
            expect(TrackType.Audio).toBe('audio');
            expect(TrackType.Activation).toBe('activation');
        });
    });

    describe('TimelineAsset structure', () => {
        it('should support a full timeline definition', () => {
            const asset: TimelineAsset = {
                version: '1.0',
                type: 'timeline',
                duration: 3.0,
                wrapMode: WrapMode.Loop,
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
                                    { time: 0, value: 0, inTangent: 0, outTangent: 2 },
                                    { time: 1, value: 1, inTangent: 0, outTangent: 0 },
                                ],
                            },
                        ],
                    } as PropertyTrack,
                ],
            };

            expect(asset.duration).toBe(3.0);
            expect(asset.wrapMode).toBe(WrapMode.Loop);
            expect(asset.tracks).toHaveLength(1);
            const track = asset.tracks[0] as PropertyTrack;
            expect(track.type).toBe(TrackType.Property);
            expect(track.channels[0].keyframes).toHaveLength(2);
        });
    });
});
