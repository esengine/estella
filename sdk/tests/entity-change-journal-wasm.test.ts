// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import { createNativeEngineApi } from '../src/ecs/bridge/nativeEngineApi.generated';
import { withMalloc } from '../src/wasm/wasmScratch';
import {
    ENTITY_CHANGE_CAPACITY, ENTITY_CHANGE_WORDS, ENTITY_CHANGE_SUBTREE, ENTITY_CHANGE_RESET,
    ENTITY_CHANGE_REPLACED, ENTITY_CHANGE_NO_COMPONENT,
} from '../src/wasm/constants.generated';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule, api: EngineApi, registry: CppRegistry;
const leases: number[] = [];
const watch = () => {
    const lease = api.registry_watchEntityChanges!(registry);
    leases.push(lease);
    return lease;
};
const sequence = () => api.registry_entityChangeSequence!(registry);
function read(after: number, capacity = ENTITY_CHANGE_CAPACITY) {
    return withMalloc(core, Math.max(1, capacity) * ENTITY_CHANGE_WORDS * 4, ptr => {
        const count = api.registry_readEntityChanges!(registry, after, ptr, capacity);
        const rows: { entity: number; flags: number }[] = [];
        const components: number[] = [];
        for (let i = 0; i < count; ++i) {
            const at = (ptr >>> 2) + i * ENTITY_CHANGE_WORDS;
            rows.push({ entity: core.HEAPU32[at], flags: core.HEAPU32[at + 1] });
            components.push(core.HEAPU32[at + 2]);
        }
        return { count, rows, components };
    });
}

describe.skipIf(!HAS_WASM)('native registry entity change journal', () => {
    beforeAll(async () => { core = await loadWasmModule(); api = core as EngineApi; });
    afterEach(() => {
        for (const lease of leases.splice(0)) api.registry_unwatchEntityChanges!(registry, lease);
        registry?.delete();
    });
    const start = () => { registry = new core.Registry(); };

    it('retains nothing without a reader and releases the final reader storage', () => {
        start(); registry.create();
        expect(read(0).count).toBe(-1);
        watch(); expect(read(sequence(), 0).count).toBe(0);
        registry.create(); expect(read(0).count).toBe(1);
        api.registry_unwatchEntityChanges!(registry, leases.pop()!);
        expect(read(0).count).toBe(-1);
        watch(); expect(sequence()).toBe(0);
        expect(read(0).count).toBe(0);
    });

    it('keeps readers independent and preserves generations across recycled entities', () => {
        start(); const first = watch(), original = registry.create();
        const cursor = sequence(); watch(); registry.destroy(original);
        const replacement = registry.create();
        expect(replacement).not.toBe(original);
        expect(read(0).rows.map(row => row.entity)).toEqual([original, original, replacement]);
        expect(read(cursor).rows.map(row => row.entity)).toEqual([original, replacement]);
        api.registry_unwatchEntityChanges!(registry, first);
        api.registry_unwatchEntityChanges!(registry, first);
        expect(read(0).count).toBe(3);
    });

    it('requires a full refresh after overflow instead of returning a truncated delta', () => {
        start(); watch();
        for (let i = 0; i <= ENTITY_CHANGE_CAPACITY; ++i) registry.create();
        expect(read(0).count).toBe(-1);
        expect(read(1).count).toBe(ENTITY_CHANGE_CAPACITY);
        expect(read(sequence() - 1).count).toBe(1);
        expect(read(sequence() - 1, 0).count).toBe(-1);
    });

    it('rejects invalid cursors and output capacities', () => {
        start(); watch(); registry.create();
        for (const cursor of [-1, .5, NaN, Infinity, sequence() + 1]) expect(read(cursor).count).toBe(-1);
        expect(api.registry_readEntityChanges!(registry, 0, 0, -1)).toBe(-1);
        expect(api.registry_readEntityChanges!(registry, 0, 0, ENTITY_CHANGE_CAPACITY + 1)).toBe(-1);
        expect(api.registry_readEntityChanges!(registry, 0, 1, 1)).toBe(-1);
    });

    it('marks native activity and hierarchy changes by subtree without invalidating unrelated entities', () => {
        start();
        const parent = registry.create(), child = registry.create(), unrelated = registry.create();
        registry.setEntityEnabled!(unrelated, false); watch();
        const added = registry.create();
        registry.setParent(child, parent);
        registry.setEntityEnabled!(parent, false);
        const rows = read(0).rows;
        expect(rows.some(row => row.flags & ENTITY_CHANGE_RESET)).toBe(false);
        expect(rows).toContainEqual({ entity: added, flags: 0 });
        expect(rows.some(row => row.entity === child && (row.flags & ENTITY_CHANGE_SUBTREE))).toBe(true);
        expect(rows.some(row => row.entity === parent && (row.flags & ENTITY_CHANGE_SUBTREE))).toBe(true);
        const cursor = sequence(); registry.destroy(parent);
        expect(read(cursor).rows).toContainEqual({ entity: child, flags: ENTITY_CHANGE_SUBTREE });
    });

    it('records generated native component additions, replacements and removals', () => {
        start(); const entity = registry.create(); watch();
        const value = { linear: { x: 1, y: 2, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
        registry.addVelocity(entity, value);
        registry.addVelocity(entity, { ...value, linear: { x: 4, y: 5, z: 0 } });
        registry.removeVelocity(entity);
        const result = read(0);
        expect(result.rows).toEqual([
            { entity, flags: 0 }, { entity, flags: ENTITY_CHANGE_REPLACED }, { entity, flags: 0 },
        ]);
        expect(result.components[0]).not.toBe(ENTITY_CHANGE_NO_COMPONENT);
        expect(new Set(result.components).size).toBe(1);
    });

    it.each([false, true])('stamps every component removed by destroy with a journal watcher present: %s', observing => {
        start();
        const root = registry.create(), child = registry.create();
        registry.setParent(child, root);
        registry.addVelocity(child, { linear: { x: 1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
        const types = ['Parent', 'Velocity', 'Children'].map(name => registry.componentTypeId!(name));
        const revisions = (topology: boolean) => types.map(type => api.registry_componentMutationRevision!(registry, type, topology));
        const topology = revisions(true), values = revisions(false);
        if (observing) watch();

        registry.destroy(child);

        for (const [before, after] of [[topology, revisions(true)], [values, revisions(false)]]) {
            expect(after[0]).toBeGreaterThan(before[0]);
            expect(after[1]).toBeGreaterThan(before[1]);
            expect(after[2]).toBe(before[2]);
        }
        if (observing) expect(read(0).rows).toEqual([{ entity: child, flags: 0 }]);
        else expect(read(0).count).toBe(-1);
    });
});

it('routes the same journal API through the native host with its implicit registry', () => {
    const calls: unknown[][] = [];
    const api = createNativeEngineApi({
        es_registry_watchEntityChanges: (...args: unknown[]) => { calls.push(args); return 11; },
        es_registry_unwatchEntityChanges: (...args: unknown[]) => { calls.push(args); },
        es_registry_entityChangeSequence: (...args: unknown[]) => { calls.push(args); return 2 ** 32 + 9; },
        es_registry_readEntityChanges: (...args: unknown[]) => { calls.push(args); return 2; },
    });
    expect(api.registry_watchEntityChanges!({})).toBe(11);
    expect(api.registry_entityChangeSequence!({})).toBe(2 ** 32 + 9);
    expect(api.registry_readEntityChanges!({}, 2 ** 32 + 7, 16, 4)).toBe(2);
    api.registry_unwatchEntityChanges!({}, 11);
    expect(calls).toEqual([[], [], [2 ** 32 + 7, 16, 4], [11]]);
});
