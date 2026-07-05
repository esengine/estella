// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    Blackboard,
    evalGuard,
    AiRegistry,
    compileFsm,
    createFsmRunState,
    stepFsm,
    type FsmDefinition,
} from '../src/ai/fsm';

describe('Blackboard', () => {
    it('stores and reads typed values', () => {
        const bb = new Blackboard();
        expect(bb.has('hp')).toBe(false);
        bb.set('hp', 50);
        expect(bb.get<number>('hp')).toBe(50);
        expect(bb.has('hp')).toBe(true);
        bb.delete('hp');
        expect(bb.has('hp')).toBe(false);
    });

    it('fires and consumes one-shot triggers', () => {
        const bb = new Blackboard();
        expect(bb.isFired('go')).toBe(false);
        bb.fire('go');
        expect(bb.isFired('go')).toBe(true);
        bb.consume('go');
        expect(bb.isFired('go')).toBe(false);
    });
});

describe('evalGuard', () => {
    const bb = new Blackboard();
    bb.set('hp', 30);
    bb.set('name', 'orc');
    bb.set('alerted', true);

    it('compares numbers and equality', () => {
        expect(evalGuard(bb, { key: 'hp', op: '<', value: 50 })).toBe(true);
        expect(evalGuard(bb, { key: 'hp', op: '>=', value: 30 })).toBe(true);
        expect(evalGuard(bb, { key: 'hp', op: '>', value: 30 })).toBe(false);
        expect(evalGuard(bb, { key: 'name', op: '==', value: 'orc' })).toBe(true);
        expect(evalGuard(bb, { key: 'name', op: '!=', value: 'elf' })).toBe(true);
    });

    it('handles truthy/falsy and missing keys', () => {
        expect(evalGuard(bb, { key: 'alerted', op: 'truthy' })).toBe(true);
        expect(evalGuard(bb, { key: 'missing', op: 'falsy' })).toBe(true);
        expect(evalGuard(bb, { key: 'missing', op: 'truthy' })).toBe(false);
    });
});

/** A registry whose actions append their name to `log` for sequence assertions. */
function loggingRegistry(log: string[]): AiRegistry<unknown> {
    const reg = new AiRegistry<unknown>();
    for (const name of ['patrolMove', 'startChase', 'chaseMove', 'attack']) {
        reg.registerAction(name, () => log.push(name));
    }
    return reg;
}

const patrolChase: FsmDefinition = {
    initial: 'Patrol',
    states: [
        {
            name: 'Patrol',
            onUpdate: 'patrolMove',
            transitions: [{ to: 'Chase', guard: { key: 'seesPlayer', op: 'truthy' } }],
        },
        {
            name: 'Chase',
            onEnter: 'startChase',
            onUpdate: 'chaseMove',
            transitions: [{ to: 'Patrol', guard: { key: 'seesPlayer', op: 'falsy' } }],
        },
    ],
};

describe('stepFsm', () => {
    it('runs onEnter once, onUpdate each idle tick', () => {
        const log: string[] = [];
        const reg = loggingRegistry(log);
        const fsm = compileFsm({
            initial: 'A',
            states: [{ name: 'A', onEnter: 'startChase', onUpdate: 'patrolMove' }],
        });
        const run = createFsmRunState(fsm);
        const bb = new Blackboard();
        stepFsm(fsm, run, {}, bb, reg);
        stepFsm(fsm, run, {}, bb, reg);
        // onEnter once, onUpdate twice.
        expect(log).toEqual(['startChase', 'patrolMove', 'patrolMove']);
    });

    it('drives a full patrol → chase → patrol cycle via the blackboard', () => {
        const log: string[] = [];
        const reg = loggingRegistry(log);
        const fsm = compileFsm(patrolChase);
        const run = createFsmRunState(fsm);
        const bb = new Blackboard();

        stepFsm(fsm, run, {}, bb, reg); // Patrol: onUpdate
        expect(run.current).toBe('Patrol');
        expect(log).toEqual(['patrolMove']);

        bb.set('seesPlayer', true);
        const t1 = stepFsm(fsm, run, {}, bb, reg); // transition → Chase
        expect(t1).toBe(true);
        expect(run.current).toBe('Chase');
        expect(run.previous).toBe('Patrol');

        stepFsm(fsm, run, {}, bb, reg); // Chase: onEnter + onUpdate
        expect(log).toEqual(['patrolMove', 'startChase', 'chaseMove']);

        bb.set('seesPlayer', false);
        const t2 = stepFsm(fsm, run, {}, bb, reg); // transition → Patrol
        expect(t2).toBe(true);
        expect(run.current).toBe('Patrol');
        expect(run.previous).toBe('Chase');
    });

    it('takes a trigger-based transition and consumes the event', () => {
        const reg = new AiRegistry<unknown>();
        const fsm = compileFsm({
            initial: 'Idle',
            states: [
                { name: 'Idle', transitions: [{ to: 'Go', trigger: 'start' }] },
                { name: 'Go' },
            ],
        });
        const run = createFsmRunState(fsm);
        const bb = new Blackboard();

        expect(stepFsm(fsm, run, {}, bb, reg)).toBe(false); // no trigger yet
        bb.fire('start');
        expect(stepFsm(fsm, run, {}, bb, reg)).toBe(true);
        expect(run.current).toBe('Go');
        expect(bb.isFired('start')).toBe(false); // consumed
    });

    it('evaluates named registry conditions, ANDed with guards', () => {
        const reg = new AiRegistry<{ inRange: boolean }>();
        reg.registerCondition('inRange', ctx => ctx.inRange);
        const fsm = compileFsm({
            initial: 'Approach',
            states: [
                {
                    name: 'Approach',
                    transitions: [{
                        to: 'Attack',
                        condition: 'inRange',
                        guard: { key: 'hp', op: '>', value: 0 },
                    }],
                },
                { name: 'Attack' },
            ],
        });
        const run = createFsmRunState(fsm);
        const bb = new Blackboard();
        bb.set('hp', 10);

        // condition false → no transition even though guard passes.
        expect(stepFsm(fsm, run, { inRange: false }, bb, reg)).toBe(false);
        // condition true + guard true → transition.
        expect(stepFsm(fsm, run, { inRange: true }, bb, reg)).toBe(true);
        expect(run.current).toBe('Attack');
    });

    it('takes the first enabled transition in order', () => {
        const reg = new AiRegistry<unknown>();
        const fsm = compileFsm({
            initial: 'S',
            states: [
                {
                    name: 'S',
                    transitions: [
                        { to: 'A', guard: { key: 'x', op: '==', value: 1 } },
                        { to: 'B', guard: { key: 'x', op: '==', value: 2 } },
                    ],
                },
                { name: 'A' }, { name: 'B' },
            ],
        });
        const run = createFsmRunState(fsm);
        const bb = new Blackboard();
        bb.set('x', 2);
        stepFsm(fsm, run, {}, bb, reg);
        expect(run.current).toBe('B');
    });
});
