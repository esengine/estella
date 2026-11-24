// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AssetScope, scopeFieldLease } from '../src/asset/AssetLease';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { EntityAssetScopes } from '../src/asset/entityAssetScopes';
import type { PrefabResult } from '../src/asset/AssetLoader';
import { AudioAPI } from '../src/audio/Audio';
import { AudioSource } from '../src/audio/AudioComponents';
import { EmbeddedBackend } from '../src/asset/Backend';
import { NullAudioBackend } from '../src/audio/NullAudioBackend';
import { Breakable } from '../src/breakable/breakable';
import { PrefabServer } from '../src/prefab/prefabServer';
import { spawnPrepared } from '../src/prefab/preparedPrefab';
import { loadSceneWithAssets } from '../src/scene/scene';
import { UITooltip } from '../src/ui/behavior/tooltip';
import { SceneManagerState } from '../src/scene/sceneManager';
import type { Entity } from '../src/types';
import type { CppResourceManager, ESEngineModule } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const clip = '@uuid:10321bd3-c71c-40ce-a009-4c899233033e';
const pieces = '@uuid:5c0137a5-614d-43dc-b560-37df83c07c71';
const clipPath = 'audio/crack.wav', piecesPath = 'prefabs/pieces.esprefab';

describe.skipIf(!HAS_WASM)('scene ownership of file-backed component references', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });
    function realm() {
        const app = App.new(), device = new NullAudioBackend(), audio = new AudioAPI(device);
        app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
        let nextBuffer = 0;
        vi.spyOn(device, 'loadBuffer').mockImplementation(async () => ({ id: ++nextBuffer, bytes: 64, duration: 1 }));
        audio.setBufferBudget(0);
        const prefab = { version: '2', name: 'Pieces', rootEntityId: 'root', entities: [
            { prefabEntityId: 'root', name: 'Piece', parent: null, children: [], visible: true, components: [] },
        ] };
        const fetchText = vi.fn(async (_path: string) => JSON.stringify(prefab));
        const assets = Assets.create({ module: core, getAudio: () => audio, backend: {
            resolveUrl: path => path, fetchBinary: async () => new ArrayBuffer(8), fetchText,
        } });
        assets.setAssetRefResolver(ref => ref === clip ? clipPath : ref === pieces ? piecesPath : ref);
        app.insertResource(AssetsResource, assets);
        const manager = new SceneManagerState(app);
        return { app, assets, manager, audio, device, fetchText, prefab, dispose() {
            assets.releaseAll(); app.quit(); audio.dispose();
        } };
    }

    it.each(['audio', 'prefab'] as const)('keeps the loaded %s usable after the entity leaves its scene', async type => {
        const { app, assets, manager, audio, device, fetchText, dispose } = realm();
        let actor!: Entity;
        manager.register({ name: 'room', async setup(ctx) {
            const scope = new AssetScope();
            scope.add(await assets.acquireTyped(type, type === 'audio' ? clip : piecesPath));
            ctx.trackAssetScope(scope);
            actor = ctx.spawn();
            if (type === 'audio') app.world.insert(actor, AudioSource, { clip, spatial: true });
            else app.world.insert(actor, Breakable, { pieces });
            ctx.setPersistent(actor, true);
        } });
        try {
            await manager.load('room');
            const before = audio.getBufferHandle(clip);
            await manager.unload('room');
            expect(app.world.valid(actor)).toBe(true);
            if (type === 'audio') {
                expect(before).toBeDefined();
                expect(audio.getBufferHandle(app.world.get(actor, AudioSource).clip)).toBe(before);
                expect(device.loadBuffer).toHaveBeenCalledOnce();
                app.world.remove(actor, AudioSource);
            } else {
                const server = new PrefabServer(app.world, () => assets);
                const instance = await server.instantiate(app.world.get(actor, Breakable).pieces);
                expect(app.world.valid(instance.root)).toBe(true);
                expect(fetchText).toHaveBeenCalledOnce();
                app.world.remove(actor, Breakable);
            }
            await Promise.resolve();
            expect(assets.sizes().refRows).toBe(0);
            expect(audio.getBufferStats().bufferCount).toBe(0);
            expect(app.world.valid(actor)).toBe(true);
        } finally { dispose(); }
    });

    it.each(['standalone scene', 'standalone scope', 'prepared prefab'])('releases each live field in a %s when its last user leaves', async publication => {
        const { app, assets, audio, fetchText, prefab, dispose } = realm();
        const world = app.world;
        const actor = { name: 'Actor', parent: null, children: [], visible: true, components: [
            { type: AudioSource._name, data: { clip } }, { type: Breakable._name, data: { pieces } },
            { type: UITooltip._name, data: { stylePrefab: piecesPath } },
        ] };
        fetchText.mockImplementation(async path => JSON.stringify(path === 'actor.esprefab'
            ? { version: '2', name: 'Actor', rootEntityId: 'actor', entities: [{ prefabEntityId: 'actor', ...actor }] }
            : prefab));
        if (publication === 'standalone scope') vi.spyOn(assets, 'entityScopes', 'get').mockReturnValue(new EntityAssetScopes());
        try {
            let first: Entity, second: Entity;
            if (publication === 'prepared prefab') {
                const recipe = await assets.preparePrefab('actor.esprefab');
                try { first = spawnPrepared(world, recipe).root; second = spawnPrepared(world, recipe).root; }
                finally { recipe.release(); }
            } else {
                const scene = await loadSceneWithAssets(world, { version: '1.0', name: 'Actors',
                    entities: [{ id: 1, ...actor }, { id: 2, ...actor }] }, { assets, abortOnMissingAssets: true });
                first = scene.get(1)!; second = scene.get(2)!;
            }
            const firstScope = assets.entityScopes.scopeFor(first, world)!;
            const secondScope = assets.entityScopes.scopeFor(second, world)!;
            expect([firstScope.size, secondScope.size]).toEqual([2, 2]);
            const explicit = firstScope.add(await assets.acquireTyped<PrefabResult>('prefab', piecesPath));
            world.remove(first, AudioSource);
            world.remove(first, Breakable);
            world.remove(first, UITooltip);
            world.remove(second, Breakable);
            world.update(second, UITooltip, d => { d.stylePrefab = pieces; });
            world.update(second, AudioSource, d => { d.clip = ''; });
            world.update(second, AudioSource, d => { d.clip = clip; });
            await Promise.resolve();
            expect(firstScope.leases()).toEqual([explicit]);
            expect(secondScope.size).toBe(2);
            expect(audio.getBufferHandle(clip)).toBeDefined();
            world.remove(second, UITooltip);
            world.remove(second, AudioSource);
            await Promise.resolve();
            expect(secondScope.size).toBe(0);
            expect(audio.getBufferStats().bufferCount).toBe(0);
            const current = await assets.acquireTyped<PrefabResult>('prefab', pieces);
            try { expect(current.value).toBe(explicit.value); } finally { current.release(); }
            expect(fetchText.mock.calls.filter(([path]) => path === piecesPath)).toHaveLength(1);
            firstScope.releaseAll();
            expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
            expect(world.valid(first) && world.valid(second)).toBe(true);
        } finally { dispose(); }
    });

    it.each(['audio', 'prefab'] as const)('selects the current %s preparation when an older receipt has the same name', async type => {
        const { assets, dispose } = realm(), scope = new AssetScope();
        const ref = type === 'audio' ? clip : pieces, file = type === 'audio' ? clipPath : piecesPath;
        try {
            const old = scope.add(await assets.acquireTyped(type, ref));
            assets.invalidate(file);
            await assets.assetGraphSettled();
            const fresh = scope.add(await assets.acquireTyped(type, ref));
            expect(fresh.generation).not.toBe(old.generation);
            for (let pass = 0; pass < 2; pass++) expect(assets.leaseForBinding(scope, type, ref)).toBe(fresh);
            expect(scopeFieldLease(scope, type, ref)).toBe(fresh);
            expect(scope.forget(fresh)).toBe(true);
            fresh.release();
            expect(assets.leaseForBinding(scope, type, ref)).toBeUndefined();
            expect(scopeFieldLease(scope, type, ref)).toBeUndefined();
            const split = old.retain()!;
            try { expect(split.value).toBe(old.value); } finally { split.release(); }
        } finally { scope.releaseAll(); dispose(); }
    });

    it('transfers a path-only prefab acquisition after its entity switches to a UUID', async () => {
        const { assets, fetchText, dispose } = realm(), scope = new AssetScope();
        try {
            const value = await assets.loadPrefab(piecesPath);
            expect(assets.takeTrackedAsset('prefab', piecesPath, scope)).toBe(true);
            expect(assets.leaseForBinding(scope, 'prefab', pieces)?.value).toBe(value);
            expect(fetchText).toHaveBeenCalledOnce();
            scope.releaseAll();
            expect(assets.sizes().refRows).toBe(0);
        } finally { scope.releaseAll(); dispose(); }
    });
});

it('loads data before graphics initialization and requires a pool only when a loader uses it', async () => {
    const assets = Assets.create({ module: null, backend: {
        resolveUrl: path => path, fetchBinary: async () => new ArrayBuffer(0), fetchText: async () => '{"volume":0.75}',
    } });
    const pool = { getTextureGLId: () => 17 } as unknown as CppResourceManager;
    assets.register({ type: 'render-id', extensions: [], load: async (_path, ctx) => ctx.resourceManager.getTextureGLId(1) });
    try {
        expect((await assets.loadJson('audio-settings.json')).data).toEqual({ volume: 0.75 });
        await expect(assets.acquireTyped('render-id', 'ui-icon')).rejects.toThrow('ResourceManager not initialized');
        initResourceManager(pool);
        assets.invalidate('ui-icon');
        const icon = await assets.acquireTyped('render-id', 'ui-icon');
        try { expect(icon.value).toBe(17); } finally { icon.release(); }
    } finally { assets.releaseAll(); shutdownResourceManager(); }
});

it('keeps a source document’s data separate from native handles of the same loader type', async () => {
    const assets = Assets.create({ module: null, backend: new EmbeddedBackend({}) });
    const scope = new AssetScope();
    try {
        assets.register({ type: 'project-file', extensions: [], fieldBinding: 'source', load: async () => ({ handle: 7 }) });
        const source = scope.add(await assets.acquireTyped('project-file', 'map.json'));
        expect(assets.leaseForBinding(scope, 'project-file', 'map.json')).toBe(source);
        expect(assets.leaseForBinding(scope, 'project-file', 7)).toBeUndefined();
        expect(assets.pathForHandle('project-file', 7)).toBeNull();
        assets.register({ type: 'project-file', extensions: [], load: async () => ({ handle: 7 }) });
        const native = scope.add(await assets.acquireTyped('project-file', 'mesh.bin'));
        expect(assets.leaseForBinding(scope, 'project-file', 'map.json')).toBe(source);
        expect(assets.leaseForBinding(scope, 'project-file', 7)).toBe(native);
        scope.forget(source);
        source.release();
        expect(assets.pathForHandle('project-file', 7)).toBe('mesh.bin');
    } finally { scope.releaseAll(); assets.releaseAll(); }
});
