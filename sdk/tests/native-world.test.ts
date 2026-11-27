// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native-world.test.ts
 * @brief   The real SDK World, booted over the native core (Stage A finale). A
 *          mock native ECS backs the host bindings (entity alloc + hierarchy +
 *          per-component storage) so the ACTUAL World class — spawn / insert /
 *          get / has / remove / setParent / cascading despawn — drives the native
 *          registry + memory backend end-to-end, headless, no device.
 */
import { describe, expect, it, vi } from 'vitest';
import { createNativeWorld } from '../src/ecs/bridge/nativeRuntime';
import { createNativeEngineApi } from '../src/ecs/bridge/nativeEngineApi.generated';
import { nativeEngineApi, setNativeEngineApi } from '../src/ecs/bridge/engineApi';
import { PTR_ACCESSORS } from '../src/ecs/bridge/ptrAccessors.generated';
import { installRegistryOpDefaults } from './helpers/nativeRegistryOps';
import { Children, Parent, Sprite, Transform } from '../src/ecs/component';

/** A self-contained fake native ECS + the host bindings createNativeWorld expects. */
function mockNativeEcs() {
    let nextId = 1;
    const alive = new Set<number>();
    const parents = new Map<number, number>();          // child -> parent
    const children = new Map<number, Set<number>>();    // parent -> children
    const comps = new Map<string, Map<number, ArrayBuffer>>();
    const store = (cpp: string) => {
        let m = comps.get(cpp);
        if (!m) { m = new Map(); comps.set(cpp, m); }
        return m;
    };

    const scope: Record<string, unknown> = {
        es_registry_create: () => { const e = nextId++; alive.add(e); return e; },
        es_registry_destroy: (e: number) => {
            alive.delete(e);
            for (const m of comps.values()) m.delete(e);
            const p = parents.get(e);
            if (p !== undefined) children.get(p)?.delete(e);
            parents.delete(e);
            children.delete(e);
        },
        es_hasParent: (e: number) => parents.has(e),
        es_registry_setParent: (c: number, p: number) => {
            parents.set(c, p);
            let s = children.get(p);
            if (!s) { s = new Set(); children.set(p, s); }
            s.add(c);
        },
        es_removeParent: (e: number) => {
            const p = parents.get(e);
            if (p !== undefined) children.get(p)?.delete(e);
            parents.delete(e);
        },
        es_hasChildren: (e: number) => children.has(e),
        es_getChildren: (e: number) => [...(children.get(e) ?? [])],
    };
    installRegistryOpDefaults(scope, alive);
    for (const cppName of Object.keys(PTR_ACCESSORS)) {
        scope[`es_${cppName}_buffer`] = (e: number) => {
            const m = store(cppName);
            let b = m.get(e);
            if (!b) { b = new ArrayBuffer(256); m.set(e, b); }
            return b;
        };
        scope[`es_${cppName}_has`] = (e: number) => store(cppName).has(e);
        scope[`es_${cppName}_remove`] = (e: number) => { store(cppName).delete(e); };
    }
    return { scope, alive, comps };
}

describe('createNativeWorld', () => {
    it('spawns, authors components, and reads them back through the real World', () => {
        const { scope, alive } = mockNativeEcs();
        const world = createNativeWorld(scope);

        const e = world.spawn();
        expect(alive.has(e)).toBe(true);          // native entity really created
        expect(world.valid(e)).toBe(true);

        world.insert(e, Sprite, {
            color: { r: 0.5, g: 0.25, b: 0.125, a: 1 },
            size: { x: 20, y: 40 },
            lit: true,
        });
        expect(world.has(e, Sprite)).toBe(true);

        const sprite = world.get(e, Sprite);
        expect(sprite.color.r).toBeCloseTo(0.5);
        expect(sprite.color.g).toBeCloseTo(0.25);
        expect(sprite.color.b).toBeCloseTo(0.125);
        expect(sprite.size).toMatchObject({ x: 20, y: 40 });
        expect(sprite.lit).toBe(true);

        world.insert(e, Transform, { position: { x: 3, y: 4, z: 5 } });
        expect(world.get(e, Transform).position).toMatchObject({ x: 3, y: 4, z: 5 });

        world.remove(e, Sprite);
        expect(world.has(e, Sprite)).toBe(false);
        expect(world.has(e, Transform)).toBe(true);   // unaffected
    });

    it('drives hierarchy + cascading despawn through the native registry', () => {
        const { scope, alive } = mockNativeEcs();
        const world = createNativeWorld(scope);

        const parent = world.spawn();
        const child = world.spawn();
        world.setParent(child, parent);
        expect(alive.has(parent)).toBe(true);
        expect(alive.has(child)).toBe(true);

        world.despawn(parent);                        // cascades via es_getChildren
        expect(world.valid(parent)).toBe(false);
        expect(world.valid(child)).toBe(false);       // child despawned with the subtree
        expect(alive.has(parent)).toBe(false);        // native destroy really ran
        expect(alive.has(child)).toBe(false);
    });

    it('reads live hierarchy query membership on hosts without mutation revisions', () => {
        const { scope } = mockNativeEcs();
        const world = createNativeWorld(scope);
        const registry = world.getCppRegistry()!;

        const first = world.spawn(), second = world.spawn(), a = world.spawn(), b = world.spawn();
        world.setParent(a, first);
        expect(world.queryEntities([Parent])).toEqual([a]);
        expect(world.queryEntities([Children])).toEqual([first]);

        registry.setParent(b, second);
        registry.removeParent(a);
        expect(world.queryEntities([Parent])).toEqual([b]);
        expect(world.has(first, Children)).toBe(true);
        expect(world.tryGet(first, Children)).toEqual({ entities: [] });
        expect(world.queryEntities([Children])).toEqual([first, second]);
    });

    it('reads sparse hierarchy members through the native bridge and frees the scratch buffer', () => {
        const { scope } = mockNativeEcs();
        const world = createNativeWorld(scope);
        const previousApi = nativeEngineApi();
        const heap = new Uint32Array(4);
        const root = world.spawn(), first = world.spawn(), second = world.spawn();
        for (let i = 0; i < 32; i++) world.spawn();
        world.setParent(second, root);
        world.getCppRegistry()!.setParent(first, root);
        const read = vi.fn((_children: boolean, pointer: number, capacity: number) => {
            if (capacity) heap.set([second, first], pointer >>> 2);
            return 2;
        });
        const free = vi.fn();
        scope.es_registry_readHierarchyMembers = read;
        setNativeEngineApi({ ...createNativeEngineApi(scope), _malloc: () => 4, _free: free, HEAPU32: heap });

        try {
            expect(world.queryEntities([Parent])).toEqual([first, second]);
            expect(read.mock.calls).toEqual([[false, 0, 0], [false, 4, 2]]);
            expect(free.mock.calls).toEqual([[4]]);
        } finally {
            setNativeEngineApi(previousApi);
            world.disconnectCpp();
        }
    });

    it('keeps distinct entities independent', () => {
        const { scope } = mockNativeEcs();
        const world = createNativeWorld(scope);

        const a = world.spawn();
        const b = world.spawn();
        world.insert(a, Sprite, { lit: true });
        world.insert(b, Sprite, { lit: false });

        expect(world.get(a, Sprite).lit).toBe(true);
        expect(world.get(b, Sprite).lit).toBe(false);
        expect(a).not.toBe(b);
    });
});
