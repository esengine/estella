// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import { PrefabAssetLoader } from '../src/asset/loaders/PrefabAssetLoader';
import type { Backend } from '../src/asset/Backend';
import type { PrefabResult } from '../src/asset/AssetLoader';
import { World } from '../src/ecs/world';
import { loadSceneWithAssets, type SceneData } from '../src/scene/scene';
import { createMockModule } from './mocks/wasm';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}),
    getResourceManager: () => null,
}));

function harness(missingChild = false) {
    const child = {
        version: '2', name: 'Leaf', rootEntityId: 'leaf',
        entities: [{ prefabEntityId: 'leaf', name: 'Leaf', parent: null, children: [], components: [], visible: true }],
    };
    const root = {
        version: '2', name: 'Tree', rootEntityId: 'root',
        entities: [
            { prefabEntityId: 'root', name: 'Tree', parent: null, children: ['branch'], components: [], visible: true },
            { prefabEntityId: 'branch', name: 'Branch', parent: 'root', children: [], components: [], visible: true,
                nestedPrefab: { prefabPath: 'leaf.esprefab', overrides: [] } },
        ],
    };
    const documents: Record<string, unknown> = { 'tree.esprefab': root };
    if (!missingChild) documents['leaf.esprefab'] = child;
    const module = createMockModule();
    const assets = Assets.create({
        module: module as never,
        backend: {
            fetchText: vi.fn(async (path: string) => {
                const document = documents[path.split('/').pop()!];
                if (!document) throw new Error('missing fixture');
                return JSON.stringify(document);
            }),
            fetchBinary: vi.fn(async () => new ArrayBuffer(0)),
            resolveUrl: (path: string) => path,
        } as unknown as Backend,
    });
    const loader = new PrefabAssetLoader();
    const unloaded = vi.spyOn(loader, 'unload');
    assets.register(loader);
    const world = new World();
    const scene = {
        version: 4, name: 'Forest',
        entities: [1, 2].map(id => ({ id, parent: null, prefab: 'tree.esprefab', overrides: [], added: [], removed: [] })),
    } as unknown as SceneData;
    const scope = new AssetScope();
    const options = {
        assets,
        collectAssets: { scope, texturePaths: new Set<string>(), materialHandles: new Set<number>(), fontPaths: new Set<string>(), spineKeys: new Set<string>() },
    };
    return { world, assets, scene, options, unloaded };
}

describe('scene prefab source ownership', () => {
    it('repeated loads release repeated and nested source acquisitions while keeping expanded entities alive', async () => {
        const { world, assets, scene, options, unloaded } = harness();
        const original = JSON.stringify(scene);
        for (let i = 0; i < 6; i++) {
            const spawned = await loadSceneWithAssets(world, scene, options);
            expect(spawned.size).toBe(4);
            expect(world.findEntityByName('Leaf')).not.toBeNull();
            expect(assets.sizes().refRows).toBe(0);
            for (const entity of spawned.values()) if (world.valid(entity)) world.despawn(entity);
        }
        expect(JSON.stringify(scene)).toBe(original);
        expect(unloaded).toHaveBeenCalledTimes(12);
    });

    it('releases only the expansion receipts when another owner holds the same source', async () => {
        const { world, assets, scene, options, unloaded } = harness();
        const held = await assets.acquireTyped<PrefabResult>('prefab', 'tree.esprefab');
        await loadSceneWithAssets(world, scene, options);
        expect(assets.sizes().refRows).toBe(1);
        expect(unloaded).toHaveBeenCalledTimes(1); // nested source only
        const second = await assets.acquireTyped<PrefabResult>('prefab', 'tree.esprefab');
        expect(second.value).toBe(held.value);
        second.release();
        held.release();
        expect(assets.sizes().refRows).toBe(0);
        expect(unloaded).toHaveBeenCalledTimes(2);
    });

    it('releases a skipped instance whose nested source cannot be loaded', async () => {
        const { world, assets, scene, options, unloaded } = harness(true);
        const spawned = await loadSceneWithAssets(world, scene, options);
        expect(spawned.size).toBe(0);
        expect(assets.sizes().refRows).toBe(0);
        expect(unloaded).toHaveBeenCalledTimes(1);
    });

    it('does not leave source receipts behind when a phase observer aborts the load', async () => {
        const { world, assets, scene, options, unloaded } = harness();
        await expect(loadSceneWithAssets(world, scene, {
            ...options,
            onPhase: phase => { if (phase === 'prefab') throw new Error('cancelled'); },
        })).rejects.toThrow('cancelled');
        expect(assets.sizes().refRows).toBe(0);
        expect(unloaded).toHaveBeenCalledTimes(2);
        expect(world.getAllEntities()).toHaveLength(0);
    });
});
