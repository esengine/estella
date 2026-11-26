// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../src/timeline/TimelineLoader';
import { serializeTimelineAsset } from '../src/timeline/TimelineSerializer';
import {
    collectSequenceLayers, resolveShot, resolveActiveShot, wouldNestCycle, sequenceLocalTime, MAX_SEQUENCE_DEPTH,
} from '../src/timeline/timelineSequences';
import { TrackType, WrapMode, type CameraClip, type SequenceClip, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';

const seq = (timeline: string, start: number, duration: number, extra: Partial<SequenceClip> = {}): SequenceClip =>
    ({ start, duration, timeline, root: '', speed: 1, loop: false, ...extra });

const host = (duration: number, ...tracks: TimelineAsset['tracks']): TimelineAsset =>
    ({ version: '1.3', type: 'timeline', duration, wrapMode: WrapMode.Once, tracks });

const seqTrack = (...clips: SequenceClip[]) => ({ type: TrackType.Sequence, name: 'S', childPath: '', clips }) as const;
const camTrack = (...clips: CameraClip[]) => ({ type: TrackType.Camera, name: 'C', childPath: '', clips }) as const;

const resolveChild = (root: Entity, path: string): Entity | null => (path === '' ? root : (path.length as Entity) + 100 as Entity);

describe('camera shots', () => {
    const a: CameraClip = { start: 0, duration: 2, camera: 'A' };
    const b: CameraClip = { start: 2, duration: 2, camera: 'B' };

    it('answers nothing outside every clip', () => {
        expect(resolveShot([a, b], 4.5)).toBeNull();
        expect(resolveShot([], 0)).toBeNull();
    });

    it('cuts where clips touch', () => {
        expect(resolveShot([a, b], 1.99)).toMatchObject({ from: null, to: 'A', weight: 1 });
        expect(resolveShot([a, b], 2)).toMatchObject({ from: null, to: 'B', weight: 1 });
    });

    it('blends across an overlap', () => {
        const over: CameraClip = { start: 1.5, duration: 2, camera: 'B', curve: 1 };
        const s = resolveShot([a, over], 1.75)!;
        expect(s.from).toBe('A');
        expect(s.to).toBe('B');
        expect(s.weight).toBeCloseTo(0.5);
        expect(s.curve).toBe(1);
        expect(resolveShot([a, over], 2.5)).toMatchObject({ to: 'B', weight: 1 });
    });

    it('is a pure function of time', () => {
        const over: CameraClip = { start: 1, duration: 2, camera: 'B' };
        const forward = [0.5, 1.2, 1.8].map((t) => resolveShot([a, over], t));
        const backward = [1.8, 1.2, 0.5].map((t) => resolveShot([a, over], t)).reverse();
        expect(backward).toEqual(forward);
    });

    it('chooses the last two live shots by start time and keeps author order for equal starts', () => {
        const picture = (camera: string, start: number, duration: number, curve?: number): CameraClip =>
            ({ camera, start, duration, curve });
        const clips = [
            picture('Second', 2, 3),
            picture('Older', 0, 8),
            picture('Third', 2, 1, 0),
            picture('', 2.5, 2),
            picture('Ended', 2.25, 0.125),
            picture('Instant', 3, 0, 2),
        ];
        expect(resolveShot(clips, 2.5)).toEqual({ from: 'Second', to: 'Third', weight: 1 / 6, curve: 0 });
        expect(resolveShot(clips, 3)).toEqual({ from: 'Second', to: 'Instant', weight: 0, curve: 2 });
        expect(resolveShot(clips, 3.5)).toEqual({ from: 'Older', to: 'Second', weight: 0.25, curve: 3 });
    });

    it('the outermost timeline with an answer wins', () => {
        const child = host(2, camTrack({ start: 0, duration: 2, camera: 'Inner' }));
        const lookup = (ref: string) => (ref === 'child' ? child : undefined);
        const parentSilent = host(4, seqTrack(seq('child', 1, 2)));
        expect(resolveActiveShot(parentSilent, 1.5, 1 as Entity, resolveChild, lookup)?.to).toBe('Inner'.length + 100);
        const parentCut = host(4, camTrack({ start: 0, duration: 4, camera: 'Outer' }), seqTrack(seq('child', 1, 2)));
        expect(resolveActiveShot(parentCut, 1.5, 1 as Entity, resolveChild, lookup)?.to).toBe('Outer'.length + 100);
        expect(resolveActiveShot(parentSilent, 3.5, 1 as Entity, resolveChild, lookup)).toBeNull();
    });
});

describe('sequence layers', () => {
    const child = host(2);
    const lookup = (ref: string) => (ref === 'child' ? child : undefined);

    it('maps parent time to nested time with speed, hold and loop', () => {
        expect(sequenceLocalTime(seq('c', 1, 4), 0.5, 2)).toBeNull();
        expect(sequenceLocalTime(seq('c', 1, 4), 5, 2)).toBeNull();
        expect(sequenceLocalTime(seq('c', 1, 4), 2, 2)).toBeCloseTo(1);
        expect(sequenceLocalTime(seq('c', 1, 4), 4, 2)).toBe(2);
        expect(sequenceLocalTime(seq('c', 1, 4, { loop: true }), 4, 2)).toBeCloseTo(1);
        expect(sequenceLocalTime(seq('c', 0, 4, { speed: 2 }), 0.5, 2)).toBeCloseTo(1);
    });

    it('collects playing layers with a stable key and own root', () => {
        const parent = host(4, seqTrack(seq('child', 1, 2, { root: 'Rig' })));
        const layers = collectSequenceLayers(parent, 1.5, 1 as Entity, resolveChild, lookup);
        expect(layers).toHaveLength(1);
        expect(layers[0]!.time).toBeCloseTo(0.5);
        expect(layers[0]!.key).toBe('0.0/');
        expect(layers[0]!.root).toBe('Rig'.length + 100);
        expect(collectSequenceLayers(parent, 3.5, 1 as Entity, resolveChild, lookup)).toHaveLength(0);
    });

    it('skips a root it cannot find', () => {
        const parent = host(4, seqTrack(seq('child', 0, 2, { root: 'Gone' })));
        expect(collectSequenceLayers(parent, 1, 1 as Entity, () => null, lookup)).toHaveLength(0);
    });

    it('does not enter a timeline already on the way down', () => {
        const a = host(2, seqTrack(seq('b', 0, 2)));
        const b = host(2, seqTrack(seq('a', 0, 2)));
        const lk = (ref: string) => (ref === 'a' ? a : ref === 'b' ? b : undefined);
        const layers = collectSequenceLayers(a, 1, 1 as Entity, resolveChild, lk, ['a']);
        expect(layers.map((l) => l.ref)).toEqual(['b']);
    });

    it('stops at the depth limit', () => {
        const mk = (i: number) => host(2, seqTrack(seq(`t${i + 1}`, 0, 2)));
        const lk = (ref: string) => mk(Number(ref.slice(1)));
        const layers = collectSequenceLayers(mk(0), 1, 1 as Entity, resolveChild, lk);
        expect(layers.length).toBe(MAX_SEQUENCE_DEPTH);
    });

    it('detects nesting cycles by any route', () => {
        const a = host(2, seqTrack(seq('b', 0, 1)));
        const b = host(2, seqTrack(seq('c', 0, 1)));
        const c = host(2);
        const lk = (ref: string) => ({ a, b, c } as Record<string, TimelineAsset>)[ref];
        expect(wouldNestCycle('a', 'a', lk)).toBe(true);
        expect(wouldNestCycle('c', 'a', lk)).toBe(true);
        expect(wouldNestCycle('a', 'c', lk)).toBe(false);
    });
});

describe('format 1.3', () => {
    const raw = {
        version: '1.2', type: 'timeline', duration: 4, wrapMode: 'once',
        tracks: [
            { type: 'camera', name: 'Shots', clips: [{ start: 0, duration: 2, camera: 'Cam', curve: 2 }, { start: 'x', camera: 5 }] },
            { type: 'sequence', name: 'Subs', clips: [{ start: 1, duration: 2, timeline: 'sub.estimeline', speed: 0, loop: true }] },
        ],
    };

    it('reads, sanitises and round-trips camera and sequence tracks', () => {
        const asset = parseTimelineAsset(raw);
        expect(asset.version).toBe('1.3');
        const cam = asset.tracks[0]!;
        expect(cam.type === TrackType.Camera && cam.clips[1]).toEqual({ start: 0, duration: 0, camera: '' });
        const sub = asset.tracks[1]!;
        expect(sub.type === TrackType.Sequence && sub.clips[0]).toMatchObject({ speed: 1, loop: true, root: '' });
        const again = parseTimelineAsset(JSON.parse(JSON.stringify(serializeTimelineAsset(asset))));
        expect(again).toEqual(asset);
    });

    it('lists the timelines a sequence plays for preloading', () => {
        expect(extractTimelineAssetPaths(parseTimelineAsset(raw)).timelines).toEqual(['sub.estimeline']);
    });
});
