// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plugin-cleanup.test.ts
 * @brief   Physics/Spine plugins must release
 *          their native module + world listeners on app teardown (App calls
 *          plugin.cleanup() at shutdown). Before this, `_physics_shutdown` was
 *          dead code, the spine backends were never disposed, and the
 *          world.onDespawn subscription was leaked, so re-init left a stale
 *          listener pointing at a dead manager.
 */
import { describe, expect, it, vi } from 'vitest';
import { SpineManager } from '../src/spine/SpineManager';
import { SpinePlugin } from '../src/spine/SpinePlugin';
import { DragonBones, DragonBonesPlugin } from '../src/dragonbones/DragonBonesPlugin';
import { fakeSpineEra, fakeSpineModule } from './helpers/fakeSpineModule';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { App } from '../src/app/app';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';

describe('SpineManager.dispose', () => {
    it('shuts down every backend and clears all state, idempotently', () => {
        const mgr = new SpineManager({} as any, new Map());
        const backendA = { dispose: vi.fn() };
        const backendB = { dispose: vi.fn() };
        const m = mgr as any;
        m.runtimes_.set('3.8', backendA);
        m.runtimes_.set('4.1', backendB);
        m.bindings_.set(1, backendA);
        m.loadingRuntimes_.set('4.2', Promise.resolve(null));

        mgr.dispose();

        expect(backendA.dispose).toHaveBeenCalledTimes(1);
        expect(backendB.dispose).toHaveBeenCalledTimes(1);
        expect(m.runtimes_.size).toBe(0);
        expect(m.bindings_.size).toBe(0);
        expect(m.loadingRuntimes_.size).toBe(0);

        // Idempotent: a second dispose is a no-op, not a re-shutdown / throw.
        expect(() => mgr.dispose()).not.toThrow();
        expect(backendA.dispose).toHaveBeenCalledTimes(1);
    });
});

describe('SpinePlugin.cleanup', () => {
    it('uses the new app\'s module host when the plugin is installed again', async () => {
        const plugin = new SpinePlugin();
        const era = fakeSpineEra('preview', '{"skeleton":{"spine":"4.2"}}');
        const hosts = [];
        for (let i = 0; i < 2; ++i) {
            const app = App.new();
            vi.spyOn(app, 'wasmModule', 'get').mockReturnValue({} as never);
            const host = { acquire: vi.fn(async () => fakeSpineModule().module as never) };
            hosts.push(host);
            app.setSideModules(host);
            app.addPlugin(plugin);
            try {
                const preview = await plugin.spineManager!.openPreview(era);
                expect(preview).not.toBeNull();
                preview!.dispose();
            } finally { app.quit({ keepRenderer: true }); }
        }
        for (const host of hosts) {
            expect(host.acquire).toHaveBeenCalledOnce();
            expect(host.acquire).toHaveBeenCalledWith('spine:4.2');
        }
    });

    it('unsubscribes the despawn listener and disposes the spine manager', () => {
        const plugin = new SpinePlugin();
        const unsub = vi.fn();
        const manager = { dispose: vi.fn() };
        const p = plugin as any;
        p.despawnUnsub_ = unsub;
        p.spineManager_ = manager;

        plugin.cleanup();

        expect(unsub).toHaveBeenCalledTimes(1);
        expect(manager.dispose).toHaveBeenCalledTimes(1);
        expect(p.despawnUnsub_).toBeNull();

        // A second cleanup must not re-fire the (now dropped) subscription.
        plugin.cleanup();
        expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('is safe to call when build never ran (no subscription / manager)', () => {
        const plugin = new SpinePlugin();
        expect(() => plugin.cleanup()).not.toThrow();
    });

    it('releases the host-created manager when a tool replaces it', () => {
        const app = App.new();
        vi.spyOn(app, 'wasmModule', 'get').mockReturnValue({} as never);
        app.setSideModules({ acquire: async () => null });
        const plugin = new SpinePlugin();
        app.addPlugin(plugin);
        const old = vi.spyOn(plugin.spineManager!, 'dispose');
        const replacement = new SpineManager({} as never, new Map());
        const dispose = vi.spyOn(replacement, 'dispose');
        try {
            plugin.setSpineManager(replacement);
            plugin.setSpineManager(replacement);
            expect(old).toHaveBeenCalledOnce();
            expect(dispose).not.toHaveBeenCalled();
        } finally { app.quit({ keepRenderer: true }); }
        expect(dispose).toHaveBeenCalledOnce();
    });
});

describe('DragonBonesPlugin.acquire', () => {
    it('an old app finishing its load cannot replace or cancel a new app\'s acquisition', async () => {
        const pendingHost = () => {
            let finish!: () => void;
            const wait = new Promise<void>(resolve => { finish = resolve; });
            const acquire = vi.fn(async () => { await wait; return { cwrap: () => () => 0 }; });
            return { finish, acquire };
        };
        const first = App.new(), second = App.new();
        const oldHost = pendingHost(), newHost = pendingHost();
        const plugin = new DragonBonesPlugin();
        first.setSideModules(oldHost);
        first.addPlugin(plugin);
        const retired = plugin.acquire();
        first.quit({ keepRenderer: true });
        expect(await plugin.acquire()).toBeNull();
        second.setSideModules(newHost);
        second.addPlugin(plugin);
        try {
            const current = plugin.acquire();
            oldHost.finish();
            expect(await retired).toBeNull();
            expect(second.getResource(DragonBones)).toBeNull();
            expect(plugin.acquire()).toBe(current);
            newHost.finish();
            const manager = await current;
            expect(manager).not.toBeNull();
            expect(second.getResource(DragonBones)).toBe(manager);
            expect(newHost.acquire).toHaveBeenCalledOnce();
        } finally { second.quit({ keepRenderer: true }); }
    });
});

describe('Physics2DPlugin.cleanup', () => {
    it('shuts down the native physics world and nulls the module', async () => {
        const shutdown = vi.fn();
        const module = Object.fromEntries([
            '_physics_init', '_physics_setWorldConfig', '_physics_step', '_physics_capturePoses',
            '_physics_getInterpolatedCount', '_physics_getInterpolatedTransforms', '_physics_collectEvents',
            '_physics_getDynamicBodyCount', '_physics_getDynamicBodyTransforms', '_physics_setBodyTransform',
            '_physics_setOneWayPlatformLocal',
        ].map(name => [name, vi.fn(() => 0)])) as unknown as PhysicsWasmModule;
        module._physics_shutdown = shutdown;
        const plugin = new Physics2DPlugin('', {}, async () => module);
        const app = App.new().addPlugin(plugin);
        const runtime = app.getResource(Physics2DRuntime);
        try {
            await runtime.initPromise;
            expect(runtime.module).not.toBeNull();
            app.quit();
            expect(shutdown).toHaveBeenCalledTimes(1);
            expect(runtime.module).toBeNull();
            plugin.cleanup();
            expect(shutdown).toHaveBeenCalledTimes(1);
        } finally { app.quit(); }
    });

    it('is safe to call before the async module load completed', () => {
        const plugin = new Physics2DPlugin('fake://physics.wasm');
        expect(() => plugin.cleanup()).not.toThrow();
    });
});
