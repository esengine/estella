// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: one graph drives a sprite sheet on one entity and an `.estimeline`
 * on another, the motion each state names being the only difference.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, SpriteAnimator, SpriteAnimationAPI, motionOf,
    type AnimatorData, type AnimatorControllerDef, type AnimatorMotion,
    type AnimatorState, type SpriteAnimatorData,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { defineComponent, Sprite } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { connectFakeCpp } from './helpers/fakeEngine';
import {
    WrapMode, TrackType, InterpType, type TimelineAsset,
} from '../src/timeline/TimelineTypes';

const E = 1;

/**
 * What a timeline motion writes here, so an assertion reads "the animation
 * reached the entity". Fetched per call: the registry is per context and reset
 * between tests, so a definition taken at module load is not the one the
 * sampler resolves by name.
 */
const probeDef = () => defineComponent('MotionProbeA', { x: 0 });

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        getCppRegistry: () => null, getWasmModule: () => null,
        resolveGetter: () => null, resolveSetter: () => null,
        isEntityActive: () => true,
        insert(e: number, c: unknown, data: unknown) { mapOf(c).set(e, data); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        remove(e: number, c: unknown) { mapOf(c).delete(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, data: unknown) { mapOf(c).set(e, data); },
        tryGet(e: number, c: unknown) { return mapOf(c).get(e) ?? null; },
        update(e: number, c: unknown, edit: (draft: any) => void) {
            const draft = mapOf(c).get(e);
            if (draft === undefined) throw new Error('update: entity does not carry it');
            edit(draft);
            mapOf(c).set(e, draft);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter((e) => rest.every((c) => mapOf(c).has(e)));
        },
    } as any;
}

const spriteData = (): SpriteAnimatorData => ({
    clip: '', currentFrame: 0, frameTimer: 0, speed: 1,
    loop: true, playing: false, finished: false, enabled: true,
} as SpriteAnimatorData);

/** A clip holding `MotionProbeA.x` at a constant, so which clip is playing can
 *  be read straight off the entity. */
function holdAt(value: number, duration = 1, wrapMode: WrapMode = WrapMode.Loop): TimelineAsset {
    return {
        version: '1.2', type: 'timeline', duration, wrapMode,
        tracks: [{
            type: TrackType.Property, component: 'MotionProbeA', childPath: '',
            name: 'probe', channels: [{
                property: 'x',
                keyframes: [{
                    time: 0, value, inTangent: 0, outTangent: 0,
                    interpolation: InterpType.Linear,
                }],
            }],
        }],
    } as TimelineAsset;
}

/**
 * ONE graph, built over whatever motion the caller names for a state. The state
 * machine below is written once; both runs in this file use it verbatim, so a
 * behavioural difference between them can only come from the motions.
 */
function locomotionGraph(motionFor: (state: string) => AnimatorMotion): AnimatorControllerDef {
    return {
        parameters: [{ name: 'speed', type: 'float', default: 0 }],
        initialState: 'Idle',
        states: [
            {
                name: 'Idle',
                motion: motionFor('idle'),
                transitions: [{ to: 'Run', conditions: [{ param: 'speed', op: 'gt', value: 0 }] }],
            },
            {
                name: 'Run',
                motion: motionFor('run'),
                transitions: [{ to: 'Idle', conditions: [{ param: 'speed', op: 'lt', value: 0.1 }] }],
            },
        ],
    };
}

describe('controller-driven sprite playback', () => {
    function setup(authored: boolean) {
        const world = new World();
        connectFakeCpp(world);
        const actor = world.spawn();
        const graph = new AnimatorControllerAPI();
        const sprites = new SpriteAnimationAPI();
        sprites.registerClip({
            name: 'logo', fps: 4, loop: false, frames: [{ texture: 11 }, { texture: 22 }],
            events: [{ frame: 0, name: 'first' }, { frame: 1, name: 'last' }],
        });
        graph.registerController('intro', {
            initialState: 'Repeat', parameters: [{ name: 'next', type: 'trigger' }], states: [
                { name: 'Repeat', motion: { kind: 'sprite', clip: 'logo', loop: true, speed: 2 },
                    transitions: [{ to: 'Once', conditions: [{ param: 'next', op: 'trigger' }] },
                        { to: 'Done', hasExitTime: true, conditions: [] }] },
                { name: 'Once', motion: { kind: 'sprite', clip: 'logo' },
                    transitions: [{ to: 'Done', hasExitTime: true, conditions: [] }] },
                { name: 'Done', transitions: [] },
            ],
        });
        world.insert(actor, Animator, { controller: 'intro' });
        world.insert(actor, Sprite, {});
        if (authored) world.insert(actor, SpriteAnimator, { clip: 'logo', finished: true, playing: false });
        const events: string[] = [];
        sprites.onEvent(actor, event => events.push(event.name));
        const tick = (dt: number) => { graph.update(world, dt); sprites.update(world, dt); };
        return { world, actor, graph, sprites, events, tick };
    }

    it.each([false, true])('pauses, resumes and re-enters the same clip with an authored player = %s', authored => {
        const { world, actor, graph, events, tick } = setup(authored);
        tick(1 / 16);
        expect(world.get(actor, Animator).currentState).toBe('Repeat');
        expect(events).toEqual(['first']);
        world.update(actor, Animator, state => { state.enabled = false; });
        tick(1);
        expect(events).toEqual(['first']);
        world.update(actor, Animator, state => { state.enabled = true; });
        tick(1 / 16);
        expect(world.get(actor, Sprite).texture).toBe(22);
        tick(1 / 8);
        expect(events).toEqual(['first', 'last', 'first']);
        expect(world.get(actor, Animator).currentState).toBe('Repeat');

        graph.setTrigger(actor, 'next');
        tick(0);
        expect(events).toEqual(['first', 'last', 'first', 'first']);
        tick(1 / 4);
        tick(1 / 4);
        tick(0);
        expect(world.get(actor, Animator).currentState).toBe('Done');
        expect(events).toEqual(['first', 'last', 'first', 'first', 'last']);
        expect(world.get(actor, Sprite).texture).toBe(22);
    });

    it.each([false, true])('keeps the top sprite layer advancing with an authored player = %s', authored => {
        const { world, actor, graph, sprites, events, tick } = setup(authored);
        sprites.registerClip({ name: 'base', fps: 4, loop: true, frames: [{ texture: 33 }],
            events: [{ frame: 0, name: 'base' }] });
        graph.registerController('intro', {
            initialState: 'Base', parameters: [],
            states: [{ name: 'Base', clip: 'base', transitions: [] }],
            layers: [{ name: 'Overlay', initialState: 'Logo', states: [
                { name: 'Logo', clip: 'logo', transitions: [{ to: 'Hold', conditions: [], hasExitTime: true }] },
                { name: 'Hold', transitions: [] },
            ] }],
        });
        tick(0);
        tick(1 / 4);
        expect(world.get(actor, Sprite).texture).toBe(22);
        expect(events).toEqual(['first', 'last']);
        tick(1 / 4);
        tick(0);
        expect(world.get(actor, Animator).layerStates).toEqual(['Hold']);
        expect(world.get(actor, Sprite).texture).toBe(33);
        expect(events).toEqual(['first', 'last', 'base']);
    });

    it('drops an implicit playhead when a frame event removes its controller', () => {
        const { world, actor, sprites, events, tick } = setup(false);
        sprites.onEvent(actor, () => world.remove(actor, Animator));
        tick(1 / 8);
        expect(events).toEqual(['first']);
        expect(world.get(actor, Sprite).texture).toBe(0);
        tick(1);
        expect(events).toEqual(['first']);
        expect(world.has(actor, SpriteAnimator)).toBe(false);
    });
});

const spriteMotionFor = (name: string): AnimatorMotion => ({ kind: 'sprite', clip: name });
const timelineMotionFor = (name: string): AnimatorMotion =>
    ({ kind: TIMELINE_MOTION, clip: `${name}.estimeline` });

/** Idle holds x at 1, Run at 2 - so the entity says which state is playing. */
function timelineController(): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    timeline.registerAsset('idle.estimeline', holdAt(1));
    timeline.registerAsset('run.estimeline', holdAt(2));
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    return ctrl;
}

function seed(world: any, controller: string): void {
    world.insert(E, Animator, { controller, currentState: '', enabled: true } as AnimatorData);
}

const probeX = (world: any): number => (world.get(E, probeDef()) as { x: number }).x;
const stateOf = (world: any): string => (world.get(E, Animator) as AnimatorData).currentState;

describe('one graph, either kind of motion', () => {
    it('runs the same state machine over sprite clips', () => {
        const world = makeWorld();
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerController('loco', locomotionGraph(spriteMotionFor));
        seed(world, 'loco');
        world.insert(E, SpriteAnimator, spriteData());

        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Idle');
        expect((world.get(E, SpriteAnimator) as SpriteAnimatorData).clip).toBe('idle');

        ctrl.setFloat(E, 'speed', 5);
        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Run');
        expect((world.get(E, SpriteAnimator) as SpriteAnimatorData).clip).toBe('run');
    });

    it('runs that same state machine over timelines', () => {
        const world = makeWorld();
        const ctrl = timelineController();
        ctrl.registerController('loco', locomotionGraph(timelineMotionFor));
        seed(world, 'loco');
        world.insert(E, probeDef(), { x: 0 });

        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Idle');
        expect(probeX(world)).toBe(1);

        ctrl.setFloat(E, 'speed', 5);
        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Run');
        expect(probeX(world)).toBe(2);
    });

    it('takes the same path through the graph, and drives its motion, either way', () => {
        const run = (
            motionFor: (s: string) => AnimatorMotion,
            ctrl: AnimatorControllerAPI,
            component: unknown, initial: () => unknown,
            targetOf: (data: any) => string | number,
        ): { states: string[]; targets: (string | number)[] } => {
            const world = makeWorld();
            ctrl.registerController('loco', locomotionGraph(motionFor));
            seed(world, 'loco');
            world.insert(E, component, initial());

            const states: string[] = [];
            const targets: (string | number)[] = [];
            for (const speed of [0, 0, 3, 3, 0]) {
                ctrl.setFloat(E, 'speed', speed);
                ctrl.update(world, 0.016);
                states.push(stateOf(world));
                targets.push(targetOf(world.get(E, component)));
            }
            return { states, targets };
        };

        const sprite = run(spriteMotionFor, new AnimatorControllerAPI(), SpriteAnimator,
                           spriteData, (d: SpriteAnimatorData) => d.clip);
        const timeline = run(timelineMotionFor, timelineController(), probeDef(),
                             () => ({ x: 0 }), (d: { x: number }) => d.x);

        // Same graph, same walk through it.
        expect(sprite.states).toEqual(['Idle', 'Idle', 'Run', 'Run', 'Idle']);
        expect(timeline.states).toEqual(sprite.states);
        // And each kind was actually driven - a graph that walks correctly while
        // playing nothing would otherwise satisfy the comparison above.
        expect(sprite.targets).toEqual(['idle', 'idle', 'run', 'run', 'idle']);
        expect(timeline.targets).toEqual([1, 1, 2, 2, 1]);
    });
});

describe('exit time is the motion’s answer, whatever kind it is', () => {
    const oneShot = (motion: AnimatorMotion): AnimatorControllerDef => ({
        parameters: [],
        initialState: 'Attack',
        states: [
            { name: 'Attack', motion, transitions: [{ to: 'Idle', conditions: [], hasExitTime: true }] },
            { name: 'Idle', motion, transitions: [] },
        ],
    });

    const timelineCtrl = (clip: string, asset: TimelineAsset): AnimatorControllerAPI => {
        const timeline = new TimelineAPI();
        timeline.registerAsset(clip, asset);
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        return ctrl;
    };

    it('waits for a sprite clip to complete', () => {
        const world = makeWorld();
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerController('atk', oneShot({ kind: 'sprite', clip: 'attack', loop: false }));
        seed(world, 'atk');
        world.insert(E, SpriteAnimator, spriteData());

        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Attack');

        // Still playing: the exit-time transition must not fire.
        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Attack');

        world.update(E, SpriteAnimator, (sp: SpriteAnimatorData) => { sp.playing = false; sp.finished = true; });
        ctrl.update(world, 0.016);
        expect(stateOf(world)).toBe('Idle');
    });

    it('keeps a paused sprite in its state until resumed playback actually completes', () => {
        const world = makeWorld();const ctrl = new AnimatorControllerAPI();const sprites = new SpriteAnimationAPI();
        sprites.registerClip({ name: 'attack', fps: 10, loop: false, frames: [{ texture: 1 }, { texture: 2 }] });
        ctrl.registerController('atk', oneShot({ kind: 'sprite', clip: 'attack', loop: false }));
        seed(world, 'atk');world.insert(E, SpriteAnimator, spriteData());
        ctrl.update(world, 0);sprites.update(world, 0.05);
        const sp = world.get(E, SpriteAnimator) as SpriteAnimatorData;
        expect(sp.currentFrame).toBe(0);expect(sp.frameTimer).toBeCloseTo(0.05);
        world.update(E, SpriteAnimator, (draft: SpriteAnimatorData) => { draft.playing = false; });
        for (let i = 0; i < 5; i++) { sprites.update(world, 0.5);ctrl.update(world, 0.5); }
        expect(stateOf(world)).toBe('Attack');expect(sp.finished).toBe(false);
        expect(sp.frameTimer).toBeCloseTo(0.05);
        world.update(E, SpriteAnimator, (draft: SpriteAnimatorData) => { draft.playing = true; });
        sprites.update(world, 0.1);ctrl.update(world, 0.1);
        expect(stateOf(world)).toBe('Attack');expect(sp.currentFrame).toBe(1);
        sprites.update(world, 0.06);
        expect(sp.finished).toBe(true);expect(sp.playing).toBe(false);
        ctrl.update(world, 0.06);expect(stateOf(world)).toBe('Idle');
    });

    it('waits out a non-looping timeline on the animator’s own clock', () => {
        const world = makeWorld();
        const ctrl = timelineCtrl('attack.estimeline', holdAt(1, 0.5, WrapMode.Once));
        ctrl.registerController('atk', oneShot({ kind: TIMELINE_MOTION, clip: 'attack.estimeline' }));
        seed(world, 'atk');
        world.insert(E, probeDef(), { x: 0 });

        ctrl.update(world, 0.1);
        expect(stateOf(world)).toBe('Attack');
        ctrl.update(world, 0.1);
        expect(stateOf(world)).toBe('Attack');

        // Past its half second the clip is over, and the transition may fire.
        ctrl.update(world, 0.4);
        expect(stateOf(world)).toBe('Idle');
    });

    it('never ends a looping timeline', () => {
        const world = makeWorld();
        const ctrl = timelineCtrl('run.estimeline', holdAt(1, 0.5, WrapMode.Loop));
        ctrl.registerController('atk', oneShot({ kind: TIMELINE_MOTION, clip: 'run.estimeline' }));
        seed(world, 'atk');
        world.insert(E, probeDef(), { x: 0 });

        for (let i = 0; i < 20; i++) ctrl.update(world, 0.1);
        expect(stateOf(world)).toBe('Attack');
    });
});

describe('a blend is a motion, so it composes with any kind', () => {
    it('selects among timeline motions by a parameter', () => {
        const world = makeWorld();
        const timeline = new TimelineAPI();
        timeline.registerAsset('walk.estimeline', holdAt(10));
        timeline.registerAsset('run.estimeline', holdAt(20));
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.registerController('loco', {
            parameters: [{ name: 'speed', type: 'float', default: 0 }],
            initialState: 'Move',
            states: [{
                name: 'Move',
                motion: {
                    kind: 'blend1d',
                    parameter: 'speed',
                    thresholds: [
                        { value: 0, motion: { kind: TIMELINE_MOTION, clip: 'walk.estimeline' } },
                        { value: 5, motion: { kind: TIMELINE_MOTION, clip: 'run.estimeline' } },
                    ],
                },
                transitions: [],
            }],
        });
        seed(world, 'loco');
        world.insert(E, probeDef(), { x: 0 });

        ctrl.update(world, 0.016);
        expect(probeX(world)).toBe(10);

        // Crossing a threshold re-aims the motion without any state change.
        ctrl.setFloat(E, 'speed', 7);
        ctrl.update(world, 0.016);
        expect(probeX(world)).toBe(20);
        expect(stateOf(world)).toBe('Move');
    });
});

describe('graphs authored before motions existed', () => {
    it('reads a sprite clip field as a sprite motion', () => {
        const st: AnimatorState = { name: 'Idle', clip: 'idle', speed: 2, loop: false, transitions: [] };
        expect(motionOf(st)).toEqual({ kind: 'sprite', clip: 'idle', speed: 2, loop: false });
    });

    it('reads a spine field as a spine motion', () => {
        const st: AnimatorState = { name: 'Run', spine: { animation: 'run', loop: true }, transitions: [] };
        expect(motionOf(st)).toEqual({ kind: 'spine', clip: 'run', loop: true });
    });

    it('reads a legacy blend as a blend over sprite motions, keeping stop overrides', () => {
        const st: AnimatorState = {
            name: 'Move', speed: 3, loop: true,
            blend: {
                parameter: 'speed',
                thresholds: [
                    { value: 0, clip: 'walk' },
                    { value: 5, clip: 'run', speed: 9, loop: false },
                ],
            },
            transitions: [],
        };
        expect(motionOf(st)).toEqual({
            kind: 'blend1d',
            parameter: 'speed',
            thresholds: [
                { value: 0, motion: { kind: 'sprite', clip: 'walk', speed: 3, loop: true } },
                { value: 5, motion: { kind: 'sprite', clip: 'run', speed: 9, loop: false } },
            ],
        });
    });

    it('has no motion for a container state', () => {
        expect(motionOf({ name: 'Combat', stateMachine: { states: [], initialState: '' }, transitions: [] }))
            .toBeNull();
    });
});

describe('a kind this build cannot play', () => {
    it('is inert rather than an error', () => {
        const world = makeWorld();
        const ctrl = new AnimatorControllerAPI();   // no timeline driver registered
        ctrl.registerController('loco', locomotionGraph(timelineMotionFor));
        seed(world, 'loco');
        world.insert(E, probeDef(), { x: 0 });

        expect(() => ctrl.update(world, 0.016)).not.toThrow();
        expect(probeX(world)).toBe(0);
        expect(ctrl.hasMotionDriver(TIMELINE_MOTION)).toBe(false);
    });
});
