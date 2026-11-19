// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A track's mute, lock and group are saved with the timeline, and a muted track or channel plays nowhere: what
 *        the Timeline API hands every player leaves it out.
 */
import { describe, it, expect } from 'vitest';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { WrapMode, TrackType, playableTimeline, type TimelineAsset } from '../src/timeline/TimelineTypes';

const asset = (): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
    tracks: [
        { type: TrackType.Property, name: '', childPath: 'Box', component: 'Transform', group: 'Props', channels: [
            { property: 'position.x', keyframes: [{ time: 0, value: 0, inTangent: 0, outTangent: 0 }] },
            { property: 'position.y', muted: true, keyframes: [{ time: 0, value: 5, inTangent: 0, outTangent: 0 }] },
        ] },
        { type: TrackType.Activation, name: 'Door', childPath: 'Door', muted: true, locked: true, ranges: [{ start: 0, end: 1 }] },
        { type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 1, name: 'beat' }] },
    ],
});

describe('track mute, lock and group', () => {
    it('are saved and loaded back, and are absent from a track that sets none', () => {
        const json = serializeTimelineToJson(asset());
        const raw = JSON.parse(json);
        expect(raw.tracks[0].group).toBe('Props');
        expect(raw.tracks[0].channels[1].muted).toBe(true);
        expect(raw.tracks[1]).toMatchObject({ muted: true, locked: true });
        expect(Object.keys(raw.tracks[2])).not.toContain('muted');
        const back = parseTimelineAsset(raw);
        expect(back.tracks[0]!.group).toBe('Props');
        expect(back.tracks[1]).toMatchObject({ muted: true, locked: true });
    });

    it('leave a muted track and a muted channel out of what plays, and the rest as it is', () => {
        const playable = playableTimeline(asset());
        expect(playable.tracks.map((t) => t.type)).toEqual([TrackType.Property, TrackType.Marker]);
        const prop = playable.tracks[0] as { channels: { property: string }[] };
        expect(prop.channels.map((c) => c.property)).toEqual(['position.x']);
        // Nothing muted: the asset itself.
        const plain = { ...asset(), tracks: [asset().tracks[2]!] };
        expect(playableTimeline(plain)).toBe(plain);
    });

    it('is what the Timeline API hands a player, the same object each frame', () => {
        const api = new TimelineAPI();
        api.registerAsset('cut', asset());
        const a = api.getAsset('cut')!;
        expect(a.tracks.some((t) => t.type === TrackType.Activation)).toBe(false);
        expect(api.getAsset('cut')).toBe(a);
    });
});
