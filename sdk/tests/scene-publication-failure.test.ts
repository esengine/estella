// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { loadSceneWithAssets, type SceneData } from '../src/scene/scene';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { EmbeddedBackend } from '../src/asset/Backend';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { App } from '../src/app/app';
import { createRuntimeSceneConfig, loadRuntimeScene, prepareRuntimeScene, publishRuntimeScene } from '../src/runtime/runtimeLoader';
import { SceneLoadCancelled, SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import { bakesOf } from '../src/runtime/bakes';
import { Disabled, MeshRenderer, Parent } from '../src/ecs/component';
import { connectFakeCpp } from './helpers/fakeEngine';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: () => false }),
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
            const third = manager.load('cell');
            gates[1]!.open();
            const ctx = await second;
            expect(await third).toBe(ctx);
            expect(ctx.entities.size).toBe(1);
            await manager.unload('cell');
            expect(unloaded).toHaveBeenCalledTimes(2);
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
