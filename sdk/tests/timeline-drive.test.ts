// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    detectTimelineEvents,
    advanceTimelineTS,
    createTimelineState,
    type TimelineState,
} from '../src/timeline/TimelineDrive';
import { TimelineEventType } from '../src/timeline/TimelineRuntime';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { SampleDeps } from '../src/timeline/TimelineEvaluator';

const ROOT = 1 as const;
const resolveRoot = (root: number, childPath: string) => (childPath ? null : root);

function spineAsset(): TimelineAsset {
    return {
        version: '1.1', type: 'timeline', duration: 3, wrapMode: WrapMode.Once,
        tracks: [{
            type: TrackType.Spine, name: 'Char', childPath: '', blendIn: 0,
            clips: [
                { start: 0, duration: 1, animation: 'a', loop: false, speed: 1 },
                { start: 1, duration: 1, animation: 'b', loop: true, speed: 2 },
            ],
        }],
    };
}

describe('detectTimelineEvents (1:1 with C++ evaluateEventTracks)', () => {
    it('spine: enter clip → SpinePlay, switch clip → SpinePlay, exit → SpineStop', () => {
        const asset = spineAsset();
        const s = createTimelineState();

        s.prevTime = 0; s.time = 0.5;
        let ev = detectTimelineEvents(asset, s, resolveRoot, ROOT);
        expect(ev).toEqual([{ kind: TimelineEventType.SpinePlay, entity: ROOT, intParam: 0, floatParam: 1, str: 'a' }]);

        s.prevTime = 0.5; s.time = 1.5;
        ev = detectTimelineEvents(asset, s, resolveRoot, ROOT);
        expect(ev).toEqual([{ kind: TimelineEventType.SpinePlay, entity: ROOT, intParam: 1, floatParam: 2, str: 'b' }]);

        s.prevTime = 1.5; s.time = 2.5; // past both clips
        ev = detectTimelineEvents(asset, s, resolveRoot, ROOT);
        expect(ev).toEqual([{ kind: TimelineEventType.SpineStop, entity: ROOT, intParam: 0, floatParam: 0, str: '' }]);
    });

    it('audio: fires only when an event time is crossed in (prev, time]', () => {
        const asset: TimelineAsset = {
            version: '1.1', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
            tracks: [{ type: TrackType.Audio, name: 'SFX', childPath: '', events: [{ time: 0.5, clip: 'x', volume: 0.8 }] }],
        };
        const s = createTimelineState();
        s.prevTime = 0.4; s.time = 0.6;
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)).toEqual([
            { kind: TimelineEventType.AudioPlay, entity: ROOT, intParam: 0, floatParam: 0.8, str: 'x' },
        ]);
        s.prevTime = 0.6; s.time = 0.9; // 0.5 already passed
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)).toEqual([]);
    });

    it('spriteAnim: fires once when startTime is crossed', () => {
        const asset: TimelineAsset = {
            version: '1.1', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
            tracks: [{ type: TrackType.SpriteAnim, name: 'FX', childPath: '', clip: 'boom', startTime: 1 }],
        };
        const s = createTimelineState();
        s.prevTime = 0.9; s.time = 1.1;
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)).toHaveLength(1);
        s.prevTime = 1.1; s.time = 1.5;
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)).toEqual([]);
    });

    it('activation: emits active state every frame (range half-open)', () => {
        const asset: TimelineAsset = {
            version: '1.1', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
            tracks: [{ type: TrackType.Activation, name: 'Show', childPath: '', ranges: [{ start: 0, end: 1 }] }],
        };
        const s = createTimelineState();
        s.time = 0.5;
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)[0].intParam).toBe(1);
        s.time = 1.5;
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)[0].intParam).toBe(0);
    });
});

function mockDeps(store: Map<string, any>, defs: Record<string, object>): SampleDeps {
    return {
        world: {
            has: (_e, def) => store.has((def as any).__name),
            get: (_e, def) => store.get((def as any).__name),
            set: (_e, def, data) => store.set((def as any).__name, data),
        },
        getComponent: (name) => defs[name],
        resolveChild: resolveRoot,
    };
}

describe('advanceTimelineTS (clock + property apply + stop)', () => {
    const asset: TimelineAsset = {
        version: '1.1', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
        tracks: [{
            type: TrackType.Property, name: 'Move', childPath: '', component: 'Transform',
            channels: [{
                property: 'position.x',
                keyframes: [
                    { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                    { time: 2, value: 100, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                ],
            }],
        }],
    };

    it('advances time, applies the sampled value, and stops at the end (Once)', () => {
        const defs = { Transform: { __name: 'Transform' } };
        const store = new Map<string, any>([['Transform', { position: { x: 0, y: 0, z: 0 } }]]);
        const s: TimelineState = createTimelineState(WrapMode.Once);
        s.playing = true;

        let stopped = advanceTimelineTS(asset, ROOT, s, 1, { deps: mockDeps(store, defs) });
        expect(s.time).toBeCloseTo(1, 5);
        expect(store.get('Transform').position.x).toBeCloseTo(50, 5);
        expect(stopped).toBe(false);
        expect(s.playing).toBe(true);

        stopped = advanceTimelineTS(asset, ROOT, s, 5, { deps: mockDeps(store, defs) });
        expect(s.time).toBeCloseTo(2, 5); // clamped to duration
        expect(stopped).toBe(true);
        expect(s.playing).toBe(false); // Once → stops
    });

    it('does nothing while paused', () => {
        const defs = { Transform: { __name: 'Transform' } };
        const store = new Map<string, any>([['Transform', { position: { x: 7, y: 0, z: 0 } }]]);
        const s = createTimelineState();
        s.playing = false;
        advanceTimelineTS(asset, ROOT, s, 1, { deps: mockDeps(store, defs) });
        expect(store.get('Transform').position.x).toBe(7); // untouched
    });
});
