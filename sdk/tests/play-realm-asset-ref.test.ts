// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regression for the enemy-ai "enemies never chase" bug: play-realm asset refs
 * are resolved once during preload (to bucket by type) and again by the loader,
 * so `resolvePlayAssetRef` must be idempotent or a plain path gains the origin
 * twice (estella://…/estella://…/404). And because the agent holds the authored
 * ref while the asset loaded under a resolved path, the FSM step looks the graph
 * up through its realm — which answers to both spellings — rather than through a
 * store keyed one way.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePlayAssetRef } from '../src/runtime/playRealmRuntime';
import { clearFsmStore, StateMachineAgent } from '../src/ai/fsm/StateMachineAgent';
import { compileFsm, type CompiledFsm } from '../src/ai/fsm/FsmRunner';
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

describe('FSM step looks the graph up through its realm', () => {
    beforeEach(() => clearFsmStore());

    it('runs the graph the realm publishes for the ref the agent holds', () => {
        const resolved = `${BASE}/assets/ai/enemy.esfsm`;
        const compiled = compileFsm({ initial: 'Idle', states: [{ name: 'Idle' }] });
        // A realm publishes under the load path AND the authored ref: both are
        // names of the one slot.
        const realm = new Map<string, CompiledFsm>([
            [resolved, compiled], ['assets/ai/enemy.esfsm', compiled],
        ]);

        const store = new Map<number, Record<string, unknown>>([[1, { fsm: 'assets/ai/enemy.esfsm', current: '' }]]);
        const world = {
            getEntitiesWithComponents: () => [1],
            get: (_e: number, c: unknown) => (c === StateMachineAgent ? store.get(1) : undefined),
            set: (_e: number, _c: unknown, d: Record<string, unknown>) => store.set(1, d),
            has: () => false,
        };

        // No realm: only a code registration could answer, and there is none.
        stepStateMachines(world as never, null as never, 1 / 60, new Map());
        expect(store.get(1)!.current).toBe('');

        stepStateMachines(world as never, null as never, 1 / 60, new Map(), (ref) => realm.get(ref));
        expect(store.get(1)!.current).toBe('Idle');
    });
});
