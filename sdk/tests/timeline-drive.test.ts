// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import {
    detectTimelineEvents,
    advanceTimelineTS,
    createTimelineState,
    applyPlayerFlags,
    latchPlayerFinish,
    type TimelinePlayerFlags,
    type TimelineState,
} from '../src/timeline/TimelineDrive';
import { TimelineEventType } from '../src/timeline/TimelineRuntime';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { resolveWrapMode } from '../src/timeline/TimelinePlugin';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { SampleDeps } from '../src/timeline/TimelineEvaluator';
import type { AudioAPI } from '../src/audio/Audio';

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

    it('audio: a loop-seam event fires via the split wrap segments, not the empty single span', () => {
        const asset: TimelineAsset = {
            version: '1.1', type: 'timeline', duration: 5, wrapMode: WrapMode.Loop,
            tracks: [{ type: TrackType.Audio, name: 'SFX', childPath: '', events: [{ time: 0.05, clip: 'step', volume: 1 }] }],
        };
        const s = createTimelineState(WrapMode.Loop);
        s.prevTime = 4.9; s.time = 0.1; // a frame that wrapped 4.9 → 5.1 → 0.1
        // (prevTime, time] = (4.9, 0.1] is empty — the pre-fix single span misses the seam event.
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT)).toEqual([]);
        // The two seam segments advanceTimelineTS passes on a wrap DO cross t=0.05:
        expect(detectTimelineEvents(asset, s, resolveRoot, ROOT, [[4.9, 5], [0, 0.1]])).toEqual([
            { kind: TimelineEventType.AudioPlay, entity: ROOT, intParam: 0, floatParam: 1, str: 'step' },
        ]);
    });

    it('advanceTimelineTS: a looping clip keeps firing a near-start event every loop', () => {
        const asset: TimelineAsset = {
            version: '1.1', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop,
            tracks: [{ type: TrackType.Audio, name: 'SFX', childPath: '', events: [{ time: 0.05, clip: 'step', volume: 1 }] }],
        };
        const s = createTimelineState(WrapMode.Loop);
        s.playing = true;
        const deps: SampleDeps = { world: {} as SampleDeps['world'], getComponent: () => undefined, resolveChild: resolveRoot };
        const plays: string[] = [];
        const audio = { playSFX: (clip: string) => { plays.push(clip); } } as unknown as AudioAPI;
        // 0.9s/frame: f1 0→0.9 crosses 0.05; f2 0.9→1.8→wrap→0.8 crosses 0.05 on the SEAM.
        advanceTimelineTS(asset, ROOT, s, 0.9, { deps, audio });
        advanceTimelineTS(asset, ROOT, s, 0.9, { deps, audio });
        expect(plays).toEqual(['step', 'step']); // fired on BOTH loops (2nd is the wrap seam)
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

    it('samples a paused seek through nested clips without replaying the skipped cues', () => {
        const child: TimelineAsset = { ...asset, tracks: [...asset.tracks, {
            type: TrackType.CameraShake, childPath: '', name: '', shakes: [{ time: 0.75, force: 1 }, { time: 1.4, force: 2 }],
        }] };
        const host: TimelineAsset = { ...asset, tracks: [{
            type: TrackType.Sequence, childPath: '', name: '', clips: [
                { start: 0, duration: 2, timeline: 'child', root: '', speed: 1, loop: false },
            ],
        }, { type: TrackType.Marker, childPath: '', name: '', markers: [{ time: 0.75, name: 'skip' }] }] };
        const defs = { Transform: { __name: 'Transform' } };
        const store = new Map<string, any>([['Transform', { position: { x: 0, y: 0, z: 0 } }]]);
        const api = new TimelineAPI();
        const state = api.ensureState(ROOT, WrapMode.Once, 1);
        const onShake = vi.fn(), onSignals = vi.fn();
        const ctx = { deps: mockDeps(store, defs), lookup: () => child, onShake, onSignals };
        api.play(ROOT);
        advanceTimelineTS(host, ROOT, state, 0.25, ctx);
        api.pause(ROOT);
        api.setTime(ROOT, 1.25);
        advanceTimelineTS(host, ROOT, state, 0.5, ctx);
        expect(state.time).toBe(1.25);
        expect(store.get('Transform').position.x).toBeCloseTo(62.5);
        expect(onShake).not.toHaveBeenCalled();
        expect(onSignals).not.toHaveBeenCalled();

        store.get('Transform').position.x = 42;
        advanceTimelineTS(host, ROOT, state, 0.5, ctx);
        expect(store.get('Transform').position.x).toBe(42);
        api.play(ROOT);
        advanceTimelineTS(host, ROOT, state, 0.25, ctx);
        expect(onShake.mock.calls).toEqual([[ROOT, 2]]);
        expect(onSignals).not.toHaveBeenCalled();
    });
});

describe('TimelinePlayer flag contract (applyPlayerFlags / latchPlayerFinish)', () => {
    const bare = (duration = 1): TimelineAsset =>
        ({ version: '1.1', type: 'timeline', duration, wrapMode: WrapMode.Once, tracks: [] });
    const deps: SampleDeps = {
        world: {} as SampleDeps['world'],
        getComponent: () => undefined,
        resolveChild: resolveRoot,
    };

    function tick(flags: TimelinePlayerFlags, s: TimelineState, asset: TimelineAsset, dt: number): boolean {
        const rewound = applyPlayerFlags(flags, s);
        const fin = advanceTimelineTS(asset, ROOT, s, dt, { deps });
        return latchPlayerFinish(flags, s, fin) || rewound;
    }

    it('latches finished (and clears playing) when a Once clip completes', () => {
        const flags: TimelinePlayerFlags = { playing: true, finished: false };
        const s = createTimelineState(WrapMode.Once);

        expect(tick(flags, s, bare(1), 0.4)).toBe(false);
        expect(flags).toEqual({ playing: true, finished: false });

        expect(tick(flags, s, bare(1), 0.7)).toBe(true); // crosses the end
        expect(flags).toEqual({ playing: false, finished: true });
        expect(s.time).toBeCloseTo(1, 5); // parked at the end
    });

    it('replays from the top when playing is raised on a finished clip', () => {
        const flags: TimelinePlayerFlags = { playing: true, finished: false };
        const s = createTimelineState(WrapMode.Once);
        tick(flags, s, bare(1), 2); // run to completion
        expect(flags.finished).toBe(true);

        flags.playing = true; // the replay raise (FSM action / game code / editor)
        expect(tick(flags, s, bare(1), 0.25)).toBe(true); // finished cleared → write-back
        expect(flags).toEqual({ playing: true, finished: false });
        expect(s.time).toBeCloseTo(0.25, 5); // advanced from 0, not from the end
    });

    it('an ultra-short clip replays and re-finishes within one tick', () => {
        const flags: TimelinePlayerFlags = { playing: true, finished: false };
        const s = createTimelineState(WrapMode.Once);
        tick(flags, s, bare(0.05), 1);
        flags.playing = true;
        expect(tick(flags, s, bare(0.05), 1)).toBe(true);
        expect(flags).toEqual({ playing: false, finished: true });
    });

    it('a stop that is not a Once completion clears playing without latching finished', () => {
        const flags: TimelinePlayerFlags = { playing: true, finished: false };
        const s = createTimelineState(WrapMode.Once);
        s.playing = false; // stopped by some non-completion source
        expect(latchPlayerFinish(flags, s, false)).toBe(true);
        expect(flags).toEqual({ playing: false, finished: false });
    });

    it('applyPlayerFlags mid-clip is a plain sync (no rewind, no write-back)', () => {
        const flags: TimelinePlayerFlags = { playing: true, finished: false };
        const s = createTimelineState(WrapMode.Once);
        s.time = 0.5;
        s.prevTime = 0.4;
        expect(applyPlayerFlags(flags, s)).toBe(false);
        expect(s.time).toBeCloseTo(0.5, 5);
        expect(s.playing).toBe(true);
    });
});

describe('TimelineAPI write-through (play/pause/stop reach the component flags)', () => {
    it('routes to raise/lower/reset so the flag survives the per-tick reconcile', () => {
        const calls: string[] = [];
        const api = new TimelineAPI({
            raise: e => calls.push(`raise:${e}`),
            lower: e => calls.push(`lower:${e}`),
            reset: e => calls.push(`reset:${e}`),
        });
        api.play(ROOT);
        api.pause(ROOT);
        api.stop(ROOT);
        expect(calls).toEqual([`raise:${ROOT}`, `lower:${ROOT}`, `reset:${ROOT}`]);
    });

    it('stop also rewinds the clock state', () => {
        const api = new TimelineAPI();
        const s = api.ensureState(ROOT, WrapMode.Once, 1);
        s.playing = true;
        s.time = 1.5;
        s.prevTime = 1.4;
        api.stop(ROOT);
        expect(s).toMatchObject({ playing: false, time: 0, prevTime: 0 });
    });
});

/** The clip declares the wrap mode; the player's field only overrides it. */
describe('whose wrap mode wins', () => {
    it('takes the clip\'s when the player names no override', () => {
        expect(resolveWrapMode('', WrapMode.Loop)).toBe(WrapMode.Loop);
        expect(resolveWrapMode('', WrapMode.PingPong)).toBe(WrapMode.PingPong);
        expect(resolveWrapMode('', WrapMode.Once)).toBe(WrapMode.Once);
    });

    it('lets the player override the clip when it names one', () => {
        expect(resolveWrapMode('once', WrapMode.Loop)).toBe(WrapMode.Once);
        expect(resolveWrapMode('loop', WrapMode.Once)).toBe(WrapMode.Loop);
    });

    // An override nobody can spell must not silently become Once and re-create
    // the bug: it is not a name, so it is not an override.
    it('falls back to the clip for a name it cannot decode', () => {
        expect(resolveWrapMode('sideways', WrapMode.Loop)).toBe(WrapMode.Loop);
    });
});

describe('nested sequences', () => {
    const deps: SampleDeps = { world: {} as SampleDeps['world'], getComponent: () => undefined, resolveChild: resolveRoot };
    const child: TimelineAsset = {
        version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
        tracks: [{ type: TrackType.CustomEvent, name: 'E', childPath: '', events: [{ time: 0, name: 'go', payload: {} }] }],
    };
    const parent: TimelineAsset = {
        version: '1.3', type: 'timeline', duration: 6, wrapMode: WrapMode.Once,
        tracks: [{ type: TrackType.Sequence, name: 'S', childPath: '', clips: [
            { start: 1, duration: 2, timeline: 'child', root: '', speed: 1, loop: false },
        ] }],
    };
    const lookup = (ref: string) => (ref === 'child' ? child : undefined);

    it('runs a nested clock, forgets it after the clip and starts it over on re-entry', () => {
        const s = createTimelineState(WrapMode.Once);
        s.playing = true;
        const shots: unknown[] = [];
        const step = (dt: number) => advanceTimelineTS(parent, ROOT, s, dt, { deps, lookup, onShot: (x) => shots.push(x) });
        step(0.5);
        expect(Object.keys(s.nested)).toHaveLength(0);
        step(1);
        expect(Object.keys(s.nested)).toEqual(['0.0/']);
        expect(s.nested['0.0/']!.time).toBeCloseTo(0.5);
        step(2);
        expect(Object.keys(s.nested)).toHaveLength(0);
        expect(shots.every((x) => x === null)).toBe(true);
    });

    it('does nothing for nested clips without a lookup', () => {
        const s = createTimelineState(WrapMode.Once);
        s.playing = true;
        advanceTimelineTS(parent, ROOT, s, 1.5, { deps });
        expect(Object.keys(s.nested)).toHaveLength(0);
    });

    it('uses the sampled nested layer to resolve its shot in the same step', () => {
        const shooting = { ...child, tracks: [{
            type: TrackType.Camera, name: '', childPath: '',
            clips: [{ start: 0, duration: 2, camera: 'Camera' }],
        }] } satisfies TimelineAsset;
        const findTimeline = vi.fn(() => shooting);
        const resolveChild = (root: number, path: string) => path === 'Camera' ? 2 : resolveRoot(root, path);
        const onShot = vi.fn();
        const s = createTimelineState(WrapMode.Once);
        s.playing = true;
        advanceTimelineTS(parent, ROOT, s, 1.5, { deps: { ...deps, resolveChild }, lookup: findTimeline, onShot });
        expect(onShot).toHaveBeenCalledWith({ from: null, to: 2, weight: 1, curve: 3 });
        expect(findTimeline).toHaveBeenCalledOnce();
    });

    it('resolves the updated nested shot after a cue replaces its timeline', () => {
        const old: TimelineAsset = { ...child, tracks: [{
            type: TrackType.Marker, name: '', childPath: '', markers: [{ name: 'replace', time: 0 }],
        }] };
        const updated: TimelineAsset = { ...child, tracks: [{
            type: TrackType.Camera, name: '', childPath: '', clips: [{ start: 0, duration: 2, camera: 'Camera' }],
        }] };
        let current = old;
        const onShot = vi.fn();
        const s = createTimelineState(WrapMode.Once);
        s.playing = true;
        advanceTimelineTS(parent, ROOT, s, 1.5, {
            deps: { ...deps, resolveChild: (root, path) => path === 'Camera' ? 2 : resolveRoot(root, path) },
            lookup: () => current,
            onSignals: () => { current = updated; },
            onShot,
        });
        expect(onShot).toHaveBeenCalledWith({ from: null, to: 2, weight: 1, curve: 3 });
    });

    it('fires nested entry and exact loop crossings once, on the update that reaches them', () => {
        const loop: TimelineAsset = { ...parent, duration: 10, tracks: [{
            type: TrackType.Sequence, name: '', childPath: '', clips: [
                { start: 1, duration: 8, timeline: 'child', root: '', speed: 1, loop: true },
            ],
        }] };
        const punches: TimelineAsset = { ...child, tracks: [{
            type: TrackType.CameraShake, name: '', childPath: '',
            shakes: [{ time: 0, force: 1 }, { time: 1.75, force: 2 }],
        }] };
        const s = createTimelineState(WrapMode.Once);
        s.playing = true;
        const onShake = vi.fn();
        const step = (dt: number) => advanceTimelineTS(loop, ROOT, s, dt, { deps, lookup: () => punches, onShake });
        step(1);
        expect(onShake.mock.calls).toEqual([[ROOT, 1]]);
        step(0.25);
        expect(onShake.mock.calls).toEqual([[ROOT, 1]]);
        step(1.75);
        expect(onShake.mock.calls).toEqual([[ROOT, 1], [ROOT, 2], [ROOT, 1]]);
        step(0.25);
        expect(onShake.mock.calls).toEqual([[ROOT, 1], [ROOT, 2], [ROOT, 1]]);
        onShake.mockClear();
        step(2);
        expect(s.nested['0.0/']?.time).toBeCloseTo(0.25);
        expect(onShake.mock.calls).toEqual([[ROOT, 1], [ROOT, 2]]);
        onShake.mockClear();
        step(3.5);
        expect(onShake.mock.calls).toEqual([[ROOT, 1], [ROOT, 2]]);
    });

    it('does not replay a nested cue from the exact start landed on by a paused seek', () => {
        const punches: TimelineAsset = { ...child, tracks: [{
            type: TrackType.CameraShake, name: '', childPath: '',
            shakes: [{ time: 0, force: 1 }, { time: 0.25, force: 2 }],
        }] };
        const api = new TimelineAPI();
        const s = api.ensureState(ROOT, WrapMode.Once, 1);
        const onShake = vi.fn();
        const step = (dt: number) => advanceTimelineTS(parent, ROOT, s, dt, { deps, lookup: () => punches, onShake });
        api.setTime(ROOT, 1);
        step(0.5);
        expect(onShake).not.toHaveBeenCalled();
        api.play(ROOT);
        step(0.25);
        expect(onShake.mock.calls).toEqual([[ROOT, 2]]);
    });
});

describe('native particle event tracks', () => {
    it('keeps the ping-pong phase across frames and shares entry/crossing semantics with animator motions', () => {
        const asset: TimelineAsset={version:'1.3',type:'timeline',duration:1,wrapMode:WrapMode.PingPong,
            tracks:[{type:TrackType.Particle,name:'burst',childPath:'',events:[{time:0,action:'play'},{time:.5,action:'stop'}]}]};
        const state=createTimelineState(WrapMode.PingPong);state.playing=true;
        const calls:string[]=[],particle={reset:()=>calls.push('reset'),play:()=>calls.push('play'),stop:()=>calls.push('stop')};
        const deps:SampleDeps={world:{} as SampleDeps['world'],getComponent:()=>undefined,resolveChild:resolveRoot};
        advanceTimelineTS(asset,ROOT,state,0,{deps,particle});
        advanceTimelineTS(asset,ROOT,state,0,{deps,particle});
        const times:number[]=[];
        for(let i=0;i<4;i++){advanceTimelineTS(asset,ROOT,state,.6,{deps,particle});times.push(state.time);}
        [.6,.8,.2,.4].forEach((time,i)=>expect(times[i]).toBeCloseTo(time));
        expect(calls).toEqual(['reset','play','stop','stop','reset','play']);
        const api=new TimelineAPI();const owned=api.ensureState(ROOT,WrapMode.PingPong,1);
        Object.assign(owned,state);api.stop(ROOT);api.play(ROOT);
        advanceTimelineTS(asset,ROOT,owned,.1,{deps,particle});
        expect(owned.time).toBeCloseTo(.1);expect(calls.slice(-2)).toEqual(['reset','play']);
    });
    it('restarts once at zero, stops at its key, and fires again across a loop', () => {
        const asset: TimelineAsset={version:'1.3',type:'timeline',duration:1,wrapMode:WrapMode.Loop,
            tracks:[{type:TrackType.Particle,name:'burst',childPath:'',events:[{time:0,action:'play'},{time:.5,action:'stop'}]}]};
        const state=createTimelineState(WrapMode.Loop);state.playing=true;
        const calls:string[]=[],particle={reset:()=>calls.push('reset'),play:()=>calls.push('play'),stop:()=>calls.push('stop')};
        const deps:SampleDeps={world:{} as SampleDeps['world'],getComponent:()=>undefined,resolveChild:resolveRoot};
        advanceTimelineTS(asset,ROOT,state,.1,{deps,particle});
        advanceTimelineTS(asset,ROOT,state,.1,{deps,particle});
        expect(calls).toEqual(['reset','play']);
        advanceTimelineTS(asset,ROOT,state,.4,{deps,particle});
        expect(calls).toEqual(['reset','play','stop']);
        advanceTimelineTS(asset,ROOT,state,.5,{deps,particle});
        expect(calls).toEqual(['reset','play','stop','reset','play']);
    });
});

describe('signals: the events and markers a playhead crosses', () => {
    const asset: TimelineAsset = {
        version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Loop,
        tracks: [
            { type: TrackType.CustomEvent, name: '', childPath: 'Door', events: [{ time: 0.5, name: 'open', payload: { by: 'key' } }] },
            { type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 1.5, name: 'beat' }] },
        ],
    };
    const deps: SampleDeps = { world: {} as SampleDeps['world'], getComponent: () => undefined, resolveChild: () => 1 as never };

    it('does not repeat the time-zero marker while parked at a loop seam', () => {
        const loop: TimelineAsset = { ...asset, tracks: [
            { type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 0, name: 'start' }] },
        ] };
        const state = createTimelineState(WrapMode.Loop);
        state.playing = true;
        const heard: string[] = [];
        const ctx = { deps, onSignals: (signals: readonly { name: string }[]) => { heard.push(...signals.map(s => s.name)); } };
        const advance = (dt: number) => advanceTimelineTS(loop, 1 as never, state, dt, ctx);
        for (const dt of [0, 1, 1]) advance(dt);
        expect(state.time).toBe(0);
        expect(heard).toEqual(['start']);
        state.speed = 0;
        advance(0.25);
        advance(0.25);
        expect(heard).toEqual(['start']);
        state.speed = 1;
        advance(0.25);
        advance(0.25);
        expect(heard).toEqual(['start', 'start']);
    });

    it('hands each over once as it is crossed, with its kind, payload, time and track, and again on the next loop', () => {
        const s = createTimelineState(WrapMode.Loop);
        s.playing = true;
        const heard: string[] = [];
        const onSignals = (signals: { kind: string; name: string; payload: Record<string, unknown>; time: number; childPath: string }[]) => {
            for (const x of signals) heard.push(`${x.kind}:${x.name}@${x.time}:${x.childPath}:${JSON.stringify(x.payload)}`);
        };
        advanceTimelineTS(asset, 1 as never, s, 0.4, { deps, onSignals });
        expect(heard).toEqual([]);
        advanceTimelineTS(asset, 1 as never, s, 0.2, { deps, onSignals });
        expect(heard).toEqual(['event:open@0.5:Door:{"by":"key"}']);
        advanceTimelineTS(asset, 1 as never, s, 1.95, { deps, onSignals });
        // 0.6 → 2.55 wraps: the marker at 1.5, then the event at 0.5 of the next loop.
        expect(heard.slice(1)).toEqual(['marker:beat@1.5::{}', 'event:open@0.5:Door:{"by":"key"}']);
    });
});

describe('a play range', () => {
    const asset: TimelineAsset = {
        version: '1.3', type: 'timeline', duration: 5, wrapMode: WrapMode.Once,
        tracks: [{ type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 0.5, name: 'before' }, { time: 2, name: 'inside' }, { time: 4, name: 'after' }] }],
    };
    const deps: SampleDeps = { world: {} as SampleDeps['world'], getComponent: () => undefined, resolveChild: () => 1 as never };
    const run = (mode: WrapMode, steps: number[]) => {
        const s = createTimelineState(mode);
        s.playing = true;
        s.rangeStart = 1;
        s.rangeEnd = 3;
        const heard: string[] = [];
        let finished = false;
        for (const dt of steps) finished = advanceTimelineTS(asset, 1 as never, s, dt, { deps, onSignals: (x) => { for (const m of x) heard.push(m.name); } }) || finished;
        return { s, heard, finished };
    };

    it('starts at the range’s start, plays only what is inside it, and finishes at its end', () => {
        const { s, heard, finished } = run(WrapMode.Once, [0.5, 0.5, 0.5, 0.5, 0.5]);
        expect(heard).toEqual(['inside']);
        expect(s.time).toBe(3);
        expect(finished).toBe(true);
    });

    it('loops within the range and counts each lap', () => {
        const { s, heard } = run(WrapMode.Loop, [0.5, 0.5, 0.5, 0.5, 0.5]);
        expect(s.time).toBeCloseTo(1.5, 9);
        expect(s.laps).toBe(1);
        expect(heard).toEqual(['inside']);
        const more = run(WrapMode.Loop, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
        expect(more.heard).toEqual(['inside', 'inside']);
    });

    it('plays the whole timeline with no range, as before', () => {
        const s = createTimelineState(WrapMode.Once);
        s.playing = true;
        const heard: string[] = [];
        advanceTimelineTS(asset, 1 as never, s, 6, { deps, onSignals: (x) => { for (const m of x) heard.push(m.name); } });
        expect(heard).toEqual(['before', 'inside', 'after']);
        expect(s.time).toBe(5);
    });
});
