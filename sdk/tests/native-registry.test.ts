// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native-registry.test.ts
 * @brief   The native component registry (embind-Registry sibling). A mock host
 *          scope backs es_<C>_buffer/_has/_remove with JS ArrayBuffers + a Set,
 *          so the full SDK component API (BuiltinBridge.insert/get/has/remove +
 *          the fast path) runs on the native backend end-to-end, headless, no
 *          device — proving Stage A: one SDK, native core.
 */
import { describe, expect, it } from 'vitest';
import { BuiltinBridge } from '../src/ecs/bridge/BuiltinBridge';
import { createNativeRegistry } from '../src/ecs/bridge/nativeRegistry';
import { NativeMemoryProvider } from '../src/ecs/bridge/memoryProvider';
import { PTR_ACCESSORS } from '../src/ecs/bridge/ptrAccessors.generated';
import { Sprite } from '../src/ecs/component';

/**
 * A fake native host: each component's storage is an entity->ArrayBuffer map, with
 * the three generated bindings the SDK expects. es_<C>_buffer getOrEmplaces (mirrors
 * the native binding); _has / _remove complete the lifecycle.
 */
function mockNativeScope(byteSize = 256): Record<string, unknown> {
    const scope: Record<string, unknown> = {};
    for (const cppName of Object.keys(PTR_ACCESSORS)) {
        const store = new Map<number, ArrayBuffer>();
        scope[`es_${cppName}_buffer`] = (e: number) => {
            let b = store.get(e);
            if (!b) { b = new ArrayBuffer(byteSize); store.set(e, b); }
            return b;
        };
        scope[`es_${cppName}_has`] = (e: number) => store.has(e);
        scope[`es_${cppName}_remove`] = (e: number) => { store.delete(e); };
    }
    return scope;
}

describe('createNativeRegistry', () => {
    it('round-trips a component through add / has / get / remove (embind shape)', () => {
        const reg = createNativeRegistry(mockNativeScope()) as unknown as Record<string, Function>;

        expect(reg.hasSprite(1)).toBe(false);
        // add takes a full component (the SDK always merges defaults first). Start
        // from the generated defaults, then restate color in embind {x,y,z,w} shape.
        const data = PTR_ACCESSORS.Sprite.create() as Record<string, any>;
        data.color = { x: 0.5, y: 0.25, z: 0.125, w: 1 };
        data.size = { x: 12, y: 34 };
        data.lit = true;
        reg.addSprite(1, data);
        expect(reg.hasSprite(1)).toBe(true);

        const got = reg.getSprite(1) as Record<string, any>;
        // get returns embind shape ({x,y,z,w}) for the SDK boundary.
        expect(got.color.x).toBeCloseTo(0.5);
        expect(got.color.y).toBeCloseTo(0.25);
        expect(got.color.z).toBeCloseTo(0.125);
        expect(got.size).toMatchObject({ x: 12, y: 34 });
        expect(got.lit).toBe(true);

        reg.removeSprite(1);
        expect(reg.hasSprite(1)).toBe(false);
    });

    it('drives the real SDK BuiltinBridge lifecycle on the native backend', () => {
        const scope = mockNativeScope();
        const reg = createNativeRegistry(scope);
        const bridge = new BuiltinBridge();
        // No wasm module — the native memory backend + registry stand in for it.
        bridge.connect(reg, undefined, { memory: new NativeMemoryProvider(scope) });

        const e = 42;
        expect(bridge.has(e, Sprite)).toBe(false);

        // insert() speaks the SDK {r,g,b,a} color shape; convertForWasm + the
        // registry's convertFromWasm bridge it to native memory and back.
        const { isNew } = bridge.insert(e, Sprite, {
            color: { r: 0.5, g: 0.25, b: 0.125, a: 1 },
            size: { x: 20, y: 40 },
            lit: true,
        });
        expect(isNew).toBe(true);
        expect(bridge.has(e, Sprite)).toBe(true);

        const sprite = bridge.get(e, Sprite) as { color: any; size: any; lit: boolean };
        expect(sprite.color.r).toBeCloseTo(0.5);
        expect(sprite.color.g).toBeCloseTo(0.25);
        expect(sprite.color.b).toBeCloseTo(0.125);
        expect(sprite.color.a).toBeCloseTo(1);
        expect(sprite.size).toMatchObject({ x: 20, y: 40 });
        expect(sprite.lit).toBe(true);
    });

    it('get never creates a component (has stays false)', () => {
        const scope = mockNativeScope();
        const reg = createNativeRegistry(scope) as unknown as Record<string, Function>;
        reg.getSprite(9);                       // read a missing component
        expect(reg.hasSprite(9)).toBe(false);   // must not have emplaced it
    });

    it('adds a component whose native struct is not 4-byte aligned (Interactable is 3 bytes)', () => {
        // The host returns a buffer the exact size of the component. Interactable is
        // three bools = 3 bytes, not a multiple of 4, so building a Float32Array over
        // the whole buffer throws "invalid length" on QuickJS. views() must cover only
        // the 4-aligned prefix for the word views and the whole buffer for the byte view.
        const store = new Map<number, ArrayBuffer>();
        const scope: Record<string, unknown> = {
            es_Interactable_buffer: (e: number) => {
                let b = store.get(e);
                if (!b) { b = new ArrayBuffer(3); store.set(e, b); }
                return b;
            },
            es_Interactable_has: (e: number) => store.has(e),
            es_Interactable_remove: (e: number) => { store.delete(e); },
        };
        const reg = createNativeRegistry(scope) as unknown as Record<string, Function>;
        const data = PTR_ACCESSORS.Interactable.create() as Record<string, unknown>;
        data.enabled = true; data.blockRaycast = false; data.raycastTarget = true;
        expect(() => reg.addInteractable(1, data)).not.toThrow();
        const got = reg.getInteractable(1) as Record<string, boolean>;
        expect(got.enabled).toBe(true);
        expect(got.blockRaycast).toBe(false);
        expect(got.raycastTarget).toBe(true);
    });

    it('exposes Parent/Children the component way over the native entity-ops', () => {
        // BuiltinBridge.getBuiltinMethods requires add/get/has/remove for the hierarchy
        // components — the physics and hierarchy systems read them that way. The host
        // binds only entity-ops (setParent/getParent/getChildren); the registry adapts.
        const parents = new Map<number, number>();
        const children = new Map<number, number[]>();
        const scope: Record<string, unknown> = {
            es_setParent: (c: number, p: number) => {
                parents.set(c, p);
                (children.get(p) ?? children.set(p, []).get(p)!).push(c);
            },
            es_getParent: (c: number) => parents.get(c) ?? 0,
            es_hasParent: (c: number) => parents.has(c),
            es_removeParent: (c: number) => { parents.delete(c); },
            es_hasChildren: (p: number) => (children.get(p)?.length ?? 0) > 0,
            es_getChildren: (p: number) => children.get(p) ?? [],
        };
        const reg = createNativeRegistry(scope) as unknown as Record<string, Function>;
        for (const m of ['addParent', 'getParent', 'hasParent', 'removeParent',
            'addChildren', 'getChildren', 'hasChildren', 'removeChildren']) {
            expect(typeof reg[m]).toBe('function');
        }
        reg.addParent(2, { entity: 1 });
        expect(reg.hasParent(2)).toBe(true);
        expect((reg.getParent(2) as { entity: number }).entity).toBe(1);
        expect(reg.hasChildren(1)).toBe(true);
    });

    it('exposes MeshSkin the component way — its joints have no POD layout', () => {
        // The third component outside PTR_ACCESSORS, and the one a rigged glTF
        // inserts: without these four, a skinned model on a device died at
        // `insertBuiltin(MeshSkin)` with "C++ Registry missing methods".
        const skins = new Map<number, number[]>();
        const scope: Record<string, unknown> = {
            es_setMeshSkinJoints: (e: number, ids: number[]) => { skins.set(e, [...ids]); },
            es_getMeshSkinJoints: (e: number) => skins.get(e) ?? [],
            es_MeshSkin_has: (e: number) => skins.has(e),
            es_MeshSkin_remove: (e: number) => { skins.delete(e); },
        };
        const reg = createNativeRegistry(scope) as unknown as Record<string, Function>;
        for (const m of ['addMeshSkin', 'getMeshSkin', 'hasMeshSkin', 'removeMeshSkin']) {
            expect(typeof reg[m]).toBe('function');
        }

        expect(reg.hasMeshSkin(4)).toBe(false);
        reg.addMeshSkin(4, { joints: [7, 8, 9] });
        expect(reg.hasMeshSkin(4)).toBe(true);
        expect((reg.getMeshSkin(4) as { joints: number[] }).joints).toEqual([7, 8, 9]);
        // The order IS the meaning: entry i drives joint i of the bind matrices.
        reg.addMeshSkin(4, { joints: [9, 8, 7] });
        expect((reg.getMeshSkin(4) as { joints: number[] }).joints).toEqual([9, 8, 7]);
        reg.removeMeshSkin(4);
        expect(reg.hasMeshSkin(4)).toBe(false);
        expect((reg.getMeshSkin(4) as { joints: number[] }).joints).toEqual([]);
    });

    it('getChildren.entities is iterable (for...of) as well as vector-shaped', () => {
        // The timeline/animator child-path resolver walks children with a for-of and
        // types the field `Entity[]`; the VectorEntity shim must answer Symbol.iterator
        // too, or that for-of throws "value is not iterable" on the native backend.
        const scope: Record<string, unknown> = {
            es_getChildren: (_p: number) => [10, 11, 12],
            es_hasChildren: (_p: number) => true,
        };
        const reg = createNativeRegistry(scope) as unknown as Record<string, Function>;
        const kids = (reg.getChildren(1) as { entities: Iterable<number> }).entities;
        expect([...kids]).toEqual([10, 11, 12]);
        const seen: number[] = [];
        for (const c of kids) seen.push(c);
        expect(seen).toEqual([10, 11, 12]);
    });

    it('skips components whose host bindings are absent', () => {
        // Only Sprite is bound; other components must not get registry methods.
        const scope: Record<string, unknown> = {
            es_Sprite_buffer: (_e: number) => new ArrayBuffer(256),
            es_Sprite_has: (_e: number) => false,
            es_Sprite_remove: (_e: number) => {},
        };
        const reg = createNativeRegistry(scope) as unknown as Record<string, unknown>;
        expect(typeof reg.addSprite).toBe('function');
        expect(reg.addTransform).toBeUndefined();
    });
});
