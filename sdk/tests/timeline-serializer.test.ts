import { describe, it, expect } from 'vitest';
import { serializeTimelineAsset, serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

const ASSET: TimelineAsset = {
    version: '1.1',
    type: 'timeline',
    duration: 5,
    wrapMode: WrapMode.Loop,
    tracks: [
        {
            type: TrackType.Property,
            name: 'Move',
            childPath: 'child1',
            component: 'Transform',
            channels: [{
                property: 'position.x',
                keyframes: [
                    { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                    { time: 5, value: 100, inTangent: 0, outTangent: 0 },
                ],
            }],
        },
        {
            type: TrackType.Audio,
            name: 'SFX',
            childPath: '',
            events: [{ time: 1, clip: 'a.mp3', volume: 0.8 }],
        },
        {
            type: TrackType.AnimFrames,
            name: 'Frames',
            childPath: 'fx',
            frames: [{ texture: 't0' }, { texture: 't1', duration: 0.1 }],
        },
    ],
};

describe('TimelineSerializer', () => {
    it('encodes wrapMode as a string and AnimFrames under the on-disk key', () => {
        const doc = serializeTimelineAsset(ASSET) as any;
        expect(doc.version).toBe('1.1');
        expect(doc.wrapMode).toBe('loop');
        const frames = doc.tracks.find((t: any) => t.type === 'animFrames');
        expect(frames.animFrames).toHaveLength(2);
        expect(frames.frames).toBeUndefined();
    });

    it('round-trips through the loader (parse ∘ serialize == identity)', () => {
        const roundTripped = parseTimelineAsset(JSON.parse(serializeTimelineToJson(ASSET)));
        expect(roundTripped).toEqual(ASSET);
    });
});
