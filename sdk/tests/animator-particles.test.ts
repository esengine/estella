// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { Animator, AnimatorControllerAPI, type AnimatorControllerDef } from '../src/animation';
import { World } from '../src/ecs/world';
import { ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { createTimelineMotionDriver } from '../src/timeline/timelineMotion';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { TrackType, WrapMode, type TimelineAsset, type ParticleTrack } from '../src/timeline/TimelineTypes';

const clip = (events: ParticleTrack["events"], wrapMode: WrapMode = WrapMode.Once): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration: 1, wrapMode,
    tracks: [{ type: TrackType.Particle, name: 'burst', childPath: 'Sparks', events }],
});
const motion = (name: string, loop = false) => ({ kind: 'timeline', clip: name, loop });
function fixture(clips: Record<string, TimelineAsset>, def?: AnimatorControllerDef) {
    ensureBuiltinComponentsRegistered();
    const module = createMockModule(), world = new World(); world.connectCpp(module.getRegistry(), module);
    const root = world.spawn('Actor'), sparks = world.spawn('Sparks'); world.setParent(sparks, root);
    const timeline = new TimelineAPI();
    for (const [name, asset] of Object.entries(clips)) timeline.registerAsset(name, asset);
    const calls: string[] = [], targets: number[] = [];
    const particle = Object.fromEntries(['play', 'stop', 'reset'].map(action => [action, (entity: number) => {
        calls.push(action); targets.push(entity);
    }])) as { play(e: number): void; stop(e: number): void; reset(e: number): void };
    const controller = new AnimatorControllerAPI();
    controller.registerMotionDriver('timeline', createTimelineMotionDriver(timeline, { particle: () => particle }));
    controller.registerController('graph', def ?? {
        parameters: [], initialState: 'Play', states: [{ name: 'Play', motion: motion('burst'), transitions: [] }],
    });
    world.insert(root, Animator, { controller: 'graph', currentState: '', enabled: true });
    return { world, root, sparks, calls, targets, controller, tick: (dt: number) => controller.update(world, dt) };
}

describe('native particle tracks through animator motions', () => {
    it('fires the time-zero burst once without requiring a custom-event listener', () => {
        const f = fixture({ burst: clip([{ time: 0, action: 'play' }, { time: .3, action: 'stop' }]) });
        f.tick(0); f.tick(0); f.tick(.1); f.tick(.25); f.tick(2); f.tick(1);
        expect(f.calls).toEqual(['reset', 'play', 'stop']);
        expect(f.targets.every(e => e === f.sparks)).toBe(true);
    });
    it('repeats on each loop without replaying the boundary on the following frame', () => {
        const f = fixture({ burst: clip([{ time: 0, action: 'play' }, { time: .5, action: 'stop' }], WrapMode.Loop) }, {
            parameters: [], initialState: 'Play', states: [{ name: 'Play', motion: motion('burst', true), transitions: [] }],
        });
        f.tick(0); for (let i = 0; i < 8; i++) f.tick(.26);
        expect(f.calls).toEqual(['reset', 'play', 'stop', 'reset', 'play', 'stop', 'reset', 'play']);
    });
    it('cancels events from a fading state and restarts them on re-entry', () => {
        const f = fixture({ burst: clip([{ time: 0, action: 'play' }, { time: .3, action: 'stop' }]), idle: clip([]) }, {
            parameters: [{ name: 'switch', type: 'trigger' }], initialState: 'Burst', states: [
                { name: 'Burst', motion: motion('burst'), transitions: [{ to: 'Idle', duration: .5, conditions: [{ param: 'switch', op: 'trigger' }] }] },
                { name: 'Idle', motion: motion('idle'), transitions: [{ to: 'Burst', conditions: [{ param: 'switch', op: 'trigger' }] }] },
            ],
        });
        f.tick(0); f.tick(.1); f.controller.setTrigger(f.root, 'switch'); f.tick(.1); f.tick(.4);
        expect(f.calls).toEqual(['reset', 'play']);
        f.controller.setTrigger(f.root, 'switch'); f.tick(.1); f.tick(.4);
        expect(f.calls).toEqual(['reset', 'play', 'reset', 'play', 'stop']);
    });
    it('dispatches only the selected blend motion, although both poses are sampled', () => {
        const f = fixture({ low: clip([{ time: .2, action: 'play' }]), high: clip([{ time: .2, action: 'stop' }]) }, {
            parameters: [{ name: 'speed', type: 'float', default: .8 }], initialState: 'Blend', states: [{ name: 'Blend',
                motion: { kind: 'blend1d', parameter: 'speed', thresholds: [{ value: 0, motion: motion('low') }, { value: 1, motion: motion('high') }] }, transitions: [] }],
        });
        f.tick(0); f.tick(.3); expect(f.calls).toEqual(['reset', 'play']);
    });
    it('skips missing targets and keeps effects isolated between apps', () => {
        const a = fixture({ burst: clip([{ time: 0, action: 'play' }]) });
        const b = fixture({ burst: clip([{ time: 0, action: 'play' }]) });
        a.world.despawn(a.sparks); a.tick(0); b.tick(0);
        expect(a.calls).toEqual([]); expect(b.calls).toEqual(['reset', 'play']);
    });
    it('fires once at entry and on each crossing of a ping-pong clip', () => {
        const f = fixture({ burst: clip([{ time: 0, action: 'play' }, { time: .5, action: 'stop' }], WrapMode.PingPong) }, {
            parameters: [], initialState: 'Play', states: [{ name: 'Play', motion: { kind: 'timeline', clip: 'burst' }, transitions: [] }],
        });
        f.tick(0); f.tick(0); for (let i = 0; i < 4; i++) f.tick(.6);
        expect(f.calls).toEqual(['reset', 'play', 'stop', 'stop', 'reset', 'play']);
    });
    it.each([false, true])('orders particle keys by travel direction, keeping equal-time authored order (sorted: %s)', sorted => {
        const events: ParticleTrack['events'] = [
            { time: .8, action: 'stop' }, { time: .2, action: 'play' }, { time: .2, action: 'stop' },
        ];
        if (sorted) events.sort((a, b) => a.time - b.time);
        const f = fixture({ burst: clip(events, WrapMode.PingPong) }, {
            parameters: [], initialState: 'Play', states: [{ name: 'Play', motion: { kind: 'timeline', clip: 'burst' }, transitions: [] }],
        });
        f.tick(0); f.tick(1.05); f.tick(.9);
        expect(f.calls).toEqual(['reset', 'play', 'stop', 'stop', 'stop', 'reset', 'play', 'stop']);
    });
});
