// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-load-transaction.test.ts
 * @brief   A scene load that did not commit leaves nothing of itself behind.
 *
 * @details A load that did not commit owns the same kinds of thing a loaded
 *          scene owns: its preload's receipts, the systems added before
 *          `setup`, whatever `setup` registered before it threw. All of them
 *          go back, or a retry succeeds on top of a ghost.
 *
 *          Nothing here mocks the acquisition pipeline, the draw-callback
 *          registry or the system schedule: what is under test is exactly the
 *          wiring a mock would replace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { loadPreviewScene } from '../src/app/previewApp';
import { Schedule, defineSystem } from '../src/ecs/system';
import { SceneManager, SceneManagerState, type SceneContext } from '../src/scene/sceneManager';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import { PostProcess, PostProcessAPI } from '../src/postprocess';
import { getDrawCallbacks, clearDrawCallbacks } from '../src/render/customDraw';
import { Disabled, Parent, SceneOwner, Transform, defineComponent } from '../src/ecs/component';
import { connectFakeCpp } from './helpers/fakeEngine';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';
import type { ShaderHandle } from '../src/render/material';
import { Text } from '../src/ui/core/text';
import { reservePromise } from '../src/util/reservePromise';
import { loadSceneWithAssets, type SceneData } from '../src/scene/scene';
import { prepareRuntimeScene } from '../src/runtime/runtimeLoader';
import type { PrefabData } from '../src/prefab/types';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: vi.fn(() => false) }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

/** Every generation of the asset is a distinguishable object, so a double
 *  release is visible as a repeated entry rather than as a silent no-op. */
function makeAssets(unloaded: string[]): Assets {
    let n = 0;
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => '{}'),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(16), GL: null, FS: null } as never,
    });
    assets.register<{ id: string }>({
        type: 'font',
        load: async () => ({ id: `gen${++n}` }),
        unload: (v: { id: string }) => { unloaded.push(v.id); },
    } as never);
    return assets;
}

function harness() {
    const unloaded: string[] = [];
    const app = App.new();
    const assets = makeAssets(unloaded);
    const manager = new SceneManagerState(app);
    const pp = new PostProcessAPI();
    app.insertResource(AssetsResource, assets as never);
    app.insertResource(SceneManager, manager);
    app.insertResource(PostProcess, pp);
    return { app, assets, manager, pp, unloaded };
}

const CAMERA = 7 as Entity;

it('retires a canceled preview and skips queued loads while preserving a shared download', async () => {
    const { app, assets, unloaded } = harness();
    const entered = reservePromise<void>(), drained = reservePromise<void>(), download = reservePromise<{ id: string }>();
    const load = vi.fn(async (path: string) => {
        if (path === 'queued.ttf') return { id: 'queued' };
        entered.resolve();
        return download.promise;
    });
    assets.register({ type: 'font', load, unload: (value: { id: string }) => { unloaded.push(value.id); } } as never);
    const preload = assets.preloadSceneAssets.bind(assets);
    vi.spyOn(assets, 'preloadSceneAssets').mockImplementation((data, progress, options) =>
        preload(data, progress, { ...options, maxConcurrent: 1 }).finally(() => {
            if (data.name === 'obsolete') drained.resolve();
        }));
    const scene: SceneData = { version: '1.0', name: 'obsolete', entities: [
        { id: 1, name: 'Text', parent: null, children: [], components: [{ type: Text._name, data: { font: 'slow.ttf' } }] },
        { id: 2, name: 'Queued', parent: null, children: [], components: [{ type: Text._name, data: { font: 'queued.ttf' } }] },
    ] };
    const abort = new AbortController();
    const progress = vi.fn();
    let outcome: string | undefined;
    const stale = loadSceneWithAssets(app.world, scene, { assets, signal: abort.signal, onProgress: progress })
        .then(() => { outcome = 'published'; }, (error: Error) => { outcome = error.name; });
    let keep: ReturnType<typeof assets.acquireTyped> | undefined;
    try {
        await entered.promise;
        keep = assets.acquireTyped('font', 'slow.ttf');
        abort.abort();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(outcome).toBe('SceneLoadCancelled');
        await expect(loadPreviewScene(app, { version: '1.0', name: 'current', entities: [] })).resolves.toEqual(new Map());
        expect(app.world.entityCount()).toBe(0);
    } finally {
        download.resolve({ id: 'slow' });
        await stale;
        await drained.promise;
        const stillOwned = await keep;
        expect(unloaded).toEqual([]);
        stillOwned?.release();
        await vi.waitFor(() => expect(unloaded).toEqual(['slow']));
        app.quit();
    }
    expect(load).toHaveBeenCalledOnce();
    expect(progress.mock.calls).toEqual([[0, 2]]);
});

it.each([true, false])('retires a runtime scene preload on core disconnect with progress reporting %s', async observeProgress => {
    const app = App.new();
    connectFakeCpp(app.world);
    const source = {
        backend: makeAssets([]).backend,
        decodePixels: async () => { throw new Error('Unexpected image asset'); },
    };
    const options = { app, source, module: null };
    const empty: SceneData = { version: '1.0', name: 'empty', entities: [] };
    (await prepareRuntimeScene({ ...options, sceneData: empty })).assetResult.scope.releaseAll();
    const assets = app.getResource(AssetsResource);
    const entered = reservePromise<void>(), drained = reservePromise<void>(), download = reservePromise<{ id: string }>();
    const unload = vi.fn();
    const load = vi.fn(async (path: string) => {
        if (path === 'waiting.ttf') {
            entered.resolve();
            return download.promise;
        }
        return { id: 'queued' };
    });
    assets.register({ type: 'font', extensions: [], load, unload });
    const preload = assets.preloadSceneAssets.bind(assets);
    vi.spyOn(assets, 'preloadSceneAssets').mockImplementation((data, progress, settings) =>
        preload(data, progress, { ...settings, maxConcurrent: 1 }).finally(() => drained.resolve()));
    const scene: SceneData = { ...empty, name: 'obsolete package', entities: ['waiting.ttf', 'queued.ttf'].map((font, i) => ({
        id: i + 1, name: font, parent: null, children: [], components: [{ type: Text._name, data: { font } }],
    })) };
    const progress = vi.fn();
    const settled = vi.fn();
    const pending = prepareRuntimeScene({ ...options, sceneData: scene, onProgress: observeProgress ? progress : undefined })
        .then(() => settled('published'), error => settled(error.name));
    let shared: ReturnType<typeof assets.acquireTyped> | undefined;
    try {
        await entered.promise;
        shared = assets.acquireTyped('font', 'waiting.ttf');
        app.world.disconnectCpp();
        await vi.waitFor(() => expect(settled).toHaveBeenCalledWith('SceneLoadCancelled'));
        expect(load.mock.calls).toEqual([['waiting.ttf', expect.anything()]]);
        expect(progress.mock.calls).toEqual(observeProgress ? [[0, 2]] : []);
    } finally {
        download.resolve({ id: 'waiting' });
        await pending;
        await drained.promise;
        const held = await shared;
        try {
            expect(unload).not.toHaveBeenCalled();
        } finally {
            held?.release();
            app.quit();
        }
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(unload.mock.calls.map(([value]) => value)).toEqual([{ id: 'waiting' }]);
});

it.each([
    ['preview', false], ['runtime', false], ['preview', true], ['runtime', true],
] as const)('cancels %s prefab expansion while a shared read is pending, cleanup failure %s', async (door, failCleanup) => {
    const { app, assets: initial } = harness();
    connectFakeCpp(app.world);
    const empty: SceneData = { version: '1.0', name: 'empty', entities: [] };
    const runtime = { app, module: null, source: {
        backend: initial.backend, decodePixels: async () => { throw new Error('Unexpected image asset'); },
    } };
    if (door === 'runtime') (await prepareRuntimeScene({ ...runtime, sceneData: empty })).assetResult.scope.releaseAll();
    const assets = app.getResource(AssetsResource);
    const entered = reservePromise<void>(), download = reservePromise<PrefabData>();
    const document: PrefabData = { version: '2', name: 'root', rootEntityId: 'root', entities: [
        { prefabEntityId: 'root', name: 'Root', components: [], parent: null, children: [], visible: true },
    ] };
    const load = vi.fn(async (path: string) => {
        if (path === 'waiting.esprefab') {
            entered.resolve();
            return { data: await download.promise, path };
        }
        return { data: document, path };
    });
    const unloaded: string[] = [];
    assets.register({ type: 'prefab', extensions: [], load, unload: value => {
        unloaded.push(value.path);
        if (failCleanup && value.path === 'first.esprefab') throw new Error('Prefab cleanup failed');
    } });
    const scene = { ...empty, name: 'prefabs', entities: [
        'first.esprefab', 'waiting.esprefab', 'queued.esprefab',
    ].map((prefab, i) => ({ id: i + 1, parent: null, prefab, overrides: [], added: [], removed: [] })) } as unknown as SceneData;
    const settled = vi.fn();
    const pending = (door === 'runtime' ? prepareRuntimeScene({ ...runtime, sceneData: scene })
        : loadSceneWithAssets(app.world, scene, { assets })).then(() => settled('loaded'), error => settled(error.name));
    let shared: ReturnType<typeof assets.acquireTyped> | undefined;
    try {
        await Promise.race([entered.promise, pending.then(() => { throw new Error('Scene finished before the pending prefab read'); })]);
        shared = assets.acquireTyped('prefab', 'waiting.esprefab');
        app.world.disconnectCpp();
        await vi.waitFor(() => expect(settled).toHaveBeenCalledWith('SceneLoadCancelled'));
        expect(unloaded).toEqual(['first.esprefab']);
        expect(load.mock.calls.map(([path]) => path)).toEqual(['first.esprefab', 'waiting.esprefab']);
    } finally {
        download.resolve({ ...document, basePrefab: 'nested.esprefab', entities: [] });
        await pending;
        const held = await shared;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        held?.release();
        app.quit();
    }
    expect(load.mock.calls.map(([path]) => path)).toEqual(['first.esprefab', 'waiting.esprefab']);
    expect(unloaded).toEqual(['first.esprefab', 'waiting.esprefab']);
});

/** Something sleep() switches off — the engine's renderables are C++-backed,
 *  and what is under test is the protocol, not the component. */
const Drawn = defineComponent('SleepPromotionDrawn', { visible: true }, { renderableField: 'visible' });

describe('render registrations across scene handoffs', () => {
    beforeEach(() => { clearDrawCallbacks(); });

    it.each(['retirement', 'failed setup'] as const)('keeps a replacement installed during %s', async (phase) => {
        const { app, manager, pp } = harness();
        const stack = pp.createStack();
        const draw = vi.fn();
        let enter!: () => void, finish!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        const gate = new Promise<void>(resolve => { finish = resolve; });
        const install = (ctx: SceneContext) => {
            ctx.registerDrawCallback('hud', draw);
            ctx.bindPostProcess(CAMERA, stack);
        };
        manager.register({ name: 'old', setup: async ctx => {
            install(ctx);
            if (phase === 'failed setup') { enter(); await gate; throw new Error('setup failed'); }
        }, retire: async () => { enter(); await gate; } });
        manager.register({ name: 'next', setup: install });
        try {
            const load = manager.loadAdditive('old');
            const leaving = phase === 'failed setup' ? expect(load).rejects.toThrow('setup failed')
                : load.then(() => manager.unload('old', { staggered: true }));
            await entered;
            await manager.loadAdditive('next');
            finish();
            await leaving;
            expect.soft([...getDrawCallbacks().values()].map(entry => entry.fn)).toEqual([draw]);
            expect.soft(pp.getStack(CAMERA)).toBe(stack);
            await manager.unload('next');
            expect(getDrawCallbacks().size).toBe(0);
            expect(pp.getStack(CAMERA)).toBeNull();
        } finally { finish(); app.quit(); }
    });

    it('leaves a camera rebound to the same stack by game code under game control', async () => {
        const { app, manager, pp } = harness();
        const stack = pp.createStack().addPass('bloom', 1 as ShaderHandle);
        try {
            manager.register({ name: 'old' });
            const old = await manager.loadAdditive('old');
            old.bindPostProcess(CAMERA, stack);
            pp.bind(CAMERA, stack);
            manager.pause('old');
            expect(pp.state.cameraBindings.activeStack(CAMERA)).toBe(stack);
            expect(stack.enabledPassCount).toBe(1);
            old.unbindPostProcess(CAMERA);
            expect(pp.getStack(CAMERA)).toBe(stack);
        } finally { app.quit(); }
    });

    it('gates each camera of a shared stack and preserves its authored pass settings', async () => {
        const { app, manager, pp } = harness();
        const shared = pp.createStack().addPass('bloom', 1 as ShaderHandle).addPass('blur', 2 as ShaderHandle);
        shared.setEnabled('blur', false);
        try {
            manager.register({ name: 'map' });
            manager.register({ name: 'minimap' });
            const map = await manager.loadAdditive('map');
            const minimap = await manager.loadAdditive('minimap');
            const main = map.spawn(), inset = minimap.spawn();
            map.bindPostProcess(main, shared);
            manager.sleep('minimap');
            minimap.bindPostProcess(inset, shared);
            expect(pp.state.cameraBindings.activeStack(inset)).toBeUndefined();
            expect(pp.state.cameraBindings.activeStack(main)).toBe(shared);
            manager.wake('minimap');
            expect(pp.state.cameraBindings.activeStack(inset)).toBe(shared);
            expect(shared.passes.map(pass => pass.enabled)).toEqual([true, false]);
            app.world.despawn(inset);
            expect(pp.getStack(inset)).toBeNull();
            expect(pp.getStack(main)).toBe(shared);
        } finally { app.quit(); }
    });

    it('transfers the current binding on adoption and keeps a replacement already owned by the new scene', async () => {
        const { app, manager, pp } = harness();
        const oldStack = pp.createStack(), newStack = pp.createStack();
        try {
            manager.register({ name: 'old' });
            manager.register({ name: 'next' });
            const old = await manager.loadAdditive('old'), next = await manager.loadAdditive('next');
            const adopted = old.spawn(), rebound = old.spawn();
            old.bindPostProcess(adopted, oldStack);
            old.bindPostProcess(rebound, oldStack);
            next.bindPostProcess(rebound, newStack);
            manager.pause('next');
            next.adopt(adopted);
            next.adopt(rebound);
            await manager.unload('old');
            expect(pp.state.cameraBindings.activeStack(adopted)).toBeUndefined();
            expect(pp.state.cameraBindings.activeStack(rebound)).toBeUndefined();
            manager.resume('next');
            expect(pp.state.cameraBindings.activeStack(adopted)).toBe(oldStack);
            expect(pp.state.cameraBindings.activeStack(rebound)).toBe(newStack);
            next.unbindPostProcess(adopted);
            next.unbindPostProcess(rebound);
            expect(pp.getStack(adopted)).toBeNull();
            expect(pp.getStack(rebound)).toBeNull();
        } finally { app.quit(); }
    });
});

describe('a scene load that fails leaves nothing of itself behind', () => {
    beforeEach(() => { clearDrawCallbacks(); });

    it('keeps persistent entities and the active name when releasing residency fails, then retries the handoff', async () => {
        const { app, manager } = harness();
        try {
            const cleanup = vi.fn(() => manager.getActive());
            manager.register({ name: 'map', cleanup });
            manager.register({ name: 'hud' });
            const handoff = vi.fn(async (_scene: string | null) => {});
            manager.setActiveSceneHandler(handoff);
            const map = await manager.load('map');
            const player = map.spawn();
            await manager.loadAdditive('hud');
            await manager.load('map');
            expect(handoff.mock.calls).toEqual([['map']]);
            handoff.mockRejectedValueOnce(new Error('cell still in use'));
            await expect(manager.unload('map')).rejects.toThrow('cell still in use');
            expect(manager.getActive()).toBe('map');
            expect(manager.getSceneStatus('map')).toBe('running');
            expect(app.world.valid(player)).toBe(true);
            expect(cleanup).not.toHaveBeenCalled();
            await manager.unload('map');
            expect(manager.getActive()).toBeNull();
            expect(app.world.valid(player)).toBe(false);
            expect(cleanup).toHaveReturnedWith('map');
            expect(handoff.mock.calls).toEqual([['map'], [null], [null]]);
        } finally { app.quit(); }
    });

    it('cancels a load unloaded during its residency handoff and runs its cleanup once', async () => {
        const { app, manager } = harness();
        let started!: () => void, finish!: () => void, restore!: () => void;
        const entering = new Promise<void>(resolve => { started = resolve; });
        const handoff = new Promise<void>(resolve => { finish = resolve; });
        const returning = new Promise<void>(resolve => { restore = resolve; });
        const cleanup = vi.fn();
        try {
            manager.register({ name: 'home' });
            manager.register({ name: 'next', cleanup });
            await manager.load('home');
            manager.setActiveSceneHandler(name => {
                if (name === 'next') { started(); return handoff; }
                if (name === 'home') return returning;
                return undefined;
            });
            const arrival = manager.load('next');
            const outcome = arrival.then(() => 'loaded', () => 'cancelled');
            await entering;
            const leaving = manager.unload('next');
            finish();
            await new Promise(resolve => setTimeout(resolve, 0));
            restore();
            await leaving;
            expect(await outcome).toBe('cancelled');
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(manager.getActive()).toBe('home');
            expect(manager.getScene('next')).toBeNull();
        } finally { app.quit(); }
    });

    it('settles an already loaded scene promotion on reset while its old handoff is pending', async () => {
        const { app, manager } = harness();
        let finish!: () => void;
        const handoff = new Promise<void>(resolve => { finish = resolve; });
        try {
            manager.register({ name: 'map' });
            await manager.loadAdditive('map');
            manager.setActiveSceneHandler(name => name === 'map' ? handoff : undefined);
            const promotion = manager.load('map');
            manager.reset();
            await expect(promotion).rejects.toThrow(/cancel/i);
            finish();
            await handoff;
            expect(manager.getActive()).toBeNull();
        } finally {
            finish();
            app.quit();
        }
    });

    it('reset removes the old systems before a scene of the same name runs', async () => {
        const { app, manager } = harness();
        const old = vi.fn(), current = vi.fn();
        try {
            manager.register({ name: 'level', systems: [{ schedule: Schedule.Update, system: defineSystem([], old) }] });
            await manager.load('level');
            await app.tick(1 / 60);
            manager.reset();
            manager.register({ name: 'level', systems: [{ schedule: Schedule.Update, system: defineSystem([], current) }] });
            await manager.load('level');
            await app.tick(1 / 60);
            expect(old).toHaveBeenCalledOnce();
            expect(current).toHaveBeenCalledOnce();
        } finally { app.quit(); }
    });

    it('gives back every kind of thing the scene owned, and a retry is clean', async () => {
        const { app, assets, manager, pp, unloaded } = harness();
        const base = assets.sizes().refRows;
        let ticks = 0;
        let spawned = 0 as Entity;

        const counting = defineSystem([], () => { ticks++; }, { name: 'LevelSystem' });
        const touchEverything = async (ctx: import('../src/scene/sceneManager').SceneContext): Promise<void> => {
            spawned = ctx.spawn();
            const scope = new AssetScope();
            scope.add(await assets.acquireTyped('font', 'hero.ttf'));
            ctx.trackAssetScope(scope);
            ctx.registerDrawCallback('ghost', () => {});
            ctx.bindPostProcess(CAMERA, { setAllPassesEnabled: vi.fn() } as never);
        };

        manager.register({
            name: 'level',
            systems: [{ schedule: Schedule.Update, system: counting }],
            setup: async (ctx) => { await touchEverything(ctx); throw new Error('boom'); },
        });

        await expect(manager.load('level')).rejects.toThrow('boom');

        expect(manager.getScene('level')).toBeNull();
        expect(manager.getLoaded()).toEqual([]);
        expect(app.world.valid(spawned), 'the entity it spawned').toBe(false);
        expect(assets.sizes().refRows, 'the receipts it acquired').toBe(base);
        expect(unloaded).toEqual(['gen1']);
        expect([...getDrawCallbacks().values()].some(entry => entry.name === 'ghost'), 'the draw callback it registered').toBe(false);
        expect(pp.getStack(CAMERA), 'the post-process it bound').toBeNull();

        // The system needs a SUCCEEDING load to show: a scene-scoped system is
        // gated on its scene running, so after a failure "removed" and "merely
        // idle" look the same.
        manager.register({
            name: 'level',
            systems: [{ schedule: Schedule.Update, system: counting }],
            setup: () => {},
        });
        await manager.load('level');
        await app.tick(1 / 60);
        expect(ticks, 'the failed load\'s system is still registered too').toBe(1);
    });

    it('rolls back a setup that failed after an await, not only a synchronous one', async () => {
        // Where real failures live: a scene awaits the network, a DLC, a plugin,
        // and throws long after its assets were acquired.
        const { app, assets, manager, pp, unloaded } = harness();
        const base = assets.sizes().refRows;
        let spawned = 0 as Entity;
        let release = (): void => {};
        const gate = new Promise<void>((r) => { release = r; });

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                spawned = ctx.spawn();
                const scope = new AssetScope();
                scope.add(await assets.acquireTyped('font', 'hero.ttf'));
                ctx.trackAssetScope(scope);
                ctx.registerDrawCallback('ghost', () => {});
                ctx.bindPostProcess(CAMERA, { setAllPassesEnabled: vi.fn() } as never);
                await gate;
                throw new Error('boom, later');
            },
        });

        const loading = manager.load('level');
        const rejected = expect(loading).rejects.toThrow('boom, later');
        release();
        await rejected;

        expect(app.world.valid(spawned)).toBe(false);
        expect(assets.sizes().refRows).toBe(base);
        expect(unloaded).toEqual(['gen1']);
        expect([...getDrawCallbacks().values()].some(entry => entry.name === 'ghost')).toBe(false);
        expect(pp.getStack(CAMERA)).toBeNull();
        expect(manager.getScene('level')).toBeNull();
    });

    it('an unload during the load, then the load\'s own rollback, frees each thing once', async () => {
        // The cancelled setup returns a new acquisition after the first teardown.
        const { app, assets, manager, pp, unloaded } = harness();
        const base = assets.sizes().refRows;
        let release = (): void => {};
        const gate = new Promise<void>((r) => { release = r; });
        let spawned = 0 as Entity;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                await gate;
                // Everything here lands AFTER the unload has torn the instance down.
                const scope = new AssetScope();
                scope.add(await assets.acquireTyped('font', 'hero.ttf'));
                ctx.trackAssetScope(scope);
                spawned = ctx.spawn();
                ctx.registerDrawCallback('ghost', () => {});
                ctx.bindPostProcess(CAMERA, { setAllPassesEnabled: vi.fn() } as never);
            },
        });

        const loading = manager.load('level');
        await Promise.resolve();
        await manager.unload('level');          // the first teardown
        const rejected = expect(loading).rejects.toThrow(/cancelled/i);
        release();
        await rejected;                          // the load resumes, is cancelled, rolls back

        expect(spawned, 'the cancelled context never spawned an entity').toBe(0);
        expect(app.world.valid(spawned)).toBe(false);
        expect(assets.sizes().refRows, 'what it acquired after the unload').toBe(base);
        expect(unloaded, 'freed once, not twice').toEqual(['gen1']);
        expect([...getDrawCallbacks().values()].some(entry => entry.name === 'ghost')).toBe(false);
        expect(pp.getStack(CAMERA)).toBeNull();
        expect(manager.getScene('level')).toBeNull();
    });

    it('an entity promoted out of a SLEEPING scene comes out awake', async () => {
        // sleep() keeps the record of what an entity looked like awake on the
        // instance, and the instance is gone a line after the promotion — so an
        // entity carried out asleep can never be woken by anything.
        const { app, manager } = harness();
        let spawned = 0 as Entity;

        manager.register({
            name: 'level',
            setup: (ctx) => {
                spawned = ctx.spawn();
                app.world.insert(spawned, Drawn, { visible: true });
                ctx.setPersistent(spawned, true);
            },
        });
        await manager.load('level');
        manager.sleep('level');
        expect(app.world.has(spawned, Disabled), 'sleep() disables the scene').toBe(true);

        await manager.unload('level');

        expect(app.world.valid(spawned)).toBe(true);
        expect(app.world.has(spawned, Disabled), 'promoted still asleep, with nothing left to wake it').toBe(false);
        expect(app.world.get(spawned, Drawn).visible, 'and visible again').toBe(true);
    });

    it('a failed load cannot promote an entity to global ownership', async () => {
        // Persistence is a property of a COMMITTED scene. An entity marked
        // persistent inside a setup that then threw was never part of a scene
        // anyone kept, and must not escape the transaction as a global one.
        const { app, manager } = harness();
        let spawned = 0 as Entity;

        manager.register({
            name: 'level',
            setup: (ctx) => {
                spawned = ctx.spawn();
                ctx.setPersistent(spawned, true);
                throw new Error('boom');
            },
        });

        await expect(manager.load('level')).rejects.toThrow('boom');
        expect(app.world.valid(spawned), 'a persistent entity escaped a failed load').toBe(false);
    });
});

describe('unload decides who lives before it destroys anything', () => {
    /** A hierarchy the engine really walks: despawn takes the subtree with it. */
    function hierarchyApp() {
        const app = App.new();
        connectFakeCpp(app.world);
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        return { app, manager };
    }

    const at = (x: number, y: number) => ({
        position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x, y, z: 0 }, worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        worldScale: { x: 1, y: 1, z: 1 },
    });

    it.each(['unload', 'force', 'rollback'] as const)('keeps other scenes alive below unowned hierarchy nodes during %s', async mode => {
        const { app, manager } = hierarchyApp(), world = app.world;
        manager.register({ name: 'other' });
        const other = await manager.load('other'), guest = other.spawn(), guestChild = other.spawn();
        let root!: Entity, joint!: Entity, own!: Entity, promoted!: Entity;
        const fault = new Error('setup interrupted');
        manager.register({ name: 'level', setup(ctx) {
            root = ctx.spawn(); joint = world.spawn(); own = ctx.spawn(); promoted = ctx.spawn();
            // A native importer can attach its joint without populating the SDK membership cache.
            if (mode === 'rollback') world.getCppRegistry()!.setParent(joint, root);
            else world.setParent(joint, root);
            world.setParent(guest, joint);
            world.setParent(guestChild, guest);
            world.setParent(own, guest);
            world.setParent(promoted, joint);
            ctx.setPersistent(promoted, true);
            world.insert(guest, Transform, { ...at(220, 310), position: { x: 20, y: 10, z: 0 } });
            if (mode === 'rollback') throw fault;
        } });
        try {
            if (mode === 'rollback') await expect(manager.loadAdditive('level')).rejects.toBe(fault);
            else {
                await manager.loadAdditive('level');
                await manager.unload('level', { keepPersistent: mode !== 'force' });
            }
            expect(world.valid(guest)).toBe(true);
            expect(world.has(guest, Parent)).toBe(false);
            expect(world.get(guest, Transform).position).toEqual({ x: 220, y: 310, z: 0 });
            expect(world.get(guestChild, Parent).entity).toBe(guest);
            expect(other.entities).toEqual(new Set([guest, guestChild]));
            expect([root, joint, own].map(e => world.valid(e))).toEqual([false, false, false]);
            expect(world.valid(promoted)).toBe(mode === 'unload');
            if (mode === 'unload') {
                expect(world.has(promoted, Parent)).toBe(false);
                expect(world.get(promoted, SceneOwner).scene).toBe('');
            }
            await manager.unload('other');
            expect(world.valid(guest)).toBe(false);
        } finally { app.quit(); }
    });

    it('keeps an adopted parent’s previous-scene children when its new scene unloads first', async () => {
        const { app, manager } = hierarchyApp(), world = app.world;
        manager.register({ name: 'source' }); manager.register({ name: 'target' });
        try {
            const source = await manager.load('source'), target = await manager.loadAdditive('target');
            const parent = source.spawn(), child = source.spawn(), helper = world.spawn();
            world.setParent(helper, parent); world.setParent(child, helper);
            target.adopt(parent);
            await manager.unload('target');
            expect(world.valid(parent)).toBe(false);
            expect(world.valid(helper)).toBe(false);
            expect(world.valid(child)).toBe(true);
            expect(world.has(child, Parent)).toBe(false);
            expect(source.entities.has(child)).toBe(true);
            await manager.unload('source');
            expect(world.valid(child)).toBe(false);
        } finally { app.quit(); }
    });

    it('a persistent child of a doomed parent survives, where it was', async () => {
        // `despawn` tears down the whole subtree, so the parent's turn in the
        // loop was killing the survivor — and whether it lived at all came down
        // to which of the two the iteration reached first.
        const { app, manager } = hierarchyApp();
        let parent = 0 as Entity;
        let child = 0 as Entity;

        manager.register({
            name: 'level',
            setup: (ctx) => {
                parent = ctx.spawn();
                child = ctx.spawn();
                app.world.insert(parent, Transform, at(500, 200));
                app.world.insert(child, Transform, {
                    ...at(550, 200), position: { x: 50, y: 0, z: 0 },
                });
                app.world.setParent(child, parent);
                ctx.setPersistent(child, true);
            },
        });
        await manager.load('level');
        await manager.unload('level');

        expect(app.world.valid(parent), 'the doomed parent').toBe(false);
        expect(app.world.valid(child), 'the persistent child went down with it').toBe(true);
        expect(app.world.has(child, Parent), 'still parented to a dead entity').toBe(false);
        // And it did not jump: its local transform was relative to a parent that
        // is no longer there, so what survives is where it actually was.
        expect(app.world.get(child, Transform).position).toEqual({ x: 550, y: 200, z: 0 });
    });

    it('a persistent parent does not drag its non-persistent children along', async () => {
        // "This entity persists" is what the API says, not "this subtree does".
        const { app, manager } = hierarchyApp();
        let parent = 0 as Entity;
        let child = 0 as Entity;

        manager.register({
            name: 'level',
            setup: (ctx) => {
                parent = ctx.spawn();
                child = ctx.spawn();
                app.world.setParent(child, parent);
                ctx.setPersistent(parent, true);
            },
        });
        await manager.load('level');
        await manager.unload('level');

        expect(app.world.valid(parent), 'the persistent parent').toBe(true);
        expect(app.world.valid(child), 'a subtree persisted that nobody asked to persist').toBe(false);
    });

    it('a persistent child of a persistent parent keeps its parent', async () => {
        const { app, manager } = hierarchyApp();
        let parent = 0 as Entity;
        let child = 0 as Entity;

        manager.register({
            name: 'level',
            setup: (ctx) => {
                parent = ctx.spawn();
                child = ctx.spawn();
                app.world.insert(child, Transform, at(50, 0));
                app.world.setParent(child, parent);
                ctx.setPersistent(parent, true);
                ctx.setPersistent(child, true);
            },
        });
        await manager.load('level');
        await manager.unload('level');

        expect(app.world.valid(parent)).toBe(true);
        expect(app.world.valid(child)).toBe(true);
        // Nothing between them died, so nothing about them changes.
        expect(app.world.has(child, Parent), 'a surviving hierarchy was flattened').toBe(true);
        expect(app.world.get(child, Transform).position).toEqual({ x: 50, y: 0, z: 0 });
    });
});
