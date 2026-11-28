// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    Animator,
    AnimatorControllerAPI,
    evaluateAnimatorPath,
    evaluateAnimatorTransitions,
    enterStatePath,
    leafStateOf,
    type AnimatorControllerDef,
    type AnimatorData,
    type AnimatorTransition,
} from '../src/animation/Animator';
import { SpriteAnimator, type SpriteAnimatorData } from '../src/animation/SpriteAnimator';

// A controller with a nested Combat machine. `Combat` is a container (it carries a
// stateMachine) whose own `transitions` are the edges that exit it; `Dead` is a
// top-level escape reachable from anywhere.
function nestedController(): AnimatorControllerDef {
    return {
        parameters: [
            { name: 'attack', type: 'trigger' },
            { name: 'block', type: 'bool', default: false },
            { name: 'done', type: 'bool', default: false },
            { name: 'dead', type: 'bool', default: false },
        ],
        initialState: 'Locomotion',
        states: [
            { name: 'Locomotion', clip: 'loco', transitions: [
                { to: 'Combat', conditions: [{ param: 'attack', op: 'trigger' }] },
            ] },
            {
                name: 'Combat',
                stateMachine: {
                    initialState: 'Swing',
                    anyStateTransitions: [
                        { to: 'Block', conditions: [{ param: 'block', op: 'true' }] },
                    ],
                    states: [
                        { name: 'Swing', clip: 'swing', loop: false, transitions: [
                            { to: 'Recover', conditions: [], hasExitTime: true },
                        ] },
                        { name: 'Recover', clip: 'recover', transitions: [] },
                        { name: 'Block', clip: 'block', transitions: [] },
                    ],
                },
                // Exit edges (resolved in the top scope).
                transitions: [
                    { to: 'Locomotion', conditions: [{ param: 'done', op: 'true' }] },
                ],
            },
            { name: 'Dead', clip: 'dead', transitions: [] },
        ],
        anyStateTransitions: [
            { to: 'Dead', conditions: [{ param: 'dead', op: 'true' }] },
        ],
    };
}

describe('enterStatePath', () => {
    const def = nestedController();
    it('a leaf state is its own path', () => {
        expect(enterStatePath(def, 'Locomotion')).toEqual(['Locomotion']);
    });
    it('a container descends to its initial sub-state', () => {
        expect(enterStatePath(def, 'Combat')).toEqual(['Combat', 'Swing']);
    });
});

describe('leafStateOf', () => {
    const def = nestedController();
    it('returns the leaf of a nested path', () => {
        expect(leafStateOf(def, 'Combat/Swing')?.name).toBe('Swing');
        expect(leafStateOf(def, 'Combat/Swing')?.clip).toBe('swing');
    });
    it('returns null for an unknown path', () => {
        expect(leafStateOf(def, 'Combat/Nope')).toBeNull();
        expect(leafStateOf(def, 'Ghost')).toBeNull();
    });

    it.each(['Combat', 'Locomotion/Removed', 'Combat/Swing/Removed'])('rejects an incomplete or overlong active path (%s)', path => {
        expect(leafStateOf(def, path)).toBeNull();
        expect(evaluateAnimatorPath(def, path, { dead: true }, new Set()).nextPath).toBeNull();
    });
});

describe('evaluateAnimatorPath', () => {
    const def = nestedController();

    it('skips a ready Any State transition to a missing state without consuming its trigger', () => {
        const stale = { ...def, anyStateTransitions: [{ to: 'Deleted', conditions: [{ param: 'stale', op: 'trigger' as const }] }] };
        const triggers = new Set(['stale', 'attack']);
        expect(evaluateAnimatorPath(stale, 'Locomotion', {}, triggers)).toMatchObject({
            nextPath: 'Combat/Swing', consumedTriggers: ['attack'],
        });
        expect(evaluateAnimatorTransitions(stale, 'Locomotion', {}, triggers)).toEqual({
            next: 'Combat', consumedTriggers: ['attack'],
        });
    });

    it('continues through the same priority list when a destination has no valid nested entry', () => {
        const empty = { name: 'Empty', transitions: [], stateMachine: { states: [], initialState: '' } };
        const stale = {
            ...def, states: [...def.states, empty], anyStateTransitions: [
                { to: 'Empty', conditions: [{ param: 'stale', op: 'trigger' as const }] },
                { to: 'Dead', conditions: [{ param: 'dead', op: 'trigger' as const }], duration: 0.25 },
            ],
        };
        const triggers = new Set(['stale', 'dead']);
        expect(evaluateAnimatorPath(stale, 'Combat/Swing', {}, triggers)).toMatchObject({
            nextPath: 'Dead', consumedTriggers: ['dead'], fadeDuration: 0.25,
        });
        expect(evaluateAnimatorTransitions(stale, 'Combat', {}, triggers)).toEqual({
            next: 'Dead', consumedTriggers: ['dead'],
        });
    });

    it('entering a container descends to its initial sub-state', () => {
        const r = evaluateAnimatorPath(def, 'Locomotion', {}, new Set(['attack']));
        expect(r.nextPath).toBe('Combat/Swing');
        expect(r.consumedTriggers).toEqual(['attack']);
    });

    it('a leaf transition stays within the sub-machine', () => {
        // Swing → Recover on exit time (clipFinished=true).
        const r = evaluateAnimatorPath(def, 'Combat/Swing', {}, new Set(), true);
        expect(r.nextPath).toBe('Combat/Recover');
    });

    it('gates a leaf hasExitTime transition on the leaf clip finishing', () => {
        expect(evaluateAnimatorPath(def, 'Combat/Swing', {}, new Set(), false).nextPath).toBeNull();
    });

    it('a sub-machine any-state transition fires from any sub-state', () => {
        const r = evaluateAnimatorPath(def, 'Combat/Swing', { block: true }, new Set());
        expect(r.nextPath).toBe('Combat/Block');
    });

    it("a container's own transition exits the sub-machine (parent scope)", () => {
        const r = evaluateAnimatorPath(def, 'Combat/Recover', { done: true }, new Set());
        expect(r.nextPath).toBe('Locomotion');
    });

    it('sub-machine any-state outranks the container exit edge', () => {
        // block AND done both hold: Block (sub any-state) is higher priority than
        // the Combat exit edge.
        const r = evaluateAnimatorPath(def, 'Combat/Swing', { block: true, done: true }, new Set(), true);
        expect(r.nextPath).toBe('Combat/Block');
    });

    it('top-level any-state outranks everything nested', () => {
        const r = evaluateAnimatorPath(def, 'Combat/Swing', { block: true, done: true, dead: true }, new Set(), true);
        expect(r.nextPath).toBe('Dead');
    });

    it('walks nested Any State edges from the outside and exits containers from the inside', () => {
        const edge = (to: string, param: string): AnimatorTransition => ({ to, conditions: [{ param, op: 'true' }] });
        const deep: AnimatorControllerDef = {
            parameters: [], initialState: 'Outer', states: [
                { name: 'RootExit', transitions: [] },
                { name: 'Outer', transitions: [edge('RootExit', 'exit')], stateMachine: {
                    initialState: 'Inner', anyStateTransitions: [edge('MiddleExit', 'middle')], states: [
                        { name: 'MiddleExit', transitions: [] },
                        { name: 'Inner', transitions: [edge('MiddleExit', 'exit')], stateMachine: {
                            initialState: 'Hold', anyStateTransitions: [edge('InnerExit', 'deep')], states: [
                                { name: 'Hold', transitions: [edge('LeafExit', 'leaf')] },
                                { name: 'InnerExit', transitions: [] },
                                { name: 'LeafExit', transitions: [] },
                            ],
                        } },
                    ],
                } },
            ],
        };
        const resolve = (params: Record<string, boolean>) => evaluateAnimatorPath(deep, 'Outer/Inner/Hold', params, new Set()).nextPath;
        expect(resolve({ middle: true, deep: true, leaf: true, exit: true })).toBe('Outer/MiddleExit');
        expect(resolve({ deep: true, leaf: true, exit: true })).toBe('Outer/Inner/InnerExit');
        expect(resolve({ leaf: true, exit: true })).toBe('Outer/Inner/LeafExit');
        expect(resolve({ exit: true })).toBe('Outer/MiddleExit');
        expect(resolve({})).toBeNull();
    });

    it('stays put when nothing fires', () => {
        expect(evaluateAnimatorPath(def, 'Combat/Recover', {}, new Set()).nextPath).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Integration: AnimatorControllerAPI.update drives the leaf clip through nesting
// ---------------------------------------------------------------------------

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
        update(e: number, c: unknown, edit: (d: unknown) => void) { edit(mapOf(c).get(e)); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter((e) => rest.every((c) => mapOf(c).has(e)));
        },
    } as any;
}

describe('AnimatorControllerAPI.update — nested machine', () => {
    const E = 1;
    function setup() {
        const ctrl = new AnimatorControllerAPI();
        const def = nestedController();
        ctrl.registerController('hero', def);
        const world = makeWorld();
        world.insert(E, Animator, { controller: 'hero', currentState: '', enabled: true } as AnimatorData);
        world.insert(E, SpriteAnimator, {
            clip: '', speed: 1, playing: false, loop: true, enabled: true, currentFrame: 5, frameTimer: 0.3,
        } as SpriteAnimatorData);
        return { ctrl, def, world };
    }
    const animPath = (world: any) => (world.get(E, Animator) as AnimatorData).currentState;
    const clip = (world: any) => (world.get(E, SpriteAnimator) as SpriteAnimatorData).clip;

    it('seeds the top initial leaf and applies its clip', () => {
        const { ctrl, world } = setup();
        ctrl.update(world);
        expect(animPath(world)).toBe('Locomotion');
        expect(clip(world)).toBe('loco');
    });

    it('enters a sub-machine and plays its initial sub-state clip', () => {
        const { ctrl, world } = setup();
        ctrl.update(world); // Locomotion
        ctrl.setTrigger(E, 'attack');
        ctrl.update(world);
        expect(animPath(world)).toBe('Combat/Swing');
        expect(clip(world)).toBe('swing');
    });

    it('repairs a stale nested path before checking transitions from the initial state', () => {
        const { ctrl, world } = setup();
        world.update(E, Animator, (anim: AnimatorData) => { anim.currentState = 'Combat/Removed'; });
        ctrl.setTrigger(E, 'attack');
        ctrl.update(world);
        expect(animPath(world)).toBe('Combat/Swing');
        expect(clip(world)).toBe('swing');
    });

    it('uses a replaced state definition on the next update without changing its active path', () => {
        const { ctrl, def, world } = setup();
        ctrl.setTrigger(E, 'attack');
        ctrl.update(world);
        expect(animPath(world)).toBe('Combat/Swing');
        const combat = def.states[1]!.stateMachine!;
        combat.states[0] = { ...combat.states[0]!, transitions: [{ to: 'Block', conditions: [] }] };

        ctrl.update(world);
        expect(animPath(world)).toBe('Combat/Block');
        expect(clip(world)).toBe('block');
    });

    it.each(['Combat', 'Locomotion/Removed', 'Combat/Swing/Removed'])('repairs the active path and starts the entry clip (%s)', path => {
        const { ctrl, world } = setup();
        world.update(E, Animator, (anim: AnimatorData) => { anim.currentState = path; });

        ctrl.update(world);
        expect(animPath(world)).toBe('Locomotion');
        expect(clip(world)).toBe('loco');
    });

    it('advances within the sub-machine, then exits via the container edge', () => {
        const { ctrl, world } = setup();
        ctrl.update(world);
        ctrl.setTrigger(E, 'attack');
        ctrl.update(world); // → Combat/Swing (swing clip applied, loop:false)
        // Simulate the swing clip finishing so its exit-time edge can fire.
        world.update(E, SpriteAnimator, (sp: SpriteAnimatorData) => { sp.playing = false; sp.finished = true; });
        ctrl.update(world);
        expect(animPath(world)).toBe('Combat/Recover');
        expect(clip(world)).toBe('recover');
        // Exit the whole sub-machine back to Locomotion.
        ctrl.setBool(E, 'done', true);
        ctrl.update(world);
        expect(animPath(world)).toBe('Locomotion');
        expect(clip(world)).toBe('loco');
    });
});
