// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/Assets';
import { Assets as AssetResource } from '../src/asset/AssetPlugin';
import { defineComponent } from '../src/ecs/component';
import { spawnPrepared } from '../src/prefab/preparedPrefab';
import { loadSceneWithAssets } from '../src/scene/scene';
import { loadRuntimeScene, prepareRuntimeScene, publishRuntimeScene } from '../src/runtime/runtimeLoader';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import { SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import { parseTerrainLayer, TerrainLayerAssetLoader, type TerrainLayerDef } from '../src/terrain/layers';
import { readAndPackLayers } from '../src/terrain/layerArrays';
import { Terrain } from '../src/terrain/terrainPlugin';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const docRef = '@uuid:7dea3412-5558-417e-87c7-c07cbad9bef9';
const docPath = 'data/dialogue.json';

describe.skipIf(!HAS_WASM)('registered component dependencies', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    function realm() {
        const app = App.new(), world = app.world;
        app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
        const sources = defineComponent('DialogueLibrary', { files: [] as string[] }, {
            discoverAssets: data => (data.files as string[]).map(path => ({ type: 'dialogue-bank', path })),
        });
        const actor = { name: 'Reader', parent: null, children: [], visible: true, components: [
            { type: sources._name, data: { files: [docRef, docPath] } },
        ] };
        const scene = { version: '1.0', name: 'Library', entities: [{ id: 1, ...actor }, { id: 2, ...structuredClone(actor), name: 'Visitor' }] };
        const fetchText = vi.fn(async (path: string) => {
            if (path === 'reader.esprefab') return JSON.stringify({ version: '2', name: 'Reader', rootEntityId: 'root',
                entities: [{ prefabEntityId: 'root', ...actor }] });
            if (path === docPath) return '{"line":"hello"}';
            if (path.endsWith('.esterrainlayer')) return '{"tile":12,"roughness":0.4}';
            throw new Error('missing file ' + path);
        });
        const assets = Assets.create({ module: core, backend: { resolveUrl: path => path, fetchText, fetchBinary: async () => new ArrayBuffer(0) } });
        const unload = vi.fn();
        assets.register({ type: 'dialogue-bank', extensions: [], load: async (path, ctx) => JSON.parse(await ctx.loadText(path)), unload });
        assets.setAssetRefResolver(ref => ref === docRef ? docPath : ref);
        app.insertResource(AssetResource, assets);
        return { app, world, assets, sources, scene, fetchText, unload, close() { assets.releaseAll(); app.quit(); } };
    }

    it('includes project dependencies in progress, errors and per-entity ownership', async () => {
        const { assets, scene, fetchText, unload, close } = realm();
        scene.entities[1]!.components[0]!.data.files.push('data/missing.json');
        const progress = vi.fn();
        try {
            const result = await assets.preloadSceneAssets(scene, progress, { entityOwnership: true, maxConcurrent: 1 });
            try {
                expect(fetchText.mock.calls.map(([path]) => path)).toEqual([docPath, 'data/missing.json']);
                expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
                expect(result.timings['dialogue-bank']?.count).toBe(2);
                expect(result.missing).toEqual([expect.objectContaining({ ref: 'data/missing.json', type: 'dialogue-bank', reason: 'load-failed' })]);
                expect(result.acquisitions).toHaveLength(1);
                expect(result.acquisitions![0]!.auxiliaryEntityIds).toEqual(new Set([1, 2]));
            } finally { result.scope.releaseAll(); }
            expect(unload).toHaveBeenCalledTimes(1);
        } finally { close(); }
    });

    it.each(['persistent', 'adopted', 'standalone', 'prepared'])('keeps a nested project dependency for its %s owner', async mode => {
        const { app, world, assets, scene, fetchText, unload, close } = realm();
        try {
            let reader: Entity;
            if (mode === 'prepared') {
                const recipe = await assets.preparePrefab('reader.esprefab');
                try { reader = spawnPrepared(world, recipe).root; } finally { recipe.release(); }
            } else if (mode === 'standalone') {
                const actors = await loadSceneWithAssets(world, scene, { assets, abortOnMissingAssets: true });
                reader = actors.get(1)!;
                world.despawn(actors.get(2)!);
            } else {
                const manager = new SceneManagerState(app);
                manager.register({ name: 'library', data: scene });
                manager.register({ name: 'next' });
                const room = await manager.loadAdditive('library');
                reader = world.findEntityByName('Reader')!;
                if (mode === 'persistent') room.setPersistent(reader, true);
                else (await manager.loadAdditive('next')).adopt(reader);
                await manager.unload('library');
            }
            expect(world.valid(reader)).toBe(true);
            expect(assets.entityScopes.scopeFor(reader, world)?.size).toBe(1);
            const held = await assets.acquireTyped<{ line: string }>('dialogue-bank', docRef);
            try { expect(held.value.line).toBe('hello'); } finally { held.release(); }
            expect(fetchText.mock.calls.filter(([path]) => path === docPath)).toHaveLength(1);
            expect(unload).not.toHaveBeenCalled();
            world.despawn(reader);
            expect(unload).toHaveBeenCalledOnce();
            expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
        } finally { close(); }
    });

    it('rolls back successful peers before a strict scene with a missing document can spawn', async () => {
        const { assets, scene, world, unload, close } = realm();
        scene.entities[1]!.components[0]!.data.files.push('missing.json');
        const count = world.entityCount();
        try {
            await expect(loadSceneWithAssets(world, scene, { assets, abortOnMissingAssets: true })).rejects.toMatchObject({
                missing: [expect.objectContaining({ type: 'dialogue-bank', ref: 'missing.json' })],
            });
            expect(world.entityCount()).toBe(count);
            expect(unload).toHaveBeenCalledOnce();
            expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
        } finally { close(); }
    });

    it('keeps an independent nested JSON document when the last scalar field is removed', async () => {
        const { app, world, scene, assets, fetchText, close } = realm();
        const field = defineComponent('DialogueTable', { table: '' }, { assetFields: [{ field: 'table', type: 'json' }] });
        const nested = defineComponent('ExtraTables', { extra: '' }, { discoverAssets: data => [{ type: 'json', path: data.extra as string }] });
        const data = { ...scene, entities: scene.entities.map((row, i) => ({ ...row, components: [
            { type: field._name, data: { table: docRef } }, ...(i ? [] : [{ type: nested._name, data: { extra: docPath } }]),
        ] })) };
        const manager = new SceneManagerState(app);
        manager.register({ name: 'library', data });
        try {
            const room = await manager.loadAdditive('library');
            const a = world.findEntityByName('Reader')!, b = world.findEntityByName('Visitor')!;
            expect(assets.entityScopes.scopeFor(a, world)?.size ?? 0).toBe(0);
            room.setPersistent(a, true); room.setPersistent(b, true);
            await manager.unload('library');
            expect(world.get(a, field).table).toBe(docRef);
            world.remove(a, field); world.remove(b, field);
            await Promise.resolve();
            expect(assets.entityScopes.scopeFor(b, world)?.size ?? 0).toBe(0);
            expect(assets.entityScopes.scopeFor(a, world)?.size).toBe(1);
            expect(fetchText).toHaveBeenCalledOnce();
            world.despawn(a); world.despawn(b);
            expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
        } finally { close(); }
    });

    it.each(['managed', 'attach-later', 'standalone'] as const)('keeps a prepared scene dependency through %s publication', async mode => {
        const { app, world, scene, assets: initial, close } = realm();
        const options = { app, module: core, source: { backend: initial.backend,
            resolveRef: (ref: string) => ref === docRef ? docPath : ref,
            decodePixels: async () => { throw new Error('unexpected image read'); } } };
        await loadRuntimeScene({ ...options, sceneData: { ...scene, entities: [] } });
        const assets = app.getResource(AssetResource);
        const unload = vi.fn();
        assets.register({ type: 'dialogue-bank', extensions: [], load: async (path, ctx) => JSON.parse(await ctx.loadText(path)), unload });
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const settings = { ...options, sceneName: 'packaged', sceneData: scene };
        try {
            if (mode === 'standalone') {
                const prepared = await prepareRuntimeScene(settings, true);
                await publishRuntimeScene(prepared, { context: null });
                world.despawn(world.findEntityByName('Visitor')!);
            } else {
                const prepared = mode === 'attach-later' ? await prepareRuntimeScene(settings) : undefined;
                manager.register({ name: 'packaged', setup: ctx => prepared
                    ? publishRuntimeScene(prepared, { context: ctx }) : loadRuntimeScene(settings) });
                const room = await manager.loadAdditive('packaged');
                room.setPersistent(world.findEntityByName('Reader')!, true);
                await manager.unload('packaged');
            }
            const reader = world.findEntityByName('Reader')!;
            expect(assets.entityScopes.scopeFor(reader, world)?.size).toBe(1);
            expect(unload).not.toHaveBeenCalled();
            world.despawn(reader);
            expect(unload).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); close(); }
    });

    it.each(['local', 'lazy', 'remote'] as const)('publishes two %s registry names sharing bytes and releases them separately', async mode => {
        const { scene, assets, world, close } = realm();
        const first = '7dea3412-5558-417e-87c7-c07cbad9bef9', second = '9c2d91ec-af0a-4ef4-b77d-1fabb402a9c8';
        const record = (address: string) => ({ type: 'json', address, path: docPath, labels: [], size: 16 });
        const manifest: AddressableManifest = { version: '2.0', groups: { data: { bundleMode: mode, labels: [], assets: {
            [first]: record('first.json'), [second]: record('second.json'),
        } } } };
        assets.setManifest(manifest);
        assets.setAssetRefResolver(ref => ref === docPath || [first, second, '@uuid:' + first, '@uuid:' + second, 'first.json', 'second.json'].includes(ref) ? docPath : ref);
        const prepare = vi.fn(async () => { const value = {}; return { value, published: value }; });
        assets.register({ type: 'dialogue-bank', extensions: [], registry: { prepare } });
        scene.entities[0]!.components[0]!.data.files = ['@uuid:' + first, 'first.json'];
        scene.entities[1]!.components[0]!.data.files = ['@uuid:' + second, 'second.json'];
        try {
            const progress = vi.fn();
            const actors = await loadSceneWithAssets(world, scene, { assets, abortOnMissingAssets: true, onProgress: progress });
            const a = assets.resolveRegistryAsset('dialogue-bank', '@uuid:' + first);
            const b = assets.resolveRegistryAsset('dialogue-bank', 'second.json');
            expect(a).toBeDefined(); expect(b).toBeDefined(); expect(a).not.toBe(b);
            expect(prepare).toHaveBeenCalledTimes(2);
            expect(progress).toHaveBeenLastCalledWith(2, 2);
            assets.invalidate('@uuid:' + first);
            await vi.waitFor(() => expect(assets.resolveRegistryAsset('dialogue-bank', 'first.json')).not.toBe(a));
            expect(assets.resolveRegistryAsset('dialogue-bank', 'second.json')).toBe(b);
            world.despawn(actors.get(1)!);
            expect(assets.resolveRegistryAsset('dialogue-bank', 'first.json')).toBeUndefined();
            expect(assets.resolveRegistryAsset('dialogue-bank', '@uuid:' + second)).toBe(b);
            world.despawn(actors.get(2)!);
            expect(assets.sizes().registrySlots).toBe(0);
        } finally { close(); }
    });

    it('publishes the same registry records through groups, labels and explicit refs', async () => {
        const { assets, close } = realm();
        const first = '7dea3412-5558-417e-87c7-c07cbad9bef9', second = '9c2d91ec-af0a-4ef4-b77d-1fabb402a9c8';
        const record = { type: 'dialogue-bank', path: docPath, labels: ['dialogue'], size: 16 };
        assets.setManifest({ version: '2.0', groups: { chapter: { bundleMode: 'local', labels: [], assets: {
            [first]: record, [second]: { ...record, address: 'other.json' },
        } } } });
        assets.register({ type: 'dialogue-bank', extensions: [], registry: { async prepare(path, ctx) {
            const value = JSON.parse(await ctx.loadText(path));
            return { value, published: value };
        } } });
        try {
            const group = await assets.loadGroup('chapter'), label = await assets.loadByLabel('dialogue');
            try {
                expect(group.failed).toEqual([]); expect(label.failed).toEqual([]);
                const a = assets.resolveRegistryAsset('dialogue-bank', '@uuid:' + first);
                const b = assets.resolveRegistryAsset('dialogue-bank', '@uuid:' + second);
                expect(a).toEqual({ line: 'hello' }); expect(b).toEqual(a); expect(b).not.toBe(a);
                const refs = ['@uuid:' + first, '@uuid:' + second];
                expect((await assets.preload(refs)).failed).toEqual([]);
                group.release(); label.release();
                expect(assets.resolveRegistryAsset('dialogue-bank', 'other.json')).toBe(b);
                for (const ref of refs) assets.releaseTyped('dialogue-bank', ref);
                expect(assets.sizes().registrySlots).toBe(0);
            } finally { group.release(); label.release(); }
        } finally { close(); }
    });

    it('leaves streamed resources to the host and reports an absent component loader', async () => {
        const { assets, scene, fetchText, close } = realm();
        const component = defineComponent('StreamedReferences', {}, {
            discoverAssets: () => [{ type: 'video', path: 'intro.mp4' }, { type: 'missing-loader', path: 'entry.data' }],
        });
        try {
            const result = await assets.preloadSceneAssets({ ...scene, entities: [
                { ...scene.entities[0]!, components: [{ type: component._name, data: {} }] },
            ] });
            try {
                expect(result.missing).toEqual([expect.objectContaining({ type: 'missing-loader', ref: 'entry.data' })]);
                expect(fetchText).not.toHaveBeenCalled();
            } finally { result.scope.releaseAll(); }
        } finally { close(); }
    });

    it('keeps a repeated dependency from a list in the same component as its scalar field', async () => {
        const { assets, scene, world, close } = realm();
        const component = defineComponent('Chapter', { table: '', files: [] as string[] }, {
            assetFields: [{ field: 'table', type: 'json' }],
            discoverAssets: data => [data.table as string, ...(data.files as string[])].map(path => ({ type: 'json', path })),
        });
        const data = { ...scene, entities: [{ ...scene.entities[0]!, components: [
            { type: component._name, data: { table: docRef, files: [docRef] } },
        ] }] };
        try {
            const actors = await loadSceneWithAssets(world, data, { assets });
            const reader = actors.get(1)!;
            world.insert(reader, component, { table: '', files: [docRef] });
            await Promise.resolve();
            expect(assets.entityScopes.scopeFor(reader, world)?.size).toBe(1);
            world.despawn(reader);
            expect(assets.sizes().refRows).toBe(0);
        } finally { close(); }
    });

    it('finishes terrain packing while its definition is live and returns a late read after failure', async () => {
        const { app, assets, close } = realm();
        let finish!: (value: TerrainLayerDef) => void;
        const late = new Promise<TerrainLayerDef>(resolve => { finish = resolve; });
        const unload = vi.fn((value: TerrainLayerDef) => { value.tile = 0; });
        assets.register({ type: 'terrain-layer', extensions: [], unload, load: async path => {
            if (path === 'late') return late;
            if (path === 'missing') throw new Error('missing layer');
            return parseTerrainLayer({ tile: 8 });
        } });
        try {
            expect((await readAndPackLayers(app, ['ok'], 4)).tiles).toEqual([8]);
            await expect(readAndPackLayers(app, ['late', 'missing'], 4)).rejects.toThrow('missing layer');
            finish(parseTerrainLayer({ tile: 4 }));
            await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(2));
            expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
        } finally { finish(parseTerrainLayer({ tile: 4 })); close(); }
    });

    it('shares the loaded terrain layer with packing and gives every packing read back', async () => {
        const { app, assets, fetchText, close } = realm();
        const layer = 'terrain/grass.esterrainlayer';
        assets.register(new TerrainLayerAssetLoader());
        try {
            const result = await assets.preloadSceneAssets({ version: '1.0', name: 'Ground', entities: [
                { id: 3, name: 'Ground', parent: null, children: [], components: [{ type: Terrain._name, data: { layers: [layer] } }] },
            ] });
            try {
                expect(result.acquisitions?.map(a => a.type)).toEqual(['terrain-layer']);
                for (let i = 0; i < 3; i++) {
                    const packed = await readAndPackLayers(app, [layer], 4);
                    expect(packed.tiles).toEqual([12]);
                    expect(assets.sizes().refRows).toBe(1);
                }
                expect(fetchText).toHaveBeenCalledOnce();
            } finally { result.scope.releaseAll(); }
            expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
        } finally { close(); }
    });
});
