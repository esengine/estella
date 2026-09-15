// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ai-action-params.test.ts
 * @brief   Declared action parameters and their canonical string projection —
 *          the contract that lets one action serve `.esfsm` strings and typed
 *          editor rows without becoming two contracts.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
    AiRegistry,
    invokeAction,
    parseActionArg,
    formatActionArg,
    type AiParamDef,
    type AiParams,
} from '../src/ai/fsm/registry';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { aiRegistry, registerAction, registerValue, type AiContext } from '../src/ai/fsm/AiContext';

const PAIR: AiParamDef[] = [
    { name: 'controller', type: 'enum' },
    { name: 'page', type: 'enum' },
];

describe('parseActionArg', () => {
    it('splits positionally, last parameter absorbing the rest', () => {
        expect(parseActionArg('tabs:settings', PAIR)).toEqual({ controller: 'tabs', page: 'settings' });
        expect(parseActionArg('tabs:a:b', PAIR)).toEqual({ controller: 'tabs', page: 'a:b' });
    });

    it('honours a custom separator', () => {
        const defs: AiParamDef[] = [{ name: 'key', type: 'string' }, { name: 'value', type: 'string' }];
        expect(parseActionArg('mode=hard', defs, '=')).toEqual({ key: 'mode', value: 'hard' });
    });

    it('coerces to the declared type', () => {
        const defs: AiParamDef[] = [{ name: 'count', type: 'number' }, { name: 'loop', type: 'bool' }];
        expect(parseActionArg('3:true', defs)).toEqual({ count: 3, loop: true });
        expect(parseActionArg('nope:0', defs)).toEqual({ count: 0, loop: false });
    });

    it('is empty for no arg or no declaration', () => {
        expect(parseActionArg(undefined, PAIR)).toEqual({});
        expect(parseActionArg('x', [])).toEqual({});
    });

    it('fills only what the string provides', () => {
        expect(parseActionArg('tabs', PAIR)).toEqual({ controller: 'tabs' });
    });
});

describe('formatActionArg', () => {
    it('round-trips through parse', () => {
        const params = parseActionArg('tabs:settings', PAIR);
        expect(formatActionArg(params, PAIR)).toBe('tabs:settings');
    });

    it('drops trailing empties rather than emitting "tabs:"', () => {
        expect(formatActionArg({ controller: 'tabs' }, PAIR)).toBe('tabs');
    });

    it('is undefined when there is nothing to say', () => {
        expect(formatActionArg({}, PAIR)).toBeUndefined();
        expect(formatActionArg({ controller: 'x' }, [])).toBeUndefined();
    });
});

describe('a registered action sees both shapes, whichever the caller has', () => {
    let reg: AiRegistry<{ tag: string }>;
    let seen: Array<{ arg?: string; params?: AiParams }>;
    const ctx = { tag: 'ctx' };
    const bb = new Blackboard();

    beforeEach(() => {
        seen = [];
        reg = new AiRegistry<{ tag: string }>();
        reg.registerAction('ui.setPage', {
            params: PAIR,
            run: (_ctx, _bb, arg, params) => { seen.push({ arg, params }); },
        });
    });

    it('a legacy string call gets parsed parameters', () => {
        reg.getAction('ui.setPage')!(ctx, bb, 'tabs:settings');
        expect(seen[0]).toEqual({ arg: 'tabs:settings', params: { controller: 'tabs', page: 'settings' } });
    });

    it('a parameters-only call gets the canonical string', () => {
        invokeAction(reg, 'ui.setPage', ctx, bb, { params: { controller: 'tabs', page: 'home' } });
        expect(seen[0]).toEqual({ arg: 'tabs:home', params: { controller: 'tabs', page: 'home' } });
    });

    it('parameters win when a row carries a stale string too', () => {
        invokeAction(reg, 'ui.setPage', ctx, bb, { arg: 'old:value', params: { controller: 'tabs', page: 'home' } });
        expect(seen[0]!.params).toEqual({ controller: 'tabs', page: 'home' });
    });

    it('an undeclared action is untouched — the raw string, no params', () => {
        reg.registerAction('plain', (_c, _b, arg, params) => { seen.push({ arg, params }); });
        invokeAction(reg, 'plain', ctx, bb, { arg: 'a:b' });
        expect(seen[0]).toEqual({ arg: 'a:b', params: undefined });
    });

    it('invoking an unknown name is a no-op, not a throw', () => {
        expect(() => invokeAction(reg, 'nope', ctx, bb, { arg: 'x' })).not.toThrow();
        expect(seen).toHaveLength(0);
    });

    it('exposes the declaration for editor palettes', () => {
        expect(reg.getActionParams('ui.setPage')).toEqual(PAIR);
        expect(reg.getActionSeparator('ui.setPage')).toBe(':');
        expect(reg.getActionParams('unknown')).toEqual([]);
    });
});

describe('the public registerAction', () => {
    const bb = new Blackboard();
    const ctx = {} as AiContext;

    it('takes a declaration, so a game action reaches the same typed controls', () => {
        let seen: number | undefined;
        registerAction('test.award', {
            params: [{ name: 'amount', type: 'number' }],
            run: (_ctx, _bb, _arg, params) => { seen = params?.amount as number; },
        });

        expect(aiRegistry.getActionParams('test.award')).toEqual([{ name: 'amount', type: 'number' }]);
        invokeAction(aiRegistry, 'test.award', ctx, bb, { arg: '25' });
        expect(seen).toBe(25);
    });

    it('still takes a bare function', () => {
        let seen: string | undefined;
        registerAction('test.plain', (_ctx, _bb, arg) => { seen = arg; });

        expect(aiRegistry.getActionParams('test.plain')).toEqual([]);
        invokeAction(aiRegistry, 'test.plain', ctx, bb, { arg: 'raw' });
        expect(seen).toBe('raw');
    });
});

/**
 * A name declares what it TAKES and what it HANDS BACK. The second half is what
 * a script graph reads off a wire; the first half was always there.
 */
describe('declared outputs', () => {
    const bb = new Blackboard();
    const ctx = {} as AiContext;

    it('hands values back through the out record, leaving the return to the BT', () => {
        registerAction('test.rollDice', {
            params: [{ name: 'sides', type: 'number' }],
            outputs: [{ name: 'value', type: 'number' }],
            run: (_ctx, _bb, _arg, params, out) => {
                if (out) out.value = Number(params?.sides ?? 0);
            },
        });

        expect(aiRegistry.getActionOutputs('test.rollDice')).toEqual([{ name: 'value', type: 'number' }]);
        const out: Record<string, string | number | boolean> = {};
        const status = invokeAction(aiRegistry, 'test.rollDice', ctx, bb, { arg: '20' }, out);
        expect(out).toEqual({ value: 20 });
        expect(status).toBeUndefined();
    });

    it('a name with no `out` handed to it still runs — every caller need not want one', () => {
        let ran = false;
        registerAction('test.sideEffect', {
            outputs: [{ name: 'ignored', type: 'bool' }],
            run: () => { ran = true; },
        });
        invokeAction(aiRegistry, 'test.sideEffect', ctx, bb);
        expect(ran).toBe(true);
    });

    it('registerValue lands in the SAME store, marked pure', () => {
        registerValue('test.double', {
            params: [{ name: 'n', type: 'number' }],
            outputs: [{ name: 'result', type: 'number' }],
            evaluate: (_ctx, _bb, params, out) => { out.result = Number(params.n ?? 0) * 2; },
        });

        expect(aiRegistry.hasAction('test.double')).toBe(true);
        expect(aiRegistry.actionNames()).toContain('test.double');
        expect(aiRegistry.isActionPure('test.double')).toBe(true);
        expect(aiRegistry.isActionPure('test.rollDice')).toBe(false);

        const out: Record<string, string | number | boolean> = {};
        invokeAction(aiRegistry, 'test.double', ctx, bb, { params: { n: 21 } }, out);
        expect(out).toEqual({ result: 42 });
    });

    it('an action that declares nothing declares nothing — not "no outputs, pure"', () => {
        registerAction('test.bare', () => {});
        expect(aiRegistry.getActionOutputs('test.bare')).toEqual([]);
        expect(aiRegistry.isActionPure('test.bare')).toBe(false);
    });
});
