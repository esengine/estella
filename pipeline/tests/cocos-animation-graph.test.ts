// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos animation graph as the engine's animator controller: states, transitions, conditions and blends map one to one, and what the
 *        Animator cannot state is counted.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { convertAnimationGraph } from '../src/import/cocos/animationGraph';

/** A graph: attack/move/idle on one layer, driven by a trigger, a number and a flag. Ids are positions in the list. */
function graph(over: { motionSpeedFollows?: boolean; inclusive?: boolean } = {}): unknown[] {
    const o: unknown[] = [];
    const add = (x: unknown): { __id__: number } => { o.push(x); return { __id__: o.length - 1 }; };
    const root: Record<string, unknown> = { __type__: 'cc.animation.AnimationGraph', _layers: [], _variables: {} };
    add(root);
    const layer: Record<string, unknown> = { __type__: 'cc.animation.Layer', name: '', weight: 1, mask: null };
    root._layers = [add(layer)];
    const machine: Record<string, unknown> = { __type__: 'cc.animation.StateMachine', _states: [], _transitions: [] };
    layer._stateMachine = add(machine);
    const entry = add({ __type__: 'cc.animation.State', name: 'Entry' });
    const exit = add({ __type__: 'cc.animation.State', name: 'Exit' });
    const any = add({ __type__: 'cc.animation.State', name: 'Any State' });
    const clip = (uuid: string) => add({ __type__: 'cc.animation.ClipMotion', clip: { __uuid__: uuid } });
    const idle = add({ __type__: 'cc.animation.Motion', name: 'idle', motion: clip('idle-clip'), speed: 1 });
    const blend = add({
        __type__: 'cc.animation.AnimationBlend1D', name: 'move', param: add({ __type__: 'cc.animation.BindableNumber', variable: 'MoveSpeed', value: 0 }),
        _items: [
            add({ __type__: 'cc.animation.AnimationBlend1DItem', motion: clip('walk-clip'), threshold: 0 }),
            add({ __type__: 'cc.animation.AnimationBlend1DItem', motion: clip('run-clip'), threshold: 1 }),
        ],
    });
    const move = add({ __type__: 'cc.animation.Motion', name: 'move', motion: blend, speed: 2, speedMultiplierEnabled: over.motionSpeedFollows === true, speedMultiplier: 'MoveSpeed' });
    const attack = add({ __type__: 'cc.animation.Motion', name: 'attack', motion: clip('attack-clip'), speed: 1 });
    machine._states = [entry, exit, any, idle, move, attack];
    machine._entryState = entry; machine._exitState = exit; machine._anyState = any;
    root._variables = {
        MoveSpeed: add({ __type__: 'cc.animation.PlainVariable', _type: 0, _value: 0 }),
        Grounded: add({ __type__: 'cc.animation.PlainVariable', _type: 2, _value: true }),
        hit: add({ __type__: 'cc.animation.TriggerVariable', _flags: 0 }),
    };
    const trig = (name: string) => add({ __type__: 'cc.animation.TriggerCondition', trigger: name });
    const flag = (name: string, operator: number) => add({ __type__: 'cc.animation.UnaryCondition', operator, operand: add({ __type__: 'cc.animation.BindableBoolean', variable: name, value: false }) });
    const faster = add({
        __type__: 'cc.animation.BinaryCondition', operator: over.inclusive ? 5 : 4,
        lhs: add({ __type__: 'cc.animation.BindableNumber', variable: 'MoveSpeed', value: 0 }), rhs: add({ __type__: 'cc.animation.BindableNumber', variable: '', value: 0.5 }),
    });
    machine._transitions = [
        add({ __type__: 'cc.animation.Transition', from: entry, to: idle, conditions: [] }),
        add({ __type__: 'cc.animation.AnimationTransition', from: idle, to: move, conditions: [faster, flag('Grounded', 0)], duration: 0.2, exitConditionEnabled: false }),
        add({ __type__: 'cc.animation.AnimationTransition', from: any, to: attack, conditions: [trig('hit')], duration: 0 }),
        add({ __type__: 'cc.animation.AnimationTransition', from: attack, to: idle, conditions: [], duration: 0.1, exitConditionEnabled: true }),
        add({ __type__: 'cc.animation.AnimationTransition', from: move, to: exit, conditions: [] }),
    ];
    return o;
}

const convert = (objects: unknown[]) => {
    const notes: string[] = [];
    const result = convertAnimationGraph(objects, { clip: (uuid) => (uuid === 'run-clip' ? null : `clips/${uuid}.estimeline`), note: (c) => notes.push(c) });
    return { ...result, notes, doc: result.document as any };
};

describe('a Cocos animation graph', () => {
    it('keeps its parameters: numbers, flags and triggers', () => {
        const { doc } = convert(graph());
        expect(doc.parameters).toEqual([
            { name: 'MoveSpeed', type: 'float', default: 0 }, { name: 'Grounded', type: 'bool', default: true }, { name: 'hit', type: 'trigger' },
        ]);
    });

    it('starts where the entry state leads and names the states it plays', () => {
        const { doc } = convert(graph());
        expect(doc.initialState).toBe('idle');
        expect(doc.states.map((s: any) => s.name)).toEqual(['idle', 'move', 'attack']);
        expect(doc.states[0].motion).toEqual({ kind: 'timeline', clip: 'clips/idle-clip.estimeline' });
        expect(doc.states[1].speed).toBe(2);
    });

    it('turns a 1D blend into a blend over its clips, and drops a clip the node has no bones for', () => {
        const { doc, notes } = convert(graph());
        const blend = doc.states[1].motion;
        expect(blend.kind).toBe('blend1d');
        expect(blend.parameter).toBe('MoveSpeed');
        expect(blend.thresholds).toEqual([{ value: 0, motion: { kind: 'timeline', clip: 'clips/walk-clip.estimeline' } }]);
        expect(notes).toContain('graph-clip-not-found');
    });

    it('carries transitions with their conditions, blend time and wait for the clip to end', () => {
        const { doc } = convert(graph());
        expect(doc.states[0].transitions).toEqual([{
            to: 'move', duration: 0.2,
            conditions: [{ param: 'MoveSpeed', op: 'gt', value: 0.5 }, { param: 'Grounded', op: 'true' }],
        }]);
        expect(doc.states[2].transitions).toEqual([{ to: 'idle', duration: 0.1, hasExitTime: true, conditions: [] }]);
    });

    it('puts what leaves the any-state in the any-state transitions, and says what leaves for the exit state', () => {
        const { doc, notes } = convert(graph());
        expect(doc.anyStateTransitions).toEqual([{ to: 'attack', conditions: [{ param: 'hit', op: 'trigger' }] }]);
        expect(notes).toContain('graph-transition-to-exit');
    });

    it('makes a state\'s speed follow the variable Cocos names, and counts one it cannot find', () => {
        const { doc, notes } = convert(graph({ motionSpeedFollows: true }));
        expect(doc.states[1].speedParameter).toBe('MoveSpeed');
        expect(notes).not.toContain('graph-speed-variable-missing');
        expect(convert(graph()).doc.states[1].speedParameter).toBeUndefined();
    });

    it('counts a comparison the Animator has only in strict form', () => {
        expect(convert(graph({ inclusive: true })).notes).toContain('graph-condition-inclusive');
    });

    it('is a controller the engine accepts', async () => {
        const { migrateAnimatorController } = await import(/* @vite-ignore */ path.resolve(__dirname, '../../sdk/src/animation/animatorMigrate.ts'));
        const migrated = migrateAnimatorController(convert(graph()).document);
        expect(migrated.def.states.map((s: any) => s.name)).toEqual(['idle', 'move', 'attack']);
        expect(migrated.def.initialState).toBe('idle');
    });
});
