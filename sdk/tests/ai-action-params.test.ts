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
