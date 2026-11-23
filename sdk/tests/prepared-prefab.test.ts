// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Parent } from '../src/ecs/component';
import { preparePrefab, spawnPrepared } from '../src/prefab/preparedPrefab';
import { instantiatePrefab, type PrefabData } from '../src/prefab';
import type { Assets } from '../src/asset/Assets';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { INVALID_ENTITY } from '../src/types';

const leaf = (name: string): PrefabData => ({ version: '2', name, rootEntityId: 'root', entities: [
    { prefabEntityId: 'root', name, parent: null, children: [], visible: true,
        components: [{ type: 'Transform', data: { position: { x: 2, y: 3, z: 0 } } }] },
] });
function assetsFor(prefabs: Record<string, PrefabData>) {
    const release = vi.fn();
    const loadPrefab = vi.fn(async (ref: string) => ({ data: prefabs[ref] }));
    const assets = {
        loadPrefab,
        acquireTyped: async (_type: string, ref: string) => ({ value: await loadPrefab(ref), release: vi.fn() }),
        preloadSceneAssets: vi.fn(async () => ({ missing: [], scope: { releaseAll: release } })),
        resolveSceneAssetPaths: vi.fn(),
        trackSceneAssetReferences: vi.fn(),
    };
    return { assets: assets as unknown as Assets, load: assets.loadPrefab, release };
}

describe.skipIf(!HAS_WASM)('prepared prefabs use the same dependency graph as async instantiation', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    const world = () => {
        const w = new World(); w.connectCpp(new engine.Registry() as unknown as CppRegistry, engine); return w;
    };

    it('preloads a nested prefab mounted in two slots once, then spawns independent copies', async () => {
        const child = leaf('child');
        const root = leaf('parent'); root.entities[0].children = ['left', 'right'];
        for (const id of ['left', 'right']) root.entities.push({ prefabEntityId: id, name: id,
            parent: 'root', children: [], visible: true, components: [],
            nestedPrefab: { prefabPath: 'child', overrides: [] } });
        const original = JSON.stringify({ root, child });
        const { assets, load, release } = assetsFor({ root, child });
        const prepared = await preparePrefab(assets, 'root');
        expect(assets.trackSceneAssetReferences).not.toHaveBeenCalled();
        expect(prepared.scene.entities.find(e => e.id === prepared.rootId)!.children).toHaveLength(2);
        expect(load.mock.calls.map(c => c[0])).toEqual(['root', 'child']);
        const w = world();
        try {
            const first = spawnPrepared(w, prepared);
            const second = spawnPrepared(w, prepared, { position: { x: 90, y: 80 } });
            expect(assets.trackSceneAssetReferences).toHaveBeenCalledTimes(2);
            expect(vi.mocked(assets.trackSceneAssetReferences).mock.calls[0][1]).toBe(first.entities);
            expect(vi.mocked(assets.trackSceneAssetReferences).mock.calls[1][1]).toBe(second.entities);
            expect(vi.mocked(assets.trackSceneAssetReferences).mock.calls.map(call => call[2])).toEqual([w, w]);
            expect(first.entities.size).toBe(3);
            for (const e of first.entities.values()) if (e !== first.root) expect(w.get(e, Parent).entity).toBe(first.root);
            expect(w.get(first.root, Transform).position.x).toBe(2);
            expect(w.get(second.root, Transform).position.x).toBe(90);
            expect(JSON.stringify({ root, child })).toBe(original);
            expect(load).toHaveBeenCalledTimes(2);
        } finally { for (const e of w.getAllEntities()) if (w.valid(e)) w.despawn(e); prepared.release(); }
        expect(release).toHaveBeenCalledOnce();
    });

    it('preloads a variant base and its nested dependencies and matches async spawn', async () => {
        const child = leaf('child');
        const base = leaf('base'); base.entities[0].children = ['slot'];
        base.entities.push({ prefabEntityId: 'slot', name: 'slot', parent: 'root', children: [],
            visible: true, components: [], nestedPrefab: { prefabPath: 'child', overrides: [] } });
        const variant: PrefabData = { ...leaf('variant'), entities: [], basePrefab: 'base',
            overrides: [{ prefabEntityId: 'root', type: 'property', componentType: 'Transform',
                propertyName: 'position', value: { x: 10, y: 20, z: 0 } }] };
        const { assets, load } = assetsFor({ variant, base, child });
        const prepared = await preparePrefab(assets, 'variant');
        expect(load.mock.calls.map(c => c[0])).toEqual(['variant', 'base', 'child']);
        const w = world();
        try {
            const first = spawnPrepared(w, prepared);
            const asyncCopy = await instantiatePrefab(w, variant, { assets });
            expect(first.entities.size).toBe(asyncCopy.entities.size);
            expect(w.get(first.root, Transform).position).toEqual(w.get(asyncCopy.root, Transform).position);
            expect(w.get(first.root, Transform).position.x).toBe(10);
        } finally { for (const e of w.getAllEntities()) if (w.valid(e)) w.despawn(e); prepared.release(); }
    });

    it('refuses a nested cycle before publishing a prepared value', async () => {
        const root = leaf('root'); root.entities[0].nestedPrefab = { prefabPath: 'root', overrides: [] };
        const { assets, load } = assetsFor({ root });
        await expect(preparePrefab(assets, 'root')).rejects.toThrow(/Circular reference/);
        expect(load.mock.calls.length).toBeLessThanOrEqual(2);
    });
    it('rolls back a prepared hierarchy when its parent no longer exists', async () => {
        const source = leaf('root'); source.entities[0].children = ['child'];
        source.entities.push({ ...leaf('child').entities[0], prefabEntityId: 'child', parent: 'root' });
        const { assets } = assetsFor({ root: source });
        const prepared = await preparePrefab(assets, 'root');
        const w = world();
        try {
            const parent = w.spawn(); w.despawn(parent);
            expect(() => spawnPrepared(w, prepared, { parent })).toThrow(/parent/);
            expect(w.getAllEntities()).toHaveLength(0);
        } finally { for (const e of w.getAllEntities()) if (w.valid(e)) w.despawn(e); prepared.release(); }
    });
    it('supports live parents, position overrides and an explicit unparented spawn', async () => {
        const { assets } = assetsFor({ root: leaf('root') });
        const prepared = await preparePrefab(assets, 'root'), w = world();
        try {
            const parent = w.spawn();
            const child = spawnPrepared(w, prepared, { parent, position: { x: 90, y: 80 } });
            expect(w.get(child.root, Parent).entity).toBe(parent);
            expect(w.get(child.root, Transform).position).toEqual({ x: 90, y: 80, z: 0 });
            const standalone = spawnPrepared(w, prepared, { parent: INVALID_ENTITY });
            expect(w.has(standalone.root, Parent)).toBe(false);
            w.despawn(parent);
            expect(w.valid(child.root)).toBe(false);
            expect(w.valid(standalone.root)).toBe(true);
        } finally { for (const e of w.getAllEntities()) if (w.valid(e)) w.despawn(e); prepared.release(); }
    });
});
