// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { EmbeddedBackend } from '../src/asset/Backend';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { AssetPlugin, Assets } from '../src/asset/AssetPlugin';
import { MeshRenderer, Sprite } from '../src/ecs/component';
import { defineSystem, Schedule } from '../src/ecs/system';
import { worldCellDocumentPath } from '../src/residency/report';
import { initRuntime } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';
import { SceneLoadCancelled, SceneManager, type SceneManagerState } from '../src/scene/sceneManager';
import { sceneManagerPlugin } from '../src/scene/scenePlugin';
import type { Entity } from '../src/types';
import { reservePromise } from '../src/util/reservePromise';
import * as resourceManager from '../src/wasm/resourceManager';

const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const empty: SceneData = { name: 'next', version: 4, entities: [] };

async function game(dimension: '2D' | '3D' = '2D') {
    const app = App.new();
    app.addPlugin(new AssetPlugin()); app.addPlugin(sceneManagerPlugin);
    const scenes = app.getResource(SceneManager), assets = app.getResource(Assets);
    const run = vi.fn(), cleanup = vi.fn(), release = vi.fn();
    let player!: Entity;
    scenes.register({
        name: 'home', cleanup, systems: [{ schedule: Schedule.Update, system: defineSystem([], run) }],
        setup(ctx) {
            player = ctx.spawn();
            if (dimension === '2D') app.world.insert(player, Sprite, {});
            else app.world.insert(player, MeshRenderer, {});
            const scope = new AssetScope();
            scope.add(ownedAssetLease('home', 1, 0, release));
            ctx.trackAssetScope(scope);
        },
    });
    const home = await scenes.load('home');
    const stillPlaying = async () => {
        expect(scenes.getActive()).toBe('home');
        expect(scenes.getScene('home')).toBe(home);
        expect(scenes.getSceneStatus('home')).toBe('running');
        expect(home.signal?.aborted).toBe(false);
        expect(app.world.valid(player)).toBe(true);
        expect(cleanup).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
        run.mockClear(); await app.tick(1 / 60); expect(run).toHaveBeenCalled();
    };
    return { app, scenes, assets, home, player, cleanup, release, stillPlaying };
}

async function drive<T>(scenes: SceneManagerState, result: Promise<T>): Promise<T> {
    let done = false;
    void result.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 100 && !done; i++) {
        scenes.updateTransition(0.1);
        await nextTurn();
    }
    return result;
}

describe.each(['2D', '3D'] as const)('%s scene switches', dimension => {
    it.each(['none', 'fade'] as const)('keeps the source live with %s through unknown names, broken files and unsupported formats', async transition => {
        const { app, scenes, assets, stillPlaying } = await game(dimension);
        const swap = () => drive(scenes, scenes.switchTo('next', { transition, duration: 0.2 }));
        try {
            await expect(swap()).rejects.toThrow('not registered'); await stillPlaying();
            const fetch = vi.spyOn(assets.backend, 'fetchText')
                .mockResolvedValueOnce('{').mockResolvedValueOnce(JSON.stringify({ ...empty, version: 999 }))
                .mockResolvedValueOnce(JSON.stringify(empty));
            scenes.register({ name: 'next', path: 'next.esscene' });
            await expect(swap()).rejects.toThrow(); await stillPlaying();
            await expect(swap()).rejects.toThrow(/newer/); await stillPlaying();
            await swap();
            expect(scenes.getActiveScenes()).toEqual(['next']);
            expect(fetch).toHaveBeenCalledTimes(3);
        } finally { app.quit(); }
    });
});

it('prepares raw scene assets before a same-name reload retires its live instance', async () => {
    const { app, scenes, assets, home, player, stillPlaying, cleanup, release } = await game();
    const fault = new Error('failed to read asset bytes');
    const gate = reservePromise<void>(), entered = reservePromise<void>();
    const preload = assets.preloadSceneAssets.bind(assets);
    const loadAssets = vi.spyOn(assets, 'preloadSceneAssets').mockRejectedValueOnce(fault).mockImplementationOnce(async (...args) => {
        entered.resolve(); await gate.promise; return preload(...args);
    });
    const setup = vi.fn(() => {
        expect(cleanup).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        expect(app.world.valid(player)).toBe(false);
        expect(home.signal?.aborted).toBe(true);
    });
    scenes.register({ name: 'home', data: empty, setup });
    try {
        await expect(scenes.reload()).rejects.toBe(fault);
        expect(setup).not.toHaveBeenCalled(); await stillPlaying();
        const reload = scenes.reload(); await entered.promise;
        const join = scenes.loadAdditive('home'), snapshot = scenes.whenLoadsSettle();
        await stillPlaying(); expect(scenes.getLoading()).toEqual(['home']);
        gate.resolve(); await Promise.all([reload, join, snapshot]);
        expect(await join).toBe(scenes.getScene('home'));
        expect(scenes.getScene('home')).not.toBe(home);
        expect(loadAssets).toHaveBeenCalledTimes(2); expect(setup).toHaveBeenCalledOnce();
    } finally { gate.resolve(); app.quit(); }
});

it('cancels a blocked preparation on unload or re-registration and cannot publish its late result', async () => {
    const { app, scenes, stillPlaying } = await game();
    const pending = reservePromise<void>(), discard = vi.fn(), setup = vi.fn();
    try {
        for (const action of ['unload', 'replace']) {
            scenes.register({ name: 'next', prepare: () => pending.promise, discardPrepared: discard, setup });
            const first = expect(scenes.switchTo('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
            const joined = expect(scenes.loadAdditive('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
            const waiting = scenes.whenLoadsSettle();
            if (action === 'unload') await scenes.unload('next');
            else scenes.register({ name: 'next' });
            await Promise.all([first, joined, waiting]);
            await stillPlaying();
        }
        await scenes.switchTo('next');
        pending.resolve(); await nextTurn();
        expect(setup).not.toHaveBeenCalled(); expect(scenes.getActiveScenes()).toEqual(['next']);
    } finally { pending.resolve(); app.quit(); }
});

it('rejects an HTTP error even when its body is valid scene JSON', async () => {
    const app = App.new();
    app.addPlugin(sceneManagerPlugin);
    const scenes = app.getResource(SceneManager);
    scenes.register({ name: 'home' });
    scenes.register({ name: 'next', path: 'next.esscene' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(empty), { status: 404 }));
    try {
        const home = await scenes.load('home');
        await expect(scenes.switchTo('next')).rejects.toThrow(/next\.esscene.*404/);
        expect(scenes.getActive()).toBe('home');
        expect(scenes.getScene('home')).toBe(home);
    } finally { fetch.mockRestore(); app.quit(); }
});

it('installs the streamed world belonging to the successful reload and retains its old cells on failure', async () => {
    const app = App.new();
    app.addPlugin(sceneManagerPlugin);
    let revision = 1;
    let invalid = false;
    const scenes = app.getResource(SceneManager);
    try {
        await initRuntime({
            app, module: null, firstScene: 'home',
            scenes: ['home', 'lobby'].map(name => ({ name, data: { ...empty, name } })),
            source: { backend: new EmbeddedBackend({}), decodePixels: async () => { throw new Error('unexpected image'); } },
            prepareWorld: async (data, name) => {
                if (name !== 'home' || revision === 0) return null;
                return {
                    persistent: invalid ? { ...data, version: 999 } : data,
                    manifest: { version: 1, scene: name, cellSize: 10, persistentRefs: [], cells: [{
                        name: 'block', path: 'block-' + revision, x: 0, z: 0, minX: 0, minZ: 0, maxX: 10,
                        maxZ: 10, entityCount: 0, rootCount: 0,
                    }] },
                    documents: new Map(),
                };
            },
        });
        const first = scenes.getScene('home');
        expect(worldCellDocumentPath(app, 'block')).toBe('block-1');
        revision = 2; invalid = true;
        await expect(scenes.reload()).rejects.toThrow(/newer/);
        expect(scenes.getScene('home')).toBe(first);
        await scenes.load('lobby'); await scenes.load('home');
        expect(worldCellDocumentPath(app, 'block')).toBe('block-1');
        invalid = false;
        await scenes.reload();
        expect(scenes.getScene('home')).not.toBe(first);
        expect(worldCellDocumentPath(app, 'block')).toBe('block-2');
        revision = 0;
        await scenes.reload();
        expect(worldCellDocumentPath(app, 'block')).toBeUndefined();
    } finally { app.quit(); }
});

it('waits for a destination that is already loading additively and keeps the source on failure or cancellation', async () => {
    const { app, scenes, stillPlaying } = await game();
    try {
        for (const cancel of [false, true]) {
            const gate = reservePromise<void>(), fault = new Error('setup rejected'), started = reservePromise<void>();
            scenes.register({ name: 'next', setup: () => { started.resolve(); return gate.promise; } });
            const background = scenes.loadAdditive('next').catch(error => error);
            await started.promise;
            const changed = scenes.switchTo('next').catch(error => error);
            const settled = scenes.whenLoadsSettle();
            try {
                if (cancel) await scenes.unload('next'); else gate.reject(fault);
                await settled;
                if (cancel) expect(await changed).toBeInstanceOf(SceneLoadCancelled);
                else expect(await changed).toBe(fault);
                await stillPlaying();
            } finally { gate.resolve(); await background; }
        }
    } finally { app.quit(); }
});

it('discards a prepared destination when outgoing residency refuses the handoff and retries cleanly', async () => {
    const { app, scenes, stillPlaying } = await game();
    const fault = new Error('old world is pinned');
    const prepare = vi.fn(async () => {}), discard = vi.fn(), setup = vi.fn();
    scenes.register({ name: 'next', prepare, discardPrepared: discard, setup });
    scenes.setActiveSceneHandler(vi.fn().mockRejectedValueOnce(fault));
    try {
        await expect(scenes.switchTo('next')).rejects.toBe(fault);
        expect(discard).toHaveBeenCalledOnce(); expect(setup).not.toHaveBeenCalled();
        await stillPlaying(); await scenes.switchTo('next');
        expect(prepare).toHaveBeenCalledTimes(2); expect(setup).toHaveBeenCalledOnce();
        expect(scenes.getActive()).toBe('next');
    } finally { app.quit(); }
});

it('settles the switch when its source unloads while an independent additive load is still pending', async () => {
    const { app, scenes } = await game();
    const gate = reservePromise<void>(), started = reservePromise<void>();
    scenes.register({ name: 'next', setup: () => { started.resolve(); return gate.promise; } });
    const background = scenes.loadAdditive('next');
    try {
        await started.promise;
        const switching = expect(scenes.switchTo('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
        await scenes.unload('home');
        await switching;
        gate.resolve(); await background;
        expect(scenes.getActive()).toBeNull();
        expect(scenes.getActiveScenes()).toEqual(['next']);
    } finally { gate.resolve(); await background; app.quit(); }
});

it('keeps a newly activated scene when an older switch finishes preparing', async () => {
    const { app, scenes, home } = await game();
    const ready = reservePromise<void>(), discard = vi.fn(), setup = vi.fn();
    scenes.register({ name: 'next', prepare: () => ready.promise, discardPrepared: discard, setup });
    scenes.register({ name: 'lobby' });
    try {
        const switching = expect(scenes.switchTo('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
        await scenes.prepare('next');
        expect(scenes.discardPrepared('next')).toBe(0);
        expect(discard).not.toHaveBeenCalled();
        await scenes.load('lobby');
        ready.resolve(); await switching;
        expect(scenes.getActive()).toBe('lobby');
        expect(scenes.getScene('home')).toBe(home);
        expect(discard).toHaveBeenCalledOnce(); expect(setup).not.toHaveBeenCalled();
    } finally { ready.resolve(); app.quit(); }
});

it('releases incoming raw assets immediately when cancelled during staggered outgoing retirement', async () => {
    const app = App.new();
    app.addPlugin(new AssetPlugin()); app.addPlugin(sceneManagerPlugin);
    const scenes = app.getResource(SceneManager), assets = app.getResource(Assets);
    const retiring = reservePromise<void>(), finish = reservePromise<void>(), release = vi.fn();
    scenes.register({ name: 'home', retire: () => { retiring.resolve(); return finish.promise; } });
    scenes.register({ name: 'next', data: empty });
    try {
        await scenes.load('home');
        const content = await assets.preloadSceneAssets(empty);
        content.scope.add(ownedAssetLease('incoming', 1, 0, release));
        vi.spyOn(assets, 'preloadSceneAssets').mockResolvedValueOnce(content);
        const switching = expect(scenes.switchTo('next', { staggered: true })).rejects.toBeInstanceOf(SceneLoadCancelled);
        await retiring.promise;
        await scenes.unload('next'); await switching;
        expect(release).toHaveBeenCalledOnce();
        finish.resolve(); await scenes.whenLoadsSettle();
        expect(scenes.getScene('next')).toBeNull();
    } finally { finish.resolve(); app.quit(); }
});

it.each(['authored', 'packaged'])('applies the %s scene’s shared UI texture border only after handoff', async entry => {
    const app = App.new();
    app.addPlugin(sceneManagerPlugin);
    const scenes = app.getResource(SceneManager);
    const border = vi.fn();
    const rm = vi.spyOn(resourceManager, 'requireResourceManager').mockReturnValue({
        setTextureMetadata: border,
    } as unknown as ReturnType<typeof resourceManager.requireResourceManager>);
    const data: SceneData = { ...empty, textureMetadata: { shared: {
        version: '1.0', type: 'texture', sliceBorder: { left: 1, right: 2, top: 3, bottom: 4 },
    } } };
    try {
        await initRuntime({
            app, module: null, firstScene: '', scenes: entry === 'packaged' ? [{ name: 'next', data }] : [],
            source: { backend: new EmbeddedBackend({}), decodePixels: async () => { throw new Error('unexpected image'); } },
        });
        if (entry === 'authored') scenes.register({ name: 'next', data });
        const assets = app.getResource(Assets);
        const preload = assets.preloadSceneAssets.bind(assets);
        vi.spyOn(assets, 'preloadSceneAssets').mockImplementation(async (...args) => {
            const content = await preload(...args);
            content.textureHandles.set('shared', 7);
            return content;
        });
        scenes.register({ name: 'home' });
        await scenes.load('home');
        scenes.setActiveSceneHandler(vi.fn().mockRejectedValueOnce(new Error('old world still busy')));
        await expect(scenes.switchTo('next')).rejects.toThrow('old world still busy');
        expect(border).not.toHaveBeenCalled();
        await scenes.switchTo('next');
        expect(border).toHaveBeenCalledOnce();
        expect(border).toHaveBeenCalledWith(7, 1, 2, 3, 4);
    } finally { rm.mockRestore(); app.quit(); }
});

it('reports live packaged asset progress to callers joining a switch while the source is still running', async () => {
    const app = App.new();
    app.addPlugin(sceneManagerPlugin);
    const scenes = app.getResource(SceneManager);
    const started = reservePromise<void>(), finish = reservePromise<void>();
    try {
        await initRuntime({
            app, module: null, firstScene: '', scenes: [{ name: 'next', data: empty }],
            source: { backend: new EmbeddedBackend({}), decodePixels: async () => { throw new Error('unexpected image'); } },
        });
        scenes.register({ name: 'home' });
        const home = await scenes.load('home');
        const assets = app.getResource(Assets), preload = assets.preloadSceneAssets.bind(assets);
        vi.spyOn(assets, 'preloadSceneAssets').mockImplementationOnce(async (data, progress, options) => {
            const content = await preload(data, undefined, options);
            progress?.(1, 2); started.resolve(); await finish.promise;
            progress?.(2, 2); return content;
        });
        const switching = scenes.switchTo('next');
        await started.promise;
        const progress = vi.fn(), joined = scenes.loadAdditive('next', progress);
        try {
            expect(scenes.getScene('home')).toBe(home);
            expect(progress.mock.calls).toEqual([[1, 2]]);
        } finally { finish.resolve(); await Promise.all([switching, joined]); }
        expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    } finally { finish.resolve(); app.quit(); }
});
