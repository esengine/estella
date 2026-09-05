// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: one graph drives a sprite sheet on one entity and an `.estimeline`
 * on another, the motion each state names being the only difference.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, SpriteAnimator, motionOf,
    type AnimatorData, type AnimatorControllerDef, type AnimatorMotion,
    type AnimatorState, type SpriteAnimatorData,
} from '../src/animation';
import { TimelinePlayer, createTimelineMotionDriver, TIMELINE_MOTION,
         type TimelinePlayerData } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';

const E = 1;

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, data: unknown) { mapOf(c).set(e, data); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
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

const timelineData = (): TimelinePlayerData => ({
    timeline: '', playing: false, speed: 1, wrapMode: '', finished: false,
});

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

const spriteMotionFor = (name: string): AnimatorMotion => ({ kind: 'sprite', clip: name });
const timelineMotionFor = (name: string): AnimatorMotion =>
    ({ kind: TIMELINE_MOTION, clip: `${name}.estimeline` });

/** A controller that can play timelines, as the plugins wire it at runtime. */
function makeController(): AnimatorControllerAPI {
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(new TimelineAPI()));
    return ctrl;
}

function seed(world: any, controller: string): void {
    world.insert(E, Animator, { controller, currentState: '', enabled: true } as AnimatorData);
}

describe('one graph, either kind of motion', () => {
    it('runs the same state machine over sprite clips', () => {
        const world = makeWorld();
        const ctrl = makeController();
        ctrl.registerController('loco', locomotionGraph(spriteMotionFor));
        seed(world, 'loco');
        world.insert(E, SpriteAnimator, spriteData());

        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Idle');
        expect((world.get(E, SpriteAnimator) as SpriteAnimatorData).clip).toBe('idle');

        ctrl.setFloat(E, 'speed', 5);
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Run');
        expect((world.get(E, SpriteAnimator) as SpriteAnimatorData).clip).toBe('run');
    });

    it('runs that same state machine over timelines', () => {
        const world = makeWorld();
        const ctrl = makeController();
        ctrl.registerController('loco', locomotionGraph(timelineMotionFor));
        seed(world, 'loco');
        world.insert(E, TimelinePlayer, timelineData());

        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Idle');
        expect((world.get(E, TimelinePlayer) as TimelinePlayerData).timeline)
            .toBe('idle.estimeline');

        ctrl.setFloat(E, 'speed', 5);
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Run');
        expect((world.get(E, TimelinePlayer) as TimelinePlayerData).timeline)
            .toBe('run.estimeline');
    });

    it('takes the same path through the graph, and drives its motion, either way', () => {
        const run = (
            motionFor: (s: string) => AnimatorMotion,
            component: unknown, initial: () => unknown,
            targetOf: (data: any) => string,
        ): { states: string[]; targets: string[] } => {
            const world = makeWorld();
            const ctrl = makeController();
            ctrl.registerController('loco', locomotionGraph(motionFor));
            seed(world, 'loco');
            world.insert(E, component, initial());

            const states: string[] = [];
            const targets: string[] = [];
            for (const speed of [0, 0, 3, 3, 0]) {
                ctrl.setFloat(E, 'speed', speed);
                ctrl.update(world);
                states.push((world.get(E, Animator) as AnimatorData).currentState);
                targets.push(targetOf(world.get(E, component)));
            }
            return { states, targets };
        };

        const sprite = run(spriteMotionFor, SpriteAnimator, spriteData,
                           (d: SpriteAnimatorData) => d.clip);
        const timeline = run(timelineMotionFor, TimelinePlayer, timelineData,
                             (d: TimelinePlayerData) => d.timeline);

        // Same graph, same walk through it.
        expect(sprite.states).toEqual(['Idle', 'Idle', 'Run', 'Run', 'Idle']);
        expect(timeline.states).toEqual(sprite.states);
        // And each kind was actually driven — a graph that walks correctly while
        // playing nothing would otherwise satisfy the comparison above.
        expect(sprite.targets).toEqual(['idle', 'idle', 'run', 'run', 'idle']);
        expect(timeline.targets).toEqual([
            'idle.estimeline', 'idle.estimeline',
            'run.estimeline', 'run.estimeline', 'idle.estimeline',
        ]);
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

    it('waits for a sprite clip to stop', () => {
        const world = makeWorld();
        const ctrl = makeController();
        ctrl.registerController('atk', oneShot({ kind: 'sprite', clip: 'attack', loop: false }));
        seed(world, 'atk');
        world.insert(E, SpriteAnimator, spriteData());

        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Attack');

        // Still playing: the exit-time transition must not fire.
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Attack');

        world.update(E, SpriteAnimator, (sp: SpriteAnimatorData) => { sp.playing = false; });
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Idle');
    });

    it('waits for a timeline to latch finished', () => {
        const world = makeWorld();
        const ctrl = makeController();
        ctrl.registerController('atk', oneShot({ kind: TIMELINE_MOTION, clip: 'attack.estimeline', loop: false }));
        seed(world, 'atk');
        world.insert(E, TimelinePlayer, timelineData());

        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Attack');

        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Attack');

        world.update(E, TimelinePlayer, (p: TimelinePlayerData) => { p.finished = true; });
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Idle');
    });
});

describe('a blend is a motion, so it composes with any kind', () => {
    it('selects among timeline motions by a parameter', () => {
        const world = makeWorld();
        const ctrl = makeController();
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
        world.insert(E, TimelinePlayer, timelineData());

        ctrl.update(world);
        expect((world.get(E, TimelinePlayer) as TimelinePlayerData).timeline).toBe('walk.estimeline');

        // Crossing a threshold re-aims the motion without any state change.
        ctrl.setFloat(E, 'speed', 7);
        ctrl.update(world);
        expect((world.get(E, TimelinePlayer) as TimelinePlayerData).timeline).toBe('run.estimeline');
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('Move');
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
        world.insert(E, TimelinePlayer, timelineData());

        expect(() => ctrl.update(world)).not.toThrow();
        expect((world.get(E, TimelinePlayer) as TimelinePlayerData).timeline).toBe('');
        expect(ctrl.hasMotionDriver(TIMELINE_MOTION)).toBe(false);
    });
});
