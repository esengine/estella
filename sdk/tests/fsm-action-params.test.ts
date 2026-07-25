// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fsm-action-params.test.ts
 * @brief   A state hook / BT leaf may carry declared parameters instead of the
 *          canonical string — the same reference shape an event wire uses, so a
 *          declaration written once serves all three authoring surfaces.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AiRegistry, type AiParams } from '../src/ai/fsm/registry';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { compileFsm, createFsmRunState, stepFsm } from '../src/ai/fsm/FsmRunner';
import { setStateHook } from '../src/ai/fsm/fsmGraph';
import { actionRefParams } from '../src/ai/fsm/types';
import type { FsmDefinition } from '../src/ai/fsm/types';
import { tickBt, createBtRunState } from '../src/ai/bt/BtRunner';
import type { BtDefinition } from '../src/ai/bt/types';

let seen: Array<{ arg?: string; params?: AiParams }>;
let reg: AiRegistry<{ tag: string }>;
const ctx = { tag: 'ctx' };

beforeEach(() => {
    seen = [];
    reg = new AiRegistry<{ tag: string }>();
    reg.registerAction('ui.setPage', {
        params: [{ name: 'controller', type: 'enum' }, { name: 'page', type: 'enum' }],
        run: (_c, _b, arg, params) => { seen.push({ arg, params }); },
    });
});

const fsmWith = (hook: unknown): FsmDefinition =>
    ({ initial: 'A', states: [{ name: 'A', onEnter: hook }] }) as FsmDefinition;

describe('an FSM hook authored with parameters', () => {
    it('reaches the action as parameters AND as the canonical string', () => {
        const fsm = compileFsm(fsmWith({ name: 'ui.setPage', params: { controller: 'tabs', page: 'home' } }));
        stepFsm(fsm, createFsmRunState(fsm), ctx, new Blackboard(), reg);

        expect(seen[0]).toEqual({ arg: 'tabs:home', params: { controller: 'tabs', page: 'home' } });
    });

    it('a hook authored as a string still parses into parameters', () => {
        const fsm = compileFsm(fsmWith({ name: 'ui.setPage', arg: 'tabs:home' }));
        stepFsm(fsm, createFsmRunState(fsm), ctx, new Blackboard(), reg);

        expect(seen[0]!.params).toEqual({ controller: 'tabs', page: 'home' });
    });
});

describe('a BT action leaf authored with parameters', () => {
    it('reaches the action the same way', () => {
        const bt: BtDefinition = {
            root: { type: 'action', id: 'a', name: 'ui.setPage', params: { controller: 'tabs', page: 'shop' } },
        } as BtDefinition;

        tickBt(bt, ctx, new Blackboard(), reg, createBtRunState(), 1 / 60);

        expect(seen[0]).toEqual({ arg: 'tabs:shop', params: { controller: 'tabs', page: 'shop' } });
    });
});

describe('setStateHook', () => {
    const base: FsmDefinition = { initial: 'A', states: [{ name: 'A' }] } as FsmDefinition;

    it('keeps a bare name a bare string — the shorthand most hooks use', () => {
        const next = setStateHook(base, 'A', 'onEnter', 'timeline.play');
        expect(next.states[0].onEnter).toBe('timeline.play');
    });

    it('stores parameters when given them, and drops the string form', () => {
        const next = setStateHook(base, 'A', 'onEnter', 'ui.setPage', 'stale:value', { controller: 'tabs', page: 'home' });
        expect(next.states[0].onEnter).toEqual({ name: 'ui.setPage', params: { controller: 'tabs', page: 'home' } });
        expect(actionRefParams(next.states[0].onEnter)).toEqual({ controller: 'tabs', page: 'home' });
    });

    it('falls back to the string when the parameter record is empty', () => {
        const next = setStateHook(base, 'A', 'onEnter', 'spriteAnim.play', 'run.esanim', {});
        expect(next.states[0].onEnter).toEqual({ name: 'spriteAnim.play', arg: 'run.esanim' });
    });

    it('clearing the name clears the hook', () => {
        const withHook = setStateHook(base, 'A', 'onEnter', 'ui.setPage', undefined, { controller: 'tabs' });
        expect(setStateHook(withHook, 'A', 'onEnter', '').states[0].onEnter).toBeUndefined();
    });
});
