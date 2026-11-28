// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Two scenes arriving in one tick install one subsystem between them.
 *
 * Turning a corner in a streamed world can ready several cells at once. The
 * cells share each module read, keep their own lifetimes, and install the
 * solver once when the first cell using it actually publishes.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRuntimeSceneConfig, loadRuntimeScene, prepareRuntimeScene, publishRuntimeScene, sceneUsesPhysics, sceneUses3DPhysics, sceneUsesI18n } from '../src/runtime/runtimeLoader';
import { SceneLoadCancelled } from '../src/scene/sceneManager';
import { reservePromise } from '../src/util/reservePromise';
// The optional subsystems are installed by an ENTRY, and this imports the loader
// directly — so it says which environment it is testing rather than relying on
// another test having imported one first.
import { installOptionalPlugins } from '../src/runtime/optionalPlugins';

installOptionalPlugins();
import { Physics3DPlugin } from '../src/physics3d/Physics3DPlugin';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import { World } from '../src/ecs/world';
import { App } from '../src/app/app';
import { collectGarbage } from '../src/diagnostics/census';
import { LocalizationPlugin } from '../src/i18n/LocalizationPlugin';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';
import type { SceneData } from '../src/scene/scene';

const fakeModule = { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule;
const fakeBackend = {
    resolveUrl: (p: string) => p,
    fetchText: async () => '',
    fetchBinary: async () => new ArrayBuffer(0),
} as unknown as Backend;

/** A side-module host that takes a turn to answer — the window the race lives in. */
function makeFakeApp(acquired: string[], firstAcquire?: () => Promise<void>) {
    const resources = new Map<unknown, unknown>();
    const plugins: object[] = [];
    const app = {
        world: new World(),
        hasResource: (r: unknown) => resources.has(r),
        getResource: (r: unknown) => resources.get(r),
        insertResource: (r: unknown, v: unknown) => { resources.set(r, v); },
        addPlugin: (p: object) => {
            plugins.push(p);
            if (p instanceof LocalizationPlugin) p.build(app);
        },
        getPlugin: (kind: abstract new (...args: never[]) => object) =>
            plugins.find((p) => p instanceof kind) ?? null,
        sideModules: {
            acquire: async (id: string) => {
                acquired.push(id);
                if (acquired.length === 1) await firstAcquire?.();
                await Promise.resolve();
                await Promise.resolve();
                return fakeModule;
            },
        },
    } as unknown as App;
    return { app, plugins };
}

/** A cell's worth of scene: one entity carrying a 3D body. */
const cell = (name: string): SceneData => ({
    version: '1.0',
    name,
    entities: [{
        id: 1, name: 'Prop', parent: null, children: [], visible: true,
        components: [{ type: 'RigidBody3D', data: { bodyType: 0 } }],
    }],
});

const options = (app: App) => ({
    app,
    module: fakeModule,
    source: {
        backend: fakeBackend,
        decodePixels: () => Promise.reject(new Error('no textures here')),
    },
    spineManager: null,
});
const load = (app: App, sceneData: SceneData): Promise<void> => loadRuntimeScene({ ...options(app), sceneData });

describe('subsystems a scene installs for itself', () => {
    it('prepares subsystems for spawned entities and project-declared physics', async () => {
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);
        const listAssetPaths = vi.fn(() => []);
        const loadOptions = options(app);
        const source = { ...loadOptions.source, listAssetPaths };
        const data = cell('hidden');
        const hidden = data.entities[0]!;
        hidden.visible = false;
        hidden.components.push(
            { type: 'RigidBody2D', data: {} },
            { type: 'Text', data: { i18nKey: 'prop.name' } },
        );
        data.entities.push({ ...hidden, id: 2, name: 'Plain', visible: true, components: [] });

        // The exported detectors scan the authored document, including hidden rows.
        expect(sceneUsesPhysics(data)).toBe(true);
        expect(sceneUses3DPhysics(data)).toBe(true);
        expect(sceneUsesI18n(data)).toBe(true);

        await loadRuntimeScene({ ...loadOptions, source, sceneData: data });
        expect(app.world.getAllEntities()).toHaveLength(1);
        expect({ modules: acquired, localeScans: listAssetPaths.mock.calls.length, plugins: plugins.length })
            .toEqual({ modules: [], localeScans: 0, plugins: 0 });

        await loadRuntimeScene({ ...loadOptions, source, sceneData: data, physicsEnabled: true });
        expect(acquired).toEqual(['physics']);
        expect(plugins[0]).toBeInstanceOf(Physics2DPlugin);

        hidden.visible = true;
        await loadRuntimeScene({ ...loadOptions, source, sceneData: data });
        expect(acquired).toEqual(['physics', 'physics3d']);
        expect(listAssetPaths).toHaveBeenCalledOnce();
    });

    it('rejoins a pending module when a scene returns to its original host', async () => {
        const app = App.new(), entered = reservePromise<void>(), finish = reservePromise<void>();
        const first = { acquire: vi.fn(async () => { entered.resolve(); await finish.promise; return null; }) };
        const second = { acquire: vi.fn(async () => null) };
        const config = (name: string) => createRuntimeSceneConfig(name, cell(name), { ...options(app), module: null });
        const a = config('a'), b = config('b'), c = config('c');
        try {
            app.setSideModules(first);
            const reading = a.prepare!();
            await entered.promise;
            app.setSideModules(second);
            await b.prepare!();
            app.setSideModules(first);
            const joined = c.prepare!();
            // All scene data is in memory. Let the third cell reach the pending provider before releasing it.
            await new Promise(resolve => setTimeout(resolve, 0));
            finish.resolve();
            await Promise.all([reading, joined]);
            expect(first.acquire).toHaveBeenCalledOnce();
            expect(second.acquire).toHaveBeenCalledOnce();
        } finally {
            finish.resolve();
            for (const scene of [a, b, c]) scene.discardPrepared!();
            app.quit();
        }
    });

    it('lets a retired module host be collected while its app keeps running', async () => {
        const app = App.new();
        const retire = async () => {
            const host = { acquire: async () => null };
            const ref = new WeakRef(host);
            app.setSideModules(host);
            const scene = createRuntimeSceneConfig('old', cell('old'), { ...options(app), module: null });
            await scene.prepare!();
            scene.discardPrepared!();
            app.setSideModules({ acquire: async () => null });
            return ref;
        };
        try {
            const retired = await retire();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(collectGarbage()).toBe(true);
            expect(retired.deref()).toBeUndefined();
        } finally { app.quit(); }
    });

    it.each(['2D', '3D'] as const)('discards a speculative %s physics request before it installs a world', async dimension => {
        const entered = reservePromise<void>(), finish = reservePromise<void>(), acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired, () => { entered.resolve(); return finish.promise; });
        const data = cell('discarded');
        data.entities[0]!.components[0]!.type = 'RigidBody' + dimension;
        const config = createRuntimeSceneConfig(data.name, data, options(app));
        const old = expect(config.prepare!()).rejects.toBeInstanceOf(SceneLoadCancelled);
        await entered.promise;
        config.discardPrepared!();
        try { await old; } finally { finish.resolve(); }
        expect(plugins).toHaveLength(0);
        expect(app.world.getAllEntities()).toEqual([]);
    });

    it.each(['2D', '3D'] as const)('keeps a fully prepared %s solver out of the world until a scene publishes', async dimension => {
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);
        const data = cell('prefetched');
        data.entities[0]!.components[0]!.type = 'RigidBody' + dimension;
        const prepared = await prepareRuntimeScene({ ...options(app), sceneData: data });
        expect(acquired).toEqual([dimension === '2D' ? 'physics' : 'physics3d']);
        expect(plugins).toHaveLength(0);
        await publishRuntimeScene(prepared);
        expect(plugins).toHaveLength(1);
        await load(app, data);
        expect(plugins).toHaveLength(1);
        expect(acquired).toHaveLength(1);
    });

    it.each(['2D', '3D'] as const)('lets a second %s scene finish the shared read after the first scene leaves', async dimension => {
        const acquired: string[] = [], entered = reservePromise<void>(), finish = reservePromise<void>();
        const { app, plugins } = makeFakeApp(acquired, () => { entered.resolve(); return finish.promise; });
        const data = cell('old');
        data.entities[0]!.components[0]!.type = 'RigidBody' + dimension;
        const old = createRuntimeSceneConfig(data.name, data, options(app));
        const stopped = expect(old.prepare!()).rejects.toBeInstanceOf(SceneLoadCancelled);
        await entered.promise;
        const live = load(app, data);
        old.discardPrepared!();
        try { await stopped; } finally { finish.resolve(); }
        await live;
        expect(plugins).toHaveLength(1);
        expect(acquired).toHaveLength(1);
    });

    it('allows a PhysX scene to publish while an unused Jolt module is in flight', async () => {
        const acquired: string[] = [], entered = reservePromise<void>(), finish = reservePromise<void>();
        const { app, plugins } = makeFakeApp(acquired, () => { entered.resolve(); return finish.promise; });
        const jolt = createRuntimeSceneConfig('jolt', cell('jolt'), options(app));
        const stopped = expect(jolt.prepare!()).rejects.toBeInstanceOf(SceneLoadCancelled);
        await entered.promise;
        const live = loadRuntimeScene({ ...options(app), sceneData: cell('live'), physics3dBackend: 'physx' });
        try {
            await live;
            expect(plugins).toHaveLength(1);
            expect(app.world.getAllEntities()).toHaveLength(1);
        } finally {
            jolt.discardPrepared!();
            finish.resolve();
            await stopped;
        }
        expect(acquired).toEqual(['physics3d', 'physics3d:physx']);
    });

    it.each(['2D', '3D'] as const)('allows a ready %s physics module to serve a replacement while a discarded read is pending', async dimension => {
        const entered = reservePromise<void>(), finish = reservePromise<void>(), acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired, () => { entered.resolve(); return finish.promise; });
        const data = cell('cell');
        data.entities[0]!.components[0]!.type = 'RigidBody' + dimension;
        const config = createRuntimeSceneConfig(data.name, data, options(app));
        const old = expect(config.prepare!()).rejects.toBeInstanceOf(SceneLoadCancelled);
        await entered.promise;
        config.discardPrepared!();
        const replacement = loadRuntimeScene({ ...options(app), sceneData: data,
            physicsModule: fakeModule as unknown as PhysicsWasmModule,
            physics3dModule: fakeModule as unknown as Physics3DWasmModule });
        try {
            await vi.waitFor(() => expect(app.world.getAllEntities()).toHaveLength(1));
        } finally { finish.resolve(); await Promise.all([old, replacement]); }
        expect(plugins.filter(p => p instanceof (dimension === '2D' ? Physics2DPlugin : Physics3DPlugin))).toHaveLength(1);
        expect(acquired).toEqual([dimension === '2D' ? 'physics' : 'physics3d']);
    });

    it('are installed once when several cells arrive together', async () => {
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);

        // Concurrently, which is what residency does: one reconciliation asks for
        // every cell that came into range this frame.
        await Promise.all([cell('c0'), cell('c1'), cell('c2'), cell('c3')].map((s) => load(app, s)));

        const installed = plugins.filter((p) => p instanceof Physics3DPlugin);
        expect(installed).toHaveLength(1);
        expect(acquired.filter((id) => id === 'physics3d')).toHaveLength(1);
    });

    it('and a later cell reuses the one already there', async () => {
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);
        await load(app, cell('first'));
        await load(app, cell('second'));
        expect(plugins.filter((p) => p instanceof Physics3DPlugin)).toHaveLength(1);
    });

    it('starts physics for a replacement world while its predecessor is waiting for the module', async () => {
        const acquired: string[] = [];
        const started = reservePromise<void>(), finish = reservePromise<void>();
        const { app, plugins } = makeFakeApp(acquired, () => { started.resolve(); return finish.promise; });
        const old = expect(load(app, cell('old'))).rejects.toBeInstanceOf(SceneLoadCancelled);
        await started.promise;
        app.world.disconnectCpp();
        const current = load(app, cell('current'));
        try {
            await vi.waitFor(() => expect(plugins.filter(p => p instanceof Physics3DPlugin)).toHaveLength(1));
        } finally {
            finish.resolve();
            await Promise.all([old, current]);
        }
        expect(acquired).toEqual(['physics3d', 'physics3d']);
        expect(app.world.getAllEntities()).toHaveLength(1);
    });

    it('installs for a cell that needs it even when the one before did not', async () => {
        // The latch must not swallow a decision: the first scene has no bodies,
        // so what it finished tells the second nothing about what IT needs.
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);
        const plain: SceneData = { version: '1.0', name: 'plain', entities: [] };
        await Promise.all([load(app, plain), load(app, cell('withBodies'))]);
        expect(plugins.filter((p) => p instanceof Physics3DPlugin)).toHaveLength(1);
    });
});
