// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { loadSceneWithAssets, serializeScene, type SceneData } from '../src/scene/scene';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { EmbeddedBackend } from '../src/asset/Backend';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { App } from '../src/app/app';
import { registerPhysics2DSupport } from '../src/physics/physicsSupport';
import { createRuntimeSceneConfig, loadRuntimeScene, prepareRuntimeScene, publishRuntimeScene } from '../src/runtime/runtimeLoader';
import { SceneLoadCancelled, SceneManager, SceneManagerState, type SceneConfig } from '../src/scene/sceneManager';
import { bakesOf } from '../src/runtime/bakes';
import { spawnPrepared } from '../src/prefab/preparedPrefab';
import { defineComponent, Disabled, MeshRenderer, Parent, Sprite } from '../src/ecs/component';
import { connectFakeCpp } from './helpers/fakeEngine';
import type { ESEngineModule } from '../src/wasm';

const setTextureMetadata = vi.hoisted(() => vi.fn());
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: () => false, setTextureMetadata }),
    getResourceManager: () => null, evictTextureDimensions: vi.fn(),
}));

const scene: SceneData = { version: 4, name: 'publication', entities: [{ id: 1, name: 'new', parent: null,
    children: [], components: [{ type: 'MeshRenderer', data: { mesh: 'mesh.esmesh' } }],
}] };

async function runtime() {
    const app = App.new();
    const options = { app, module: null, source: { backend: new EmbeddedBackend({}),
        decodePixels: async () => { throw new Error('unexpected image read'); } } };
    await loadRuntimeScene({ ...options, sceneData: { ...scene, entities: [] } });
    const assets = app.getResource(AssetsResource);
    const unloaded = vi.fn();
    assets.register({ type: 'mesh', extensions: ['.esmesh'], load: async () => ({ handle: 7 }), unload: unloaded });
    return { app, options, assets, unloaded };
}

function barrier() {
    let open!: () => void;
    const promise = new Promise<void>(resolve => { open = resolve; });
    return { open, promise };
}

it.each(['discarded', 'timed out', 'completed'] as const)('reports shader readiness for a %s scene check', async mode => {
    const { app, options, assets } = await runtime();
    const heap = new Uint32Array(64);
    let next = 4, compiling = 1;
    const queued = vi.fn(() => compiling);
    const module = {
        HEAPU32: heap,
        _malloc: (size: number) => { const address = next; next += size; return address; },
        _free() {},
        engine_prepareMeshPrograms: (_rows: number, _count: number, out: number) => { heap[out >> 2] = 1; },
        renderer_getPendingShaders: queued,
    } as unknown as ESEngineModule;
    const config = createRuntimeSceneConfig('cell', scene, { ...options, module });
    await config.prepare!();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const settled = vi.fn();
    const checking = config.readyRenderPrograms!().then(settled);
    try {
        await vi.advanceTimersByTimeAsync(0);
        expect(queued).toHaveBeenCalledTimes(1);
        if (mode === 'discarded') {
            config.discardPrepared!();
            await vi.advanceTimersByTimeAsync(0);
            expect(settled).toHaveBeenCalledWith({ applicable: false });
            await vi.advanceTimersByTimeAsync(24);
            expect(queued).toHaveBeenCalledTimes(1);
        } else if (mode === 'timed out') {
            await vi.advanceTimersByTimeAsync(30_016);
            expect(settled).toHaveBeenCalledWith({ applicable: true, stamp: null });
        } else {
            compiling = 0;
            await vi.advanceTimersByTimeAsync(8);
            expect(settled).toHaveBeenCalledWith({ applicable: true, stamp: { digestLo: 0, digestHi: 0, programEpoch: 0 } });
        }
    } finally {
        config.discardPrepared!();
        compiling = 0;
        await vi.advanceTimersByTimeAsync(40);
        vi.useRealTimers();
        await checking;
        assets.releaseAll();
        app.quit();
    }
});

it('only submits mesh programs for entities that the prepared scene can spawn', async () => {
    const { app, options, assets } = await runtime();
    const hidden: SceneData['entities'] = Array.from({ length: 512 }, (_, i) => ({
        ...scene.entities[0]!, id: i + 2, visible: false,
        components: [{ type: 'MeshRenderer', data: { mesh: 1000 + i, lit: true } }],
    }));
    const heap = new Uint32Array(4096);
    let next = 4;
    const programs = vi.fn((rows: number, count: number, out: number) => {
        expect(count).toBe(1);
        heap[out >> 2] = 1;
        expect(Array.from(heap.subarray(rows >> 2, (rows >> 2) + count * 5))).toEqual([7, 0, 0, 0, 0]);
    });
    const module = {
        HEAPU32: heap,
        _malloc: (size: number) => { const address = next; next += size; return address; },
        _free() {},
        engine_prepareMeshPrograms: programs,
    } as unknown as ESEngineModule;
    const config = createRuntimeSceneConfig('visible', { ...scene, entities: [...scene.entities, ...hidden] }, { ...options, module });
    try {
        await config.prepare!();
        await expect(config.readyRenderPrograms!()).resolves.toMatchObject({ applicable: true });
        expect(programs).toHaveBeenCalledWith(expect.any(Number), 1, expect.any(Number));
    } finally { config.discardPrepared!(); assets.releaseAll(); app.quit(); }
});

describe('scene-owned physics preparation', () => {
    it('keeps the solver out of the world when the scene rejects its asset handoff', async () => {
        registerPhysics2DSupport();
        const { app, options, assets, unloaded } = await runtime();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        app.setSideModules({ acquire: async () => ({}) });
        const install = vi.spyOn(app, 'addPlugin').mockImplementation(() => app);
        const failure = new Error('ownership transfer failed');
        manager.register({ name: 'cell', setup: ctx => {
            vi.spyOn(ctx, 'trackAssetScope').mockImplementation(() => { throw failure; });
            return loadRuntimeScene({ ...options, sceneName: 'cell', sceneData: scene, physicsEnabled: true });
        } });
        try {
            await expect(manager.loadAdditive('cell')).rejects.toBe(failure);
            expect(install).not.toHaveBeenCalled();
            expect(app.world.getAllEntities()).toHaveLength(0);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['prefetch', 'adopted prefetch', 'direct named load'])('releases the %s and its mesh while its module is pending', async entry => {
        registerPhysics2DSupport();
        const { app, options, assets, unloaded } = await runtime();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const reading = barrier(), finish = barrier(), setup = barrier();
        app.setSideModules({ acquire: async () => { reading.open(); await finish.promise; return null; } });
        const data = { ...scene, entities: [{ ...scene.entities[0]!, components: [
            ...scene.entities[0]!.components, { type: 'RigidBody2D', data: {} },
        ] }] };
        const config = createRuntimeSceneConfig('cell', data, options);
        const populate = config.setup!;
        config.setup = ctx => {
            setup.open();
            return entry === 'direct named load' ? loadRuntimeScene({ ...options, sceneName: 'cell', sceneData: data }) : populate(ctx);
        };
        manager.register(config);
        const stopped = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(SceneLoadCancelled);
        const work = [];
        try {
            if (entry !== 'direct named load') work.push(stopped(manager.prepare('cell')));
            if (entry === 'adopted prefetch') await reading.promise;
            if (entry !== 'prefetch') {
                work.push(stopped(manager.loadAdditive('cell')));
                await setup.promise;
            }
            await reading.promise;
            expect(assets.sizes().refRows).toBe(1);
            if (entry === 'prefetch') {
                expect(manager.discardPrepared('cell')).toBe(1);
                expect(manager.discardPrepared('cell')).toBe(0);
            } else {
                const signal = manager.getScene('cell')!.signal!;
                expect(signal.aborted).toBe(false);
                await manager.unload('cell');
                expect(signal.reason).toBeInstanceOf(SceneLoadCancelled);
            }
            await Promise.all(work);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
            expect(app.world.getAllEntities()).toHaveLength(0);
        } finally { finish.open(); await Promise.allSettled(work); assets.releaseAll(); app.quit(); }
    });
});

describe('scene asset discovery', () => {
    it('binds only spawned scene rows without touching hidden asset declarations', async () => {
        const { app, assets, options } = await runtime();
        const hidden = { ...scene.entities[0]!, id: 2, name: 'hidden', visible: false, components: [
            { type: 'Sprite', data: { texture: 'hidden.png' } },
            { type: 'MeshRenderer', data: { mesh: 'hidden.esmesh' } },
        ] };
        const data = { ...scene, entities: [...scene.entities, hidden] };
        const resolve = vi.spyOn(assets, 'sceneAssetRef');
        try {
            const prepared = await prepareRuntimeScene({ ...options, sceneData: data });
            expect(prepared.sceneData.entities[0]?.components[0]?.data.mesh).toBe(7);
            expect({ hiddenRefs: resolve.mock.calls.flat().filter(ref => ref.startsWith('hidden.')),
                hiddenComponents: prepared.sceneData.entities[1]?.components })
                .toEqual({ hiddenRefs: [], hiddenComponents: hidden.components });
            await publishRuntimeScene(prepared);
            expect(app.world.findEntityByName('hidden')).toBeNull();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['authored', 'packaged', 'prepared prefab'])('keeps failed texture and mesh refs without loading twice (%s)', async door => {
        const { app, assets, options } = await runtime();
        connectFakeCpp(app.world);
        const texture = vi.spyOn(assets, 'acquireTexture').mockRejectedValue(new Error('texture unavailable'));
        const mesh = vi.fn().mockRejectedValue(new Error('mesh unavailable'));
        assets.register({ type: 'mesh', extensions: ['.esmesh'], load: mesh, unload() {} });
        const lateResolve = vi.fn();
        app.world.setAssetFieldResolver(lateResolve);
        const components = [
            { type: 'Sprite', data: { texture: 'missing.png' } },
            { type: 'MeshRenderer', data: { mesh: 'missing.esmesh' } },
        ];
        const data: SceneData = { ...scene, entities: [{ ...scene.entities[0]!, components }] };
        try {
            if (door === 'authored') await loadSceneWithAssets(app.world, data, { assets });
            else if (door === 'packaged') await loadRuntimeScene({ ...options, sceneData: data });
            else {
                vi.spyOn(assets.backend, 'fetchText').mockResolvedValue(JSON.stringify({
                    version: '2', name: 'Missing assets', rootEntityId: 'root', entities: [{
                        prefabEntityId: 'root', name: 'new', parent: null, children: [], visible: true, components,
                    }],
                }));
                const prefab = await assets.preparePrefab('missing.esprefab');
                try { spawnPrepared(app.world, prefab); } finally { prefab.release(); }
            }
            const entity = app.world.findEntityByName('new')!;
            const snapshot = () => serializeScene(app.world).entities[0]!.components;
            expect(app.world.get(entity, Sprite).texture).toBe(0);
            expect(app.world.get(entity, MeshRenderer).mesh).toBe(0);
            expect(snapshot()).toEqual(expect.arrayContaining(components.map(comp => ({
                type: comp.type, data: expect.objectContaining(comp.data),
            }))));
            expect(texture).toHaveBeenCalledOnce();
            expect(mesh).toHaveBeenCalledOnce();
            expect(lateResolve).not.toHaveBeenCalled();

            app.world.update(entity, Sprite, value => { value.texture = 0; });
            expect(snapshot().find(c => c.type === 'Sprite')?.data.texture).toBe(0);
            expect(snapshot().find(c => c.type === 'MeshRenderer')?.data.mesh).toBe('missing.esmesh');
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['inline', 'lazy', 'prepared document'])('keeps 2D and 3D authored data across scene revisits (%s)', async source => {
        const { app, options, assets, unloaded } = await runtime();
        connectFakeCpp(app.world);
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const authored: SceneData = { ...scene, entities: [
            { ...scene.entities[0]!, name: 'mesh' },
            { id: 2, name: 'sprite', parent: null, children: [], components: [{ type: 'Sprite', data: { size: { x: 32, y: 16 } } }] },
        ] };
        const bytes = JSON.stringify(authored);
        const read = vi.spyOn(assets.backend, 'fetchText').mockResolvedValue(bytes);
        const prepareDocument = source === 'prepared document' ? async () => authored : undefined;
        manager.register(createRuntimeSceneConfig('room', source === 'inline' ? authored : undefined,
            { ...options, prepareDocument }, 'room.esscene'));
        try {
            for (let visit = 0; visit < 2; visit++) {
                if (visit === 0) await manager.prepare('room');
                await manager.load('room');
                const mesh = app.world.findEntityByName('mesh')!;
                const sprite = app.world.findEntityByName('sprite')!;
                expect(app.world.get(mesh, MeshRenderer).mesh).toBe(7);
                expect(app.world.get(sprite, Sprite).size).toEqual({ x: 32, y: 16 });
                await manager.unload('room');
                expect(app.world.getAllEntities()).toEqual([]);
                expect(assets.sizes().refRows).toBe(0);
            }
            expect(read).toHaveBeenCalledTimes(source === 'inline' ? 0 : 2);
            expect(unloaded).toHaveBeenCalledTimes(2);
            expect(JSON.stringify(authored)).toBe(bytes);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['authored', 'packaged'])('uses the same %s declarations for reads and entity lifetimes', async entry => {
        const { app, assets, options, unloaded } = await runtime();
        const seen = new Set<string>();
        const discoverAssets = vi.fn((data: Record<string, unknown>) => {
            const ref = String(data.ref);
            if (seen.has(ref)) return [];
            seen.add(ref);
            return [{ type: 'mesh', path: ref }, { type: 'mesh', path: ref }];
        });
        const type = 'DiscoveryOwner_' + entry;
        defineComponent(type, { ref: '' }, { discoverAssets });
        assets.setAssetRefResolver(ref => ref.startsWith('@uuid:') ? 'shared.esmesh' : ref);
        const data = { ...scene, entities: ['@uuid:a', '@uuid:b', 'only.esmesh'].map((ref, id) => ({
            ...scene.entities[0]!, id, name: 'owner' + id, components: [{ type, data: { ref } }],
        })) };
        try {
            if (entry === 'authored') await loadSceneWithAssets(app.world, data, { assets });
            else await loadRuntimeScene({ ...options, sceneData: data });
            const entities = data.entities.map(row => app.world.findEntityByName(row.name)!);
            expect(entities.map(entity => assets.entityScopes.scopeFor(entity, app.world)?.size)).toEqual([1, 1, 1]);
            expect(discoverAssets).toHaveBeenCalledTimes(3);
            app.world.despawn(entities[0]!);
            expect(unloaded).not.toHaveBeenCalled();
            app.world.despawn(entities[2]!);
            expect(unloaded).toHaveBeenCalledOnce();
            app.world.despawn(entities[1]!);
            expect(unloaded).toHaveBeenCalledTimes(2);
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('preserves every authored spelling while loading a shared path once and reporting missing refs', async () => {
        const { app, assets, options, unloaded } = await runtime();
        const refs = ['@uuid:one', 'shared.esmesh', '@uuid:missing', '@uuid:two'];
        const resolve = (ref: string) => ref === '@uuid:missing' ? null : 'shared.esmesh';
        assets.setAssetRefResolver(resolve);
        const data = { ...scene, entities: refs.map((mesh, id) => ({ ...scene.entities[0]!, id,
            components: [{ type: 'MeshRenderer', data: { mesh } }],
        })) };
        try {
            const ready = await prepareRuntimeScene({ ...options, sceneData: data });
            expect(ready.discovered.byType.get('mesh')).toEqual(new Set(refs));
            expect(ready.assetResult.missing).toEqual([{ ref: '@uuid:missing', reason: 'unresolved' }]);
            expect(ready.assetResult.acquisitions).toHaveLength(1);
            expect(ready.assetResult.acquisitions![0]).toMatchObject({
                type: 'mesh', path: 'shared.esmesh', entityIds: new Set([0, 1, 3]),
            });
            ready.assetResult.scope.releaseAll();
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('reuses declarations from the prefab bake across spawns and releases the last live owner', async () => {
        const { app, assets, unloaded } = await runtime();
        const type = 'DiscoveryOwner_Prefab';
        const discoverAssets = vi.fn(() => [{ type: 'mesh', path: 'shared.esmesh' }]);
        defineComponent(type, {}, { discoverAssets });
        vi.spyOn(assets.backend, 'fetchText').mockResolvedValue(JSON.stringify({
            version: '2', name: 'Shared mesh', rootEntityId: 'root', entities: [{
                prefabEntityId: 'root', name: 'mesh', parent: null, children: [], visible: true,
                components: [{ type, data: {} }],
            }],
        }));
        try {
            const prefab = await assets.preparePrefab('mesh.esprefab');
            const a = spawnPrepared(app.world, prefab), b = spawnPrepared(app.world, prefab);
            prefab.release();
            expect(discoverAssets).toHaveBeenCalledOnce();
            app.world.despawn(a.root);
            expect(unloaded).not.toHaveBeenCalled();
            app.world.despawn(b.root);
            expect(unloaded).toHaveBeenCalledOnce();
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('keeps each animation clip receipt with the entity that names that spelling', async () => {
        const { app, assets } = await runtime();
        const type = 'DiscoveryOwner_Clip';
        defineComponent(type, { clip: '' }, { assetFields: [{ field: 'clip', type: 'anim-clip' }] });
        const canonical = 'idle.esanim';
        assets.setAssetRefResolver(ref => ref === '@uuid:idle' ? canonical : ref);
        assets.register({ type: 'anim-clip', extensions: ['.esanim'], load: async () => ({}), unload() {} });
        const data = { ...scene, entities: ['@uuid:idle', canonical].map((clip, id) => ({
            ...scene.entities[0]!, id, components: [{ type, data: { clip } }],
        })) };
        try {
            const batch = await assets.preloadSceneAssets(data, undefined, { entityOwnership: true });
            try {
                const sources = new Map(batch.acquisitions?.map(a => [a.path, a.entityIds]));
                expect(sources).toEqual(new Map([['@uuid:idle', new Set([0])], [canonical, new Set([1])]]));
            } finally { batch.scope.releaseAll(); }
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('attaches an older preload provider’s receipt keyed by the authored alias', async () => {
        const { app, assets, unloaded } = await runtime();
        const ref = '@uuid:legacy-mesh';
        assets.setAssetRefResolver(raw => raw === ref ? 'mesh.esmesh' : raw);
        const preload = assets.preloadSceneAssets.bind(assets);
        vi.spyOn(assets, 'preloadSceneAssets').mockImplementation(async (data, progress) => {
            const batch = await preload(data, progress);
            return { ...batch, acquisitions: batch.acquisitions?.map(({ type, lease }) => ({ type, path: ref, lease })) };
        });
        try {
            const data = { ...scene, entities: [{ ...scene.entities[0]!,
                components: [{ type: 'MeshRenderer', data: { mesh: ref } }],
            }] };
            const entities = await loadSceneWithAssets(app.world, data, { assets });
            const entity = entities.get(1)!;
            expect(assets.entityScopes.scopeFor(entity, app.world)?.size).toBe(1);
            expect(unloaded).not.toHaveBeenCalled();
            app.world.despawn(entity);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });
});

describe('scene asset progress', () => {
    async function setup(entry: string) {
        const state = await runtime();
        const { app, assets, options } = state, manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const started = barrier(), resume = barrier(), fast = barrier();
        const read = vi.fn(async (path: string) => {
            if (path === 'slow.esmesh') { started.open(); await resume.promise; }
            else await fast.promise;
            return { handle: path === 'slow.esmesh' ? 2 : 1 };
        });
        assets.register({ type: 'mesh', extensions: ['.esmesh'], load: read, unload: state.unloaded });
        const data = { ...scene, entities: ['fast.esmesh', 'slow.esmesh'].map((mesh, id) => ({
            ...scene.entities[0]!, id, components: [{ type: 'MeshRenderer', data: { mesh } }],
        })) };
        manager.register(entry === 'authoring' ? { name: 'cell', data } : createRuntimeSceneConfig('cell', data, options));
        return { ...state, manager, started, resume, fast, read, data };
    }

    it.each(['authoring', 'runtime'])('replays actual %s counts to late and reentrant callers', async entry => {
        const { app, assets, manager, started, resume, fast, read, unloaded } = await setup(entry);
        const joined = vi.fn(), reentrant = vi.fn();
        const first = manager.loadAdditive('cell');
        let nested: ReturnType<typeof manager.load> | undefined;
        try {
            await started.promise;
            const half = barrier();
            const listener = (done: number, total: number) => {
                joined(done, total);
                if (done === 1) { nested = manager.load('cell', reentrant); half.open(); }
            };
            const second = manager.loadAdditive('cell', listener);
            expect(joined.mock.calls).toEqual([[0, 2]]);
            fast.open(); await half.promise;
            expect(reentrant.mock.calls).toEqual([[1, 2]]);
            resume.open();
            const [ctx, other, active] = await Promise.all([first, second, nested]);
            expect(ctx).toBe(other); expect(ctx).toBe(active);
            expect(manager.getActive()).toBe('cell');
            expect(joined.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
            expect(reentrant.mock.calls).toEqual([[1, 2], [2, 2]]);
            expect(read).toHaveBeenCalledTimes(2);
            await manager.unload('cell');
            expect(unloaded).toHaveBeenCalledTimes(2);
        } finally { fast.open(); resume.open(); await first; assets.releaseAll(); app.quit(); }
    });

    it.each(['loading', 'ready'])('hands the %s preparation count to the scene without rereading', async phase => {
        const { app, assets, manager, started, resume, fast, read } = await setup('runtime');
        const prepared = manager.prepare('cell'), progress = vi.fn();
        let loading: ReturnType<typeof manager.load> | undefined;
        try {
            await started.promise;
            if (phase === 'ready') { fast.open(); resume.open(); await prepared; }
            loading = manager.load('cell', progress);
            expect(progress.mock.calls).toEqual(phase === 'ready' ? [[2, 2]] : [[0, 2]]);
            fast.open(); resume.open(); await Promise.all([prepared, loading]);
            expect(progress.mock.calls).toEqual(phase === 'ready' ? [[2, 2]] : [[0, 2], [1, 2], [2, 2]]);
            expect(read).toHaveBeenCalledTimes(2);
            await manager.unload('cell'); expect(assets.sizes().refRows).toBe(0);
        } finally { fast.open(); resume.open(); await Promise.allSettled([prepared, loading]); assets.releaseAll(); app.quit(); }
    });

    it.each(['authoring', 'runtime'])('stops reporting %s reads when the scene is cancelled', async entry => {
        const { app, assets, manager, started, resume, fast, unloaded } = await setup(entry);
        const progress = vi.fn(), failed = expect(manager.load('cell', progress)).rejects.toBeInstanceOf(SceneLoadCancelled);
        try {
            await started.promise; expect(progress.mock.calls).toEqual([[0, 2]]);
            await manager.unload('cell');
            await failed;
            fast.open(); resume.open();
            await vi.waitFor(() => expect(unloaded).toHaveBeenCalledTimes(2));
            expect(progress.mock.calls).toEqual([[0, 2]]);
            expect(assets.sizes().refRows).toBe(0);
        } finally {
            await manager.unload('cell'); fast.open(); resume.open();
            await Promise.allSettled([failed]); assets.releaseAll(); app.quit();
        }
    });

    it('releases a prepared batch when replaying its count throws and can retry', async () => {
        const { app, assets, manager, fast, resume, unloaded } = await setup('runtime');
        const refused = new Error('loading screen rejected progress');
        fast.open(); resume.open();
        try {
            await manager.prepare('cell');
            await expect(manager.load('cell', () => { throw refused; })).rejects.toBe(refused);
            expect(unloaded).toHaveBeenCalledTimes(2); expect(assets.sizes().refRows).toBe(0);
            const progress = vi.fn(); await manager.load('cell', progress);
            expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('keeps an additive load running when a joining listener throws on replay', async () => {
        const { app, assets, manager, started, resume, fast } = await setup('runtime');
        const active = vi.fn(), refused = new Error('join refused');
        const failed = vi.fn(() => { throw refused; });
        const original = manager.loadAdditive('cell', active);
        try {
            await started.promise;
            await expect(manager.load('cell', failed)).rejects.toBe(refused);
            fast.open(); resume.open(); await original;
            expect(failed).toHaveBeenCalledOnce();
            expect(active.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
            expect(manager.getActive()).toBeNull();
        } finally { fast.open(); resume.open(); await original; assets.releaseAll(); app.quit(); }
    });

    it('returns a replay failure promptly and drains preparation receipts when the reads finish', async () => {
        const { app, assets, manager, started, fast, resume, unloaded } = await setup('runtime');
        const refused = new Error('handoff refused');
        const preparation = expect(manager.prepare('cell')).rejects.toBeInstanceOf(SceneLoadCancelled);
        let loading: Promise<unknown> | undefined;
        try {
            await started.promise;
            const rejected = vi.fn();
            loading = manager.load('cell', () => { throw refused; }).catch(rejected);
            await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(refused));
            expect(unloaded).not.toHaveBeenCalled();
            fast.open(); resume.open(); await Promise.all([loading, preparation]);
            await vi.waitFor(() => expect(unloaded).toHaveBeenCalledTimes(2));
            expect(assets.sizes().refRows).toBe(0);
            expect(manager.getLoading()).toEqual([]);
        } finally { fast.open(); resume.open(); await Promise.allSettled([loading, preparation]); assets.releaseAll(); app.quit(); }
    });

    it('reports a direct packaged load inside a custom setup to both observers', async () => {
        const { app, assets, options, manager, data, fast, resume } = await setup('runtime');
        const direct = vi.fn(), caller = vi.fn();
        manager.register({ name: 'cell', setup: () => loadRuntimeScene({
            ...options, sceneName: 'cell', sceneData: data, onProgress: direct,
        }) });
        fast.open(); resume.open();
        try {
            await manager.load('cell', caller);
            expect(caller.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
            expect(direct.mock.calls).toEqual(caller.mock.calls);
            await manager.unload('cell'); expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('detaches both observers of a direct packaged load when its owning setup is cancelled', async () => {
        const { app, assets, options, manager, data, started, fast, resume, unloaded } = await setup('runtime');
        const direct = vi.fn(), caller = vi.fn();
        manager.register({ name: 'cell', setup: () => loadRuntimeScene({
            ...options, sceneName: 'cell', sceneData: data, onProgress: direct,
        }) });
        const failed = expect(manager.load('cell', caller)).rejects.toBeInstanceOf(SceneLoadCancelled);
        try {
            await started.promise; await manager.unload('cell');
            await failed;
            fast.open(); resume.open();
            await vi.waitFor(() => expect(unloaded).toHaveBeenCalledTimes(2));
            expect(direct.mock.calls).toEqual([[0, 2]]);
            expect(caller.mock.calls).toEqual(direct.mock.calls);
            expect(assets.sizes().refRows).toBe(0);
        } finally { fast.open(); resume.open(); await Promise.allSettled([failed]); assets.releaseAll(); app.quit(); }
    });

    it('counts shared meshes and unique skeletal pairs on the same asset scale', async () => {
        const { registerSpineSupport } = await import('../src/spine/spineSupport');
        const { registerDragonBonesSupport } = await import('../src/dragonbones/dragonBonesSupport');
        registerSpineSupport(); registerDragonBonesSupport();
        const { app, assets, options } = await runtime();
        app.setSideModules({ acquire: async () => null });
        const skeletal = (id: number, type: string, file: string) => ({
            ...scene.entities[0]!, id, components: [{ type, data: { skeletonPath: file + '.json', atlasPath: file + '.atlas' } }],
        });
        const sceneData = { ...scene, entities: [
            ...scene.entities, skeletal(2, 'SpineAnimation', 'one'), skeletal(3, 'SpineAnimation', 'one'),
            skeletal(4, 'SpineAnimation', 'two'), skeletal(5, 'DragonBonesAnimation', 'one'),
        ] };
        const progress = vi.fn();
        try {
            const ready = await prepareRuntimeScene({ ...options, sceneData, onProgress: progress });
            expect(progress.mock.calls).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
            expect(ready.assetResult.scope.size).toBe(1);
            ready.assetResult.scope.releaseAll(); expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });
});

describe('overlapping registered scene loads', () => {
    async function registered(streamed = false) {
        const state = await runtime();
        const { app, options } = state;
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const config = createRuntimeSceneConfig('cell', scene, options, undefined, streamed ? {} : undefined);
        manager.register(config);
        return { ...state, manager, config };
    }

    it.each(['authoring', 'runtime'])('cancels a waiting %s publication before it spawns or transfers mesh receipts', async entry => {
        const { app, assets, options, unloaded } = await runtime();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const began = barrier(), resume = barrier();
        assets.register({ type: 'mesh', extensions: ['.esmesh'], unload: unloaded, load: async () => {
            began.open(); await resume.promise; return { handle: 7 };
        } });
        manager.register(entry === 'authoring' ? { name: 'cell', data: scene } : createRuntimeSceneConfig('cell', scene, options));
        const spawn = vi.fn();
        app.world.onSpawn(spawn);
        const cancelled = expect(manager.load('cell')).rejects.toBeInstanceOf(SceneLoadCancelled);
        try {
            await began.promise;
            const waiting = manager.whenLoadsSettle();
            await manager.unload('cell'); await waiting;
            await cancelled;
            resume.open();
            await vi.waitFor(() => expect(unloaded).toHaveBeenCalledOnce());
            expect(spawn).not.toHaveBeenCalled();
            expect(assets.sizes().refRows).toBe(0);
        } finally { resume.open(); await cancelled; assets.releaseAll(); app.quit(); }
    });

    it.each(['authoring', 'runtime'])('stops %s component writes if a spawn observer retires the scene', async entry => {
        const { app, assets, options, unloaded } = await runtime();
        connectFakeCpp(app.world);
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const config: SceneConfig = entry === 'authoring' ? { name: 'cell', data: scene }
            : createRuntimeSceneConfig('cell', scene, options);
        let leaving: Promise<void> | undefined;
        config.onPhase = phase => { if (phase === 'spawn.entities') leaving = manager.unload('cell'); };
        manager.register(config);
        const insert = vi.spyOn(app.world, 'insert');
        try {
            await expect(manager.load('cell')).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(leaving).toBeDefined(); await leaving;
            expect(insert.mock.calls.some(([, component]) => component === MeshRenderer)).toBe(false);
            expect(app.world.entityCount()).toBe(0);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('lets a synchronous setup callback join the load that invoked it', async () => {
        const { app, manager, assets } = await registered();
        const gate = barrier();
        let joined!: ReturnType<typeof manager.load>, settled = false;
        manager.register({ name: 'cell', async setup(ctx) {
            joined = manager.loadAdditive('cell');
            void manager.whenLoadsSettle().then(() => { settled = true; });
            await gate.promise;
            ctx.spawn();
        } });
        try {
            const first = manager.load('cell');
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(settled).toBe(false);
            gate.open();
            const context = await first;
            expect(await joined).toBe(context);
            expect(context.entities.size).toBe(1);
        } finally { gate.open(); assets.releaseAll(); app.quit(); }
    });

    it.each(['immediate', 'staggered'])('queues same-name requests during %s unload', async mode => {
        const { app, manager, assets } = await registered();
        const turn = barrier(), cleanup = vi.fn();
        let queued!: ReturnType<typeof manager.load>, joined!: Promise<void>;
        manager.register({ name: 'cell', setup(ctx) { ctx.spawn(); }, cleanup() {
            cleanup();
            if (cleanup.mock.calls.length > 1) return;
            queued = manager.load('cell');
            joined = manager.unload('cell', { staggered: true });
        }, async retire() { await turn.promise; } });
        try {
            const previous = await manager.load('cell');
            const leaving = manager.unload('cell', { staggered: mode === 'staggered' });
            turn.open();
            await Promise.all([leaving, joined]);
            const next = await queued;
            expect(cleanup).toHaveBeenCalledOnce();
            expect(next).not.toBe(previous);
            expect(manager.getScene('cell')).toBe(next);
            expect(next.entities.size).toBe(1);
            expect(previous.entities.size).toBe(0);
        } finally { turn.open(); assets.releaseAll(); app.quit(); }
    });

    it.each(['unload', 'rush'])('queues loads from a retirement hook and directs %s to the retiring registration', async method => {
        const { app, assets, config, manager } = await registered();
        const gate = barrier(), oldRush = vi.fn(gate.open), newRush = vi.fn(), newUrge = vi.fn();
        let queued!: ReturnType<typeof manager.load>;
        config.rush = oldRush;
        config.urge = vi.fn();
        config.retire = async () => {
            manager.register({ name: 'cell', rush: newRush, urge: newUrge });
            queued = manager.load('cell');
            await gate.promise;
        };
        try {
            const first = await manager.load('cell');
            const leaving = manager.unload('cell', { staggered: true });
            manager.urge('cell', true);
            const immediate = method === 'unload' ? manager.unload('cell') : manager.rush('cell');
            expect(oldRush).toHaveBeenCalledOnce();
            expect(newRush).not.toHaveBeenCalled();
            expect(config.urge).toHaveBeenCalledWith(true);
            expect(newUrge).not.toHaveBeenCalled();
            await Promise.all([leaving, immediate]);
            const next = await queued;
            expect(next).not.toBe(first);
            expect(manager.getScene('cell')).toBe(next);
        } finally { gate.open(); assets.releaseAll(); app.quit(); }
    });

    it.each(['publish', 'discard'])('shares one in-flight preparation through %s', async finish => {
        const { app, assets, manager, unloaded } = await registered();
        const preload = vi.spyOn(assets, 'preloadSceneAssets');
        try {
            const first = manager.prepare('cell'), second = manager.prepare('cell');
            if (finish === 'publish') {
                const loading = manager.load('cell');
                await Promise.all([first, second]);
                const ctx = await loading;
                expect(ctx.entities.size).toBe(1);
                expect(assets.sizes().refRows).toBe(1);
                await manager.unload('cell');
            } else {
                await Promise.all([first, second]);
                expect(manager.discardPrepared('cell')).toBe(1);
            }
            expect(preload).toHaveBeenCalledTimes(1);
            expect(app.world.getAllEntities()).toEqual([]);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['reset', 'replace'])('returns speculative mesh receipts on registration %s', async mode => {
        const { app, assets, manager, unloaded } = await registered();
        try {
            await manager.prepare('cell');
            expect(assets.sizes().refRows).toBe(1);
            if (mode === 'reset') manager.reset();
            manager.register({ name: 'cell' });
            await manager.load('cell');
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('reset cancels waiting loads and retires their unfinished setup while the same name can load again', async () => {
        const { app, assets, manager, config, unloaded } = await registered();
        const entered = barrier(), resume = barrier(), finished = barrier();
        const setup = config.setup!;
        config.setup = async ctx => {
            await setup(ctx);
            entered.open();
            await resume.promise;
            try { ctx.spawn(); } finally { finished.open(); }
        };
        try {
            const cancelled = expect(manager.load('cell')).rejects.toBeInstanceOf(SceneLoadCancelled);
            await entered.promise;
            const pending = manager.whenLoadsSettle();
            manager.reset();
            await Promise.all([cancelled, pending]);
            expect(app.world.getAllEntities()).toEqual([]);
            expect(assets.sizes().refRows).toBe(0);
            manager.register({ name: 'cell', setup: ctx => { ctx.spawn(); } });
            const next = await manager.load('cell');
            resume.open();
            await finished.promise;
            expect(manager.getScene('cell')).toBe(next);
            expect(next.entities.size).toBe(1);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { resume.open(); assets.releaseAll(); app.quit(); }
    });

    it('reset keeps a retiring mesh, cancels the queued load and fences the old scheduler', async () => {
        const { app, assets, manager, config, unloaded } = await registered();
        connectFakeCpp(app.world);
        const turn = barrier(), finished = barrier();
        config.retire = async (entities, retirement) => {
            retirement!.hideRoots();
            await turn.promise;
            for (const entity of entities) retirement!.despawn(entity);
            finished.open();
        };
        try {
            const first = await manager.load('cell'), [mesh] = first.entities;
            const leaving = expect(manager.unload('cell', { staggered: true })).rejects.toBeInstanceOf(SceneLoadCancelled);
            const queued = expect(manager.load('cell')).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(app.world.has(mesh!, Disabled)).toBe(true);
            manager.reset();
            await Promise.all([leaving, queued]);
            manager.register({ name: 'cell' });
            const next = await manager.loadAdditive('cell');
            next.adopt(mesh!);
            turn.open();
            await finished.promise;
            expect(app.world.valid(mesh!)).toBe(true);
            expect(app.world.has(mesh!, Disabled)).toBe(false);
            expect(assets.sizes().refRows).toBe(1);
            expect(manager.getActive()).toBeNull();
            await manager.unload('cell');
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { turn.open(); assets.releaseAll(); app.quit(); }
    });

    it('releases a discarded acquisition without consuming the preparation that replaced it', async () => {
        const { app, assets, manager, unloaded } = await registered();
        const began = barrier(), finish = barrier();
        assets.register({ type: 'mesh', extensions: ['.esmesh'], unload: unloaded, load: async () => {
            began.open(); await finish.promise; return { handle: 19 };
        } });
        const first = manager.prepare('cell');
        try {
            await began.promise;
            expect(manager.discardPrepared('cell')).toBe(0);
            const cancelled = expect(first).rejects.toBeInstanceOf(SceneLoadCancelled);
            const replacement = manager.prepare('cell');
            finish.open();
            await Promise.all([cancelled, replacement]);
            expect(assets.sizes().refRows).toBe(1);
            const ctx = await manager.load('cell');
            expect(ctx.entities.size).toBe(1);
            await manager.unload('cell');
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { finish.open(); assets.releaseAll(); app.quit(); }
    });

    it('cancels a streamed preparation parked between frames', async () => {
        const { app, assets, manager } = await registered(true);
        const bakes = bakesOf(app), turn = bakes.turn.bind(bakes), parked = barrier();
        vi.spyOn(bakes, 'turn').mockImplementation(owner => { parked.open(); return turn(owner); });
        const first = manager.prepare('cell');
        try {
            await parked.promise;
            const rejected = vi.fn();
            const settled = first.catch(rejected);
            expect(manager.discardPrepared('cell')).toBe(0);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(rejected).toHaveBeenCalledWith(expect.any(SceneLoadCancelled));
            expect(bakes.turn).toHaveBeenCalledTimes(1);
            await settled;
            expect(assets.sizes().refRows).toBe(0);
        } finally { manager.rush('cell'); await first.catch(() => {}); assets.releaseAll(); app.quit(); }
    });

    it.each(['prepare', 'load', 'join'])('reset cancels a parked streamed %s without a new frame', async mode => {
        const { app, manager, assets, config } = await registered(true);
        const bakes = bakesOf(app), turn = bakes.turn.bind(bakes), parked = barrier();
        const retryParked = barrier();
        const gates = vi.spyOn(bakes, 'turn').mockImplementation(owner => {
            (gates.mock.calls.length === 1 ? parked : retryParked).open();
            return turn(owner);
        });
        const preload = vi.spyOn(assets, 'preloadSceneAssets');
        try {
            const started = mode === 'load' ? manager.load('cell') : manager.prepare('cell');
            const cancelled = expect(started).rejects.toBeInstanceOf(SceneLoadCancelled);
            await parked.promise;
            const joined = mode === 'join' ? expect(manager.load('cell')).rejects.toBeInstanceOf(SceneLoadCancelled) : null;
            manager.reset();
            await Promise.all([cancelled, joined]);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(preload).not.toHaveBeenCalled();
            expect(app.world.getAllEntities()).toEqual([]);
            expect(assets.sizes().refRows).toBe(0);
            manager.register(config);
            const retry = manager.load('cell');
            await retryParked.promise;
            expect(bakes.turn).toHaveBeenCalledTimes(2);
            manager.rush('cell');
            expect((await retry).entities.size).toBe(1);
            await manager.unload('cell');
        } finally { manager.rush('cell'); assets.releaseAll(); app.quit(); }
    });

    it('discards the hidden part of a staged spawn without running its remaining component writes', async () => {
        const { app, assets, config, manager, unloaded } = await registered(true);
        connectFakeCpp(app.world);
        const bakes = bakesOf(app), phases: string[] = [];
        config.onPhase = phase => { phases.push(phase); };
        try {
            manager.urge('cell', true);
            await manager.prepare('cell');
            manager.urge('cell', false);
            const cancelled = expect(manager.load('cell')).rejects.toBeInstanceOf(SceneLoadCancelled);
            await vi.waitFor(() => expect(bakes.active).toHaveLength(1));
            let clock = 0;
            bakes.step(() => clock += 1000);
            const [partial] = app.world.getAllEntities();
            expect(app.world.has(partial!, Disabled)).toBe(true);
            manager.reset();
            await cancelled;
            await vi.waitFor(() => expect(assets.sizes().refRows).toBe(0));
            expect(app.world.getAllEntities()).toEqual([]);
            expect(bakes.active).toHaveLength(0);
            expect(phases).not.toContain('spawn.components');
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { manager.rush('cell'); assets.releaseAll(); app.quit(); }
    });

    it('keeps newer callers joined when an unloaded instance finishes under the same name', async () => {
        const { app, assets, manager, config, unloaded } = await registered();
        const arrivals = [barrier(), barrier()], gates = [barrier(), barrier()];
        const publish = config.setup!;
        let calls = 0;
        config.setup = async ctx => {
            const index = calls++;
            arrivals[index]!.open();
            await gates[index]!.promise;
            await publish(ctx);
        };
        try {
            const first = manager.load('cell');
            const cancelled = expect(first).rejects.toBeInstanceOf(SceneLoadCancelled);
            await arrivals[0]!.promise;
            await manager.unload('cell');
            const second = manager.loadAdditive('cell');
            await arrivals[1]!.promise;
            gates[0]!.open(); await cancelled;
            expect(manager.getLoading()).toEqual(['cell']);
            expect(app.world.getAllEntities()).toEqual([]);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).not.toHaveBeenCalled();
            const third = manager.load('cell');
            gates[1]!.open();
            const ctx = await second;
            expect(await third).toBe(ctx);
            expect(ctx.entities.size).toBe(1);
            await manager.unload('cell');
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { for (const gate of gates) gate.open(); assets.releaseAll(); app.quit(); }
    });

    it.each(['running', 'sleeping'])('preserves transfers between the unload frames of a %s cell', async status => {
        const { app, assets, options, unloaded } = await runtime();
        connectFakeCpp(app.world);
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const hidden = { ...scene.entities[0]!, id: 2, name: 'already hidden',
            components: [...scene.entities[0]!.components, { type: 'Disabled', data: {} }] };
        const cell = createRuntimeSceneConfig('cell', { ...scene, entities: [...scene.entities, hidden] }, options, undefined, {});
        const cleanup = vi.fn();
        cell.cleanup = cleanup;
        manager.register(cell); manager.register({ name: 'destination' });
        try {
            manager.rush('cell');
            const source = await manager.load('cell'), destination = await manager.loadAdditive('destination');
            const visible = app.world.findEntityByName('new')!, invisible = app.world.findEntityByName('already hidden')!;
            const root = source.spawn(), joint = app.world.spawn(), nested = source.spawn(), guest = destination.spawn();
            const leavingChild = source.spawn();
            app.world.setParent(leavingChild, visible);
            app.world.setParent(joint, root);
            app.world.setParent(nested, joint);
            if (status === 'sleeping') manager.sleep('cell');
            manager.urge('cell', false);
            const leaving = manager.unload('cell', { staggered: true });
            const joining = manager.unload('cell', { staggered: true });
            expect(app.world.has(visible, Disabled)).toBe(true);
            expect(() => source.spawn()).toThrow(SceneLoadCancelled);
            app.world.setParent(guest, joint);
            destination.adopt(visible); destination.adopt(invisible); destination.adopt(nested);
            expect(app.world.has(leavingChild, Disabled)).toBe(true);
            expect(app.world.has(nested, Parent)).toBe(false);
            expect(app.world.has(nested, Disabled)).toBe(false);
            await Promise.all([leaving, joining, manager.unload('cell')]);
            expect(cleanup).toHaveBeenCalledOnce();
            expect([...source.entities]).toEqual([]);
            expect(destination.entities).toEqual(new Set([visible, invisible, nested, guest]));
            expect(app.world.has(guest, Parent)).toBe(false);
            expect(app.world.valid(joint)).toBe(false);
            expect(app.world.valid(root)).toBe(false);
            expect(app.world.valid(leavingChild)).toBe(false);
            expect(app.world.has(visible, Disabled)).toBe(false);
            expect(app.world.has(invisible, Disabled)).toBe(true);
            expect(app.world.get(visible, MeshRenderer).mesh).toBe(7);
            expect(app.world.get(visible, MeshRenderer).enabled).toBe(true);
            expect(assets.sizes().refRows).toBe(2);
            expect(unloaded).not.toHaveBeenCalled();
            await manager.unload('destination');
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { manager.rush('cell'); assets.releaseAll(); app.quit(); }
    });

    it('finishes a rejected custom retirement and leaves transferred entities with their new owner', async () => {
        const { app, assets, manager, config, unloaded } = await registered();
        connectFakeCpp(app.world);
        const turn = barrier(), fault = new Error('scheduler stopped');
        config.retire = async (entities, retirement) => {
            retirement!.hideRoots();
            await turn.promise;
            retirement!.despawn(entities[0]!);
            throw fault;
        };
        manager.register({ name: 'next' });
        try {
            const source = await manager.load('cell'), next = await manager.loadAdditive('next');
            const mesh = app.world.findEntityByName('new')!, retiring = source.spawn();
            const leaving = expect(manager.unload('cell', { staggered: true })).rejects.toBe(fault);
            next.adopt(mesh);
            turn.open();
            await leaving;
            expect(app.world.valid(retiring)).toBe(false);
            expect(app.world.has(mesh, Disabled)).toBe(false);
            expect(next.entities).toEqual(new Set([mesh]));
            expect(assets.sizes().refRows).toBe(1);
            await manager.unload('next');
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { turn.open(); assets.releaseAll(); app.quit(); }
    });
});

describe('scene publication failures', () => {
    it.each(['authored', 'packaged'])('leaves the running scene’s texture border intact when %s setup fails', async entry => {
        const { app, options, assets } = await runtime();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const data = (left: number): SceneData => ({ ...scene, textureMetadata: { shared: {
            version: '1.0', type: 'texture', sliceBorder: { left, right: 2, top: 3, bottom: 4 },
        } } });
        const preload = assets.preloadSceneAssets.bind(assets);
        vi.spyOn(assets, 'preloadSceneAssets').mockImplementation(async (...args) => {
            const content = await preload(...args);
            content.textureHandles.set('shared', 17);
            return content;
        });
        manager.register({ name: 'home', data: data(1) });
        const config: SceneConfig = entry === 'authored'
            ? { name: 'next', data: data(9) }
            : createRuntimeSceneConfig('next', data(9), options);
        const setup = config.setup;
        const failure = new Error('setup rejected');
        let refuse = true;
        config.setup = async ctx => {
            await setup?.(ctx);
            if (refuse) throw failure;
        };
        manager.register(config);
        setTextureMetadata.mockClear();
        try {
            const home = await manager.load('home');
            expect(setTextureMetadata.mock.calls).toEqual([[17, 1, 2, 3, 4]]);
            await expect(manager.loadAdditive('next')).rejects.toBe(failure);
            expect(manager.getScene('home')).toBe(home);
            expect(setTextureMetadata.mock.calls).toEqual([[17, 1, 2, 3, 4]]);
            refuse = false;
            await manager.loadAdditive('next');
            expect(setTextureMetadata.mock.calls).toEqual([[17, 1, 2, 3, 4], [17, 9, 2, 3, 4]]);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['authoring', 'runtime'])('keeps another scene’s subtree through a failed %s spawn', async entry => {
        const { app, options, assets, unloaded } = await runtime();
        connectFakeCpp(app.world);
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        manager.register({ name: 'other' });
        const other = await manager.load('other'), guest = other.spawn(), leaf = other.spawn();
        app.world.setParent(leaf, guest);
        const fault = new Error('after attachment');
        const onPhase = (phase: string) => {
            if (phase !== 'spawn') return;
            const helper = app.world.spawn();
            app.world.setParent(helper, app.world.findEntityByName('new')!);
            app.world.setParent(guest, helper);
            throw fault;
        };
        try {
            const load = entry === 'authoring'
                ? loadSceneWithAssets(app.world, scene, { assets, onPhase })
                : loadRuntimeScene({ ...options, sceneData: scene, onPhase });
            await expect(load).rejects.toBe(fault);
            expect(new Set(app.world.getAllEntities())).toEqual(new Set([guest, leaf]));
            expect(app.world.has(guest, Parent)).toBe(false);
            expect(app.world.get(leaf, Parent).entity).toBe(guest);
            expect(other.entities).toEqual(new Set([guest, leaf]));
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['assets', 'subsystems', 'spawn', 'origins'])('rolls the packaged load back if %s fails and can retry', async phase => {
        const { app, options, assets, unloaded } = await runtime();
        const existing = app.world.spawn(), refused = new Error(phase);
        try {
            await expect(loadRuntimeScene({ ...options, sceneData: scene, onPhase: name => {
                if (name === phase) throw refused;
            } })).rejects.toBe(refused);
            expect(app.world.getAllEntities()).toEqual([existing]);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
            await loadRuntimeScene({ ...options, sceneData: scene });
            const entity = app.world.findEntityByName('new');
            expect(entity).not.toBeNull();
            expect(assets.sizes().refRows).toBe(1);
            app.world.despawn(entity!);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledTimes(2);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['links', 'adopt', 'reveal'])('returns the prepared resources when a registered scene fails at %s', async phase => {
        const { app, options, assets, unloaded } = await runtime();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        const config = createRuntimeSceneConfig('registered', scene, options, undefined, {});
        const refused = new Error(phase), existing = app.world.spawn();
        config.externalEntities = () => { if (phase === 'links') throw refused; return new Map(); };
        config.onPhase = name => { if (name === phase) throw refused; };
        manager.register(config);
        try {
            manager.rush(config.name);
            await manager.prepare(config.name);
            expect(assets.sizes().refRows).toBe(1);
            await expect(manager.load(config.name)).rejects.toBe(refused);
            expect(app.world.getAllEntities()).toEqual([existing]);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
            config.externalEntities = undefined;
            config.onPhase = undefined;
            manager.rush(config.name);
            const ctx = await manager.load(config.name);
            expect(ctx.entities.size).toBe(1);
            expect(assets.sizes().refRows).toBe(1);
            await manager.unload(config.name);
            expect(app.world.getAllEntities()).toEqual([existing]);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledTimes(2);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['partial', 'finished'] as const)('closes a %s staged spawn when its scheduler rejects', async mode => {
        const { app, options, assets, unloaded } = await runtime();
        const existing = app.world.spawn(), refused = new Error('scheduler stopped');
        const prepared = await prepareRuntimeScene({ ...options, sceneData: scene });
        let resume!: () => IteratorResult<unknown>;
        try {
            await expect(publishRuntimeScene(prepared, undefined, async job => {
                resume = () => job.next();
                let result = job.next();
                if (mode === 'finished') while (!result.done) result = job.next();
                expect(app.world.getAllEntities()).toHaveLength(2);
                throw refused;
            })).rejects.toBe(refused);
            expect(app.world.getAllEntities()).toEqual([existing]);
            expect(resume().done).toBe(true);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['assets', 'spawn'] as const)('keeps a caller’s existing collection intact when %s fails', async phase => {
        const { app, assets, unloaded } = await runtime();
        const scope = new AssetScope(), original = vi.fn();
        scope.add(ownedAssetLease('outside', 1, 9, original));
        const collector = { scope, materialHandles: new Set<number>(), texturePaths: new Set<string>(),
            fontPaths: new Set<string>(), spineKeys: new Set<string>() };
        const refused = new Error(phase);
        try {
            await expect(loadSceneWithAssets(app.world, scene, { assets, collectAssets: collector, onPhase: name => {
                if (name === phase) throw refused;
            } })).rejects.toBe(refused);
            expect(scope.size).toBe(1);
            expect(original).not.toHaveBeenCalled();
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { scope.releaseAll(); assets.releaseAll(); app.quit(); }
    });

    it('settles in-flight acquisitions before reporting a progress callback failure', async () => {
        const { app, assets } = await runtime();
        let releaseSlow!: () => void, observed!: () => void;
        const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
        const progress = new Promise<void>(resolve => { observed = resolve; });
        const unloaded = vi.fn(), failure = new Error('progress aborted');
        assets.register({ type: 'mesh', extensions: ['.esmesh'], unload: unloaded, load: async path => {
            if (path === 'slow.esmesh') await slow;
            return { handle: path === 'slow.esmesh' ? 2 : 1 };
        } });
        const both = { ...scene, entities: ['fast.esmesh', 'slow.esmesh'].map((mesh, id) => ({
            ...scene.entities[0]!, id, components: [{ type: 'MeshRenderer', data: { mesh } }],
        })) };
        const failed = assets.preloadSceneAssets(both, n => { if (n === 1) { observed(); throw failure; } });
        const rejected = vi.fn();
        const settled = failed.catch(rejected);
        try {
            await progress;
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(rejected).not.toHaveBeenCalled();
            releaseSlow();
            await settled;
            expect(rejected).toHaveBeenCalledWith(failure);
            expect(assets.sizes().refRows).toBe(0);
            expect(unloaded).toHaveBeenCalledTimes(2);
        } finally { releaseSlow(); await settled; assets.releaseAll(); app.quit(); }
    });

    it('rolls back only this load when its final spawn-phase observer throws', async () => {
        const world = new World(), existing = world.spawn(), error = new Error('observer failed');
        await expect(loadSceneWithAssets(world, scene, { onPhase: phase => {
            if (phase === 'spawn') throw error;
        } })).rejects.toBe(error);
        expect(world.getAllEntities()).toEqual([existing]);
    });
    it('rolls back entities and their asset receipts when reference tracking throws', async () => {
        const world = new World(), existing = world.spawn(), error = new Error('tracking failed');
        const unloaded = vi.fn();
        const assets = Assets.create({ backend: {
            fetchBinary: async () => new ArrayBuffer(8), fetchText: async () => '{}', resolveUrl: (path: string) => path,
        } as Backend, module: { _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(16) } as never });
        assets.register<{ handle: number }>({ type: 'mesh', load: async () => ({ handle: 1 }), unload: unloaded } as never);
        const tracker = vi.spyOn(assets, 'trackSceneAssetReferences').mockImplementation(() => { throw error; });
        try {
            await expect(loadSceneWithAssets(world, scene, { assets })).rejects.toBe(error);
            expect(world.getAllEntities()).toEqual([existing]);
            expect(assets.sizes()).toMatchObject({ refRows: 0, trackedRefRows: 0, genericCached: 0 });
            expect(unloaded).toHaveBeenCalledOnce();
            tracker.mockRestore();
            const retry = await loadSceneWithAssets(world, scene, { assets });
            expect(retry.size).toBe(1);
            for (const entity of retry.values()) world.despawn(entity);
            expect(assets.sizes().refRows).toBe(0);
        } finally { tracker.mockRestore(); assets.releaseAll(); for (const entity of world.getAllEntities()) world.despawn(entity); }
    });
});
