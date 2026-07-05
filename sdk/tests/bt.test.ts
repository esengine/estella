// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { AiRegistry } from '../src/ai/fsm/registry';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { Status } from '../src/ai/status';
import { tickBt, createBtRunState, type BtRunState } from '../src/ai/bt/BtRunner';
import type { BtDefinition } from '../src/ai/bt/types';

describe('tickBt', () => {
    let reg: AiRegistry<unknown>;
    let bb: Blackboard;
    let rs: BtRunState;

    beforeEach(() => {
        reg = new AiRegistry<unknown>();
        bb = new Blackboard();
        rs = createBtRunState();
        reg.registerAction('ok', () => Status.Success);
        reg.registerAction('fail', () => Status.Failure);
        reg.registerAction('run', () => Status.Running);
        reg.registerAction('void', () => { /* one-shot */ });
        reg.registerCondition('yes', () => true);
        reg.registerCondition('no', () => false);
    });

    const tick = (def: BtDefinition, dt = 0.1) => tickBt(def, {}, bb, reg, rs, dt);

    it('treats a void action as Success and passes Status through', () => {
        expect(tick({ root: { type: 'action', name: 'void' } })).toBe(Status.Success);
        expect(tick({ root: { type: 'action', name: 'run' } })).toBe(Status.Running);
        expect(tick({ root: { type: 'action', name: 'fail' } })).toBe(Status.Failure);
        expect(tick({ root: { type: 'action', name: 'missing' } })).toBe(Status.Failure);
    });

    it('maps conditions to Success/Failure', () => {
        expect(tick({ root: { type: 'condition', name: 'yes' } })).toBe(Status.Success);
        expect(tick({ root: { type: 'condition', name: 'no' } })).toBe(Status.Failure);
    });

    it('sequence: all-success succeeds, first failure fails, running propagates', () => {
        expect(tick({ root: { type: 'sequence', children: [{ type: 'action', name: 'ok' }, { type: 'action', name: 'ok' }] } })).toBe(Status.Success);
        expect(tick({ root: { type: 'sequence', children: [{ type: 'action', name: 'ok' }, { type: 'action', name: 'fail' }] } })).toBe(Status.Failure);
        expect(tick({ root: { type: 'sequence', children: [{ type: 'action', name: 'ok' }, { type: 'action', name: 'run' }] } })).toBe(Status.Running);
    });

    it('selector: first success succeeds, all-failure fails, running propagates', () => {
        expect(tick({ root: { type: 'selector', children: [{ type: 'action', name: 'fail' }, { type: 'action', name: 'ok' }] } })).toBe(Status.Success);
        expect(tick({ root: { type: 'selector', children: [{ type: 'action', name: 'fail' }, { type: 'action', name: 'fail' }] } })).toBe(Status.Failure);
        expect(tick({ root: { type: 'selector', children: [{ type: 'action', name: 'fail' }, { type: 'action', name: 'run' }] } })).toBe(Status.Running);
    });

    it('inverter flips Success/Failure but not Running', () => {
        expect(tick({ root: { type: 'inverter', children: [{ type: 'action', name: 'ok' }] } })).toBe(Status.Failure);
        expect(tick({ root: { type: 'inverter', children: [{ type: 'action', name: 'fail' }] } })).toBe(Status.Success);
        expect(tick({ root: { type: 'inverter', children: [{ type: 'action', name: 'run' }] } })).toBe(Status.Running);
    });

    it('succeeder forces Success unless Running', () => {
        expect(tick({ root: { type: 'succeeder', children: [{ type: 'action', name: 'fail' }] } })).toBe(Status.Success);
        expect(tick({ root: { type: 'succeeder', children: [{ type: 'action', name: 'run' }] } })).toBe(Status.Running);
    });

    it('re-evaluates from the top each tick so a higher-priority branch preempts (reactive)', () => {
        let low = 0;
        let high = 0;
        reg.registerAction('low', () => { low++; return Status.Running; });
        reg.registerAction('high', () => { high++; return Status.Running; });
        reg.registerCondition('alert', (_c, b) => b.get('alert') === true);
        const def: BtDefinition = {
            root: {
                type: 'selector',
                children: [
                    { type: 'sequence', children: [{ type: 'condition', name: 'alert' }, { type: 'action', name: 'high' }] },
                    { type: 'action', name: 'low' },
                ],
            },
        };

        tick(def); // not alert → falls through to low
        expect(low).toBe(1);
        expect(high).toBe(0);
        bb.set('alert', true);
        tick(def); // alert → high branch preempts the running low, no manual reset
        expect(high).toBe(1);
        expect(low).toBe(1); // low was not ticked this frame
    });

    it('repeater runs its child a fixed number of times then succeeds', () => {
        const def: BtDefinition = { root: { type: 'repeater', count: 3, children: [{ type: 'action', name: 'ok' }] } };
        expect(tick(def)).toBe(Status.Running); // iter 1
        expect(tick(def)).toBe(Status.Running); // iter 2
        expect(tick(def)).toBe(Status.Success); // iter 3 → done
    });

    it('repeater with count 0 loops forever', () => {
        const def: BtDefinition = { root: { type: 'repeater', count: 0, children: [{ type: 'action', name: 'ok' }] } };
        for (let i = 0; i < 5; i++) expect(tick(def)).toBe(Status.Running);
    });

    it('wait succeeds after accumulating dt', () => {
        const def: BtDefinition = { root: { type: 'wait', seconds: 0.25 } };
        expect(tick(def, 0.1)).toBe(Status.Running); // 0.1
        expect(tick(def, 0.1)).toBe(Status.Running); // 0.2
        expect(tick(def, 0.1)).toBe(Status.Success); // 0.3 ≥ 0.25
    });

    it('parallel resolves by success policy', () => {
        expect(tick({ root: { type: 'parallel', children: [{ type: 'action', name: 'ok' }, { type: 'action', name: 'ok' }] } })).toBe(Status.Success);
        expect(tick({ root: { type: 'parallel', children: [{ type: 'action', name: 'ok' }, { type: 'action', name: 'fail' }] } })).toBe(Status.Failure);
        expect(tick({ root: { type: 'parallel', children: [{ type: 'action', name: 'ok' }, { type: 'action', name: 'run' }] } })).toBe(Status.Running);
        expect(tick({ root: { type: 'parallel', policy: 'one', children: [{ type: 'action', name: 'fail' }, { type: 'action', name: 'ok' }] } })).toBe(Status.Success);
        expect(tick({ root: { type: 'parallel', policy: 'one', children: [{ type: 'action', name: 'fail' }, { type: 'action', name: 'fail' }] } })).toBe(Status.Failure);
    });

    it('drives a patrol/chase tree off the blackboard', () => {
        // Selector: [ Sequence(seesPlayer? -> chase), patrol ]
        reg.registerCondition('seesPlayer', (_c, b) => b.get('seesPlayer') === true);
        const chased: string[] = [];
        reg.registerAction('chase', () => { chased.push('chase'); return Status.Running; });
        reg.registerAction('patrol', () => { chased.push('patrol'); return Status.Running; });
        const def: BtDefinition = {
            root: {
                type: 'selector',
                children: [
                    { type: 'sequence', children: [{ type: 'condition', name: 'seesPlayer' }, { type: 'action', name: 'chase' }] },
                    { type: 'action', name: 'patrol' },
                ],
            },
        };

        tick(def);
        expect(chased).toEqual(['patrol']); // no player → fall through to patrol
        bb.set('seesPlayer', true);
        tick(def); // reactive: chase preempts patrol next tick, no reset needed
        expect(chased).toEqual(['patrol', 'chase']); // sees player → chase branch
    });
});
