// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera shake tracks: a shake fired, at its force, as the playhead crosses it (on a loop seam too), handed to
 *        the drive's shake handler from the track's entity; saved and loaded as written.
 */
import { describe, it, expect } from 'vitest';
import { advanceTimelineTS, createTimelineState } from '../src/timeline/TimelineDrive';
import { WrapMode, TrackType, type TimelineAsset, type CameraShakeTrack } from '../src/timeline/TimelineTypes';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import type { SampleDeps } from '../src/timeline/TimelineEvaluator';
import type { Entity } from '../src/types';

const ROOT = 1 as Entity;
const BLAST = 9 as Entity;
const asset = (wrapMode: WrapMode = WrapMode.Once): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration: 1, wrapMode,
    tracks: [{ type: TrackType.CameraShake, name: '', childPath: 'Blast', shakes: [{ time: 0.5, force: 2 }, { time: 0.05, force: 0.5 }] }],
});
const deps: SampleDeps = {
    world: {} as SampleDeps['world'], getComponent: () => undefined,
    resolveChild: (root, path) => (path === 'Blast' ? BLAST : path ? null : root),
};

describe('camera shake tracks', () => {
    it('fires each shake from the track’s entity, at its force, as the playhead crosses it', () => {
        const s = createTimelineState();
        s.playing = true;
        const fired: [Entity, number][] = [];
        const onShake = (e: Entity, f: number) => { fired.push([e, f]); };
        advanceTimelineTS(asset(), ROOT, s, 0.3, { deps, onShake });
        expect(fired).toEqual([[BLAST, 0.5]]);
        advanceTimelineTS(asset(), ROOT, s, 0.3, { deps, onShake });
        expect(fired).toEqual([[BLAST, 0.5], [BLAST, 2]]);
        advanceTimelineTS(asset(), ROOT, s, 0.3, { deps, onShake });
        expect(fired).toHaveLength(2);
    });

    it('fires a shake just after the start again on every loop', () => {
        const s = createTimelineState(WrapMode.Loop);
        s.playing = true;
        const fired: number[] = [];
        for (let i = 0; i < 4; i++) advanceTimelineTS(asset(WrapMode.Loop), ROOT, s, 0.45, { deps, onShake: (_e, f) => fired.push(f) });
        // 0 → 1.8 s over two loops: 0.05 twice, 0.5 twice.
        expect(fired.filter((f) => f === 0.5)).toHaveLength(2);
        expect(fired.filter((f) => f === 2)).toHaveLength(2);
    });

    it('saves and loads its shakes', () => {
        const back = parseTimelineAsset(JSON.parse(serializeTimelineToJson(asset()))).tracks[0] as CameraShakeTrack;
        expect(back).toMatchObject({ type: 'cameraShake', childPath: 'Blast', shakes: [{ time: 0.5, force: 2 }, { time: 0.05, force: 0.5 }] });
    });
});
