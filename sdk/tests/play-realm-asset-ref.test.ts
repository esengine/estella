// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regression for the enemy-ai "enemies never chase" bug: play-realm asset refs
 * are resolved once during preload (to bucket by type) and again by the loader,
 * so `resolvePlayAssetRef` must be idempotent or a plain path gains the origin
 * twice (estella://…/estella://…/404). And because a `.esfsm`/`.esbt` registers
 * under its resolved path while the agent still holds the authored ref, the FSM
 * step must resolve the ref before lookup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePlayAssetRef } from '../src/runtime/playRealmRuntime';
import { registerFsm, getFsm, clearFsmStore, StateMachineAgent } from '../src/ai/fsm/StateMachineAgent';
import { stepStateMachines } from '../src/ai/fsm/FsmPlugin';

const BASE = 'estella://project';

describe('resolvePlayAssetRef idempotency', () => {
    it('prefixes a plain path exactly once', () => {
        const once = resolvePlayAssetRef('assets/ai/enemy.esfsm', {}, BASE);
        expect(once).toBe(`${BASE}/assets/ai/enemy.esfsm`);
        // Resolving the already-resolved URL again is a no-op (no double origin).
        expect(resolvePlayAssetRef(once, {}, BASE)).toBe(once);
    });

    it('passes any absolute URL through unchanged', () => {
        expect(resolvePlayAssetRef('estella://project/x.png', {}, BASE)).toBe('estella://project/x.png');
        expect(resolvePlayAssetRef('https://cdn/x.png', {}, BASE)).toBe('https://cdn/x.png');
    });

    it('maps @uuid: refs through the manifest', () => {
        const url = resolvePlayAssetRef('@uuid:ABC', { abc: `${BASE}/built/a.esfsm` }, BASE);
        expect(url).toBe(`${BASE}/built/a.esfsm`);
    });
});

describe('FSM step resolves the agent ref before lookup', () => {
    beforeEach(() => clearFsmStore());

    it('runs an FSM registered under the resolved key while the agent holds the raw ref', () => {
        const resolved = `${BASE}/assets/ai/enemy.esfsm`;
        // The loader registers under the resolved path (what preload keys it by).
        registerFsm(resolved, { initial: 'Idle', states: [{ name: 'Idle' }] });

        const store = new Map<number, Record<string, unknown>>([[1, { fsm: 'assets/ai/enemy.esfsm', current: '' }]]);
        const world = {
            getEntitiesWithComponents: () => [1],
            get: (_e: number, c: unknown) => (c === StateMachineAgent ? store.get(1) : undefined),
            set: (_e: number, _c: unknown, d: Record<string, unknown>) => store.set(1, d),
            has: () => false,
        };

        // Without a resolver the raw ref misses the resolved key → no state entered.
        stepStateMachines(world as never, null as never, 1 / 60, new Map());
        expect(store.get(1)!.current).toBe('');

        // With the realm resolver (raw → resolved), the agent finds its FSM.
        stepStateMachines(world as never, null as never, 1 / 60, new Map(), (ref) => resolvePlayAssetRef(ref, {}, BASE));
        expect(store.get(1)!.current).toBe('Idle');
    });
});
