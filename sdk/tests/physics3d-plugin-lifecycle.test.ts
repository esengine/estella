// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Breakable, BreakablePlugin } from '../src/breakable/breakable';
import { CameraCollision } from '../src/camera/CameraDeoccluder';
import { Transform } from '../src/ecs/component';
import { BoxCollider3D, RigidBody3D } from '../src/physics3d/Physics3DComponents';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import { Physics3D, Physics3DPlugin, Physics3DRuntime } from '../src/physics3d/Physics3DPlugin';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

const apps: App[] = [];
function build(plugin: Physics3DPlugin) {
    const app = App.new();
    apps.push(app);
    app.addPlugin(plugin);
    return app;
}
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

it('preserves the load rejection without reporting a failure on a stopped app', async () => {
    let reject!: (error: Error) => void;
    const app = build(new Physics3DPlugin('', {}, () => new Promise((_, fail) => { reject = fail; })));
    const runtime = app.getResource(Physics3DRuntime);
    const report = vi.spyOn(app.subsystems, 'markError');
    app.quit();
    reject(Error('module unavailable'));
    await expect(runtime.initPromise).rejects.toThrow('module unavailable');
    expect(report).not.toHaveBeenCalled();
});

describe.skipIf(!hasSideModule('physics3d'))('3D solver installation', () => {
    it('discards a late module when the same app has already started a new installation', async () => {
        const oldModule = await loadSideModule<Physics3DWasmModule>('physics3d');
        const currentModule = await loadSideModule<Physics3DWasmModule>('physics3d');
        let resolve!: (module: Physics3DWasmModule) => void;
        const factory = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; }))
            .mockResolvedValueOnce(currentModule);
        const plugin = new Physics3DPlugin('', {}, factory);
        const app = build(plugin);
        const old = app.getResource(Physics3DRuntime);
        app.quit();
        app.addPlugin(plugin);
        const current = app.getResource(Physics3DRuntime);
        await current.initPromise;
        const addSystem = vi.spyOn(app, 'addSystemToSchedule');
        resolve(oldModule);
        await old.initPromise;
        expect(oldModule._physics3d_isReady()).toBe(0);
        expect(old.module).toBeNull();
        expect(addSystem).not.toHaveBeenCalled();
        expect(current.module).toBe(currentModule);
        app.quit();
        expect(currentModule._physics3d_isReady()).toBe(0);
    });

    it('keeps gravity and solver shutdown local to the app that owns the world', async () => {
        const plugin = new Physics3DPlugin('', { gravity: { x: 0, y: -5, z: 0 } },
            () => loadSideModule<Physics3DWasmModule>('physics3d'));
        const first = build(plugin);
        const second = build(plugin);
        const a = first.getResource(Physics3DRuntime);
        const b = second.getResource(Physics3DRuntime);
        await Promise.all([a.initPromise, b.initPromise]);
        const firstModule = a.module!;
        const secondModule = b.module!;
        expect(first.getResource(Physics3D)!.setGravity({ x: 0, y: -2, z: 0 })).toBe(true);
        expect(second.getResource(Physics3D)!.getGravity().y).toBe(-5);

        first.quit();
        expect(a.module).toBeNull();
        expect(first.getResource(Physics3D)).toBeNull();
        expect(first.getResource(CameraCollision)).toBeNull();
        expect(firstModule._physics3d_isReady()).toBe(0);
        expect(secondModule._physics3d_isReady()).toBe(1);
        plugin.cleanup();
        plugin.cleanup();
        expect(b.module).toBeNull();
        expect(secondModule._physics3d_isReady()).toBe(0);
    });

    it('releases a solver when installing its settings fails after native initialization', async () => {
        const module = await loadSideModule<Physics3DWasmModule>('physics3d');
        vi.spyOn(module, '_physics3d_setSolver').mockImplementationOnce(() => { throw Error('solver settings failed'); });
        const app = build(new Physics3DPlugin('', {}, async () => module));
        const runtime = app.getResource(Physics3DRuntime);
        await expect(runtime.initPromise).rejects.toThrow('solver settings failed');
        expect(module._physics3d_isReady()).toBe(0);
        expect(runtime.module).toBeNull();
        expect(app.hasResource(Physics3D)).toBe(false);
    });

    it('keeps a cached native module with its first owner until that owner stops', async () => {
        const module = await loadSideModule<Physics3DWasmModule>('physics3d');
        const factory = async () => module;
        const first = build(new Physics3DPlugin('', {}, factory));
        await first.getResource(Physics3DRuntime).initPromise;
        const plugin = new Physics3DPlugin('', {}, factory);
        const second = build(plugin);
        await expect(second.getResource(Physics3DRuntime).initPromise).rejects.toThrow('one App at a time');
        second.quit();
        expect(module._physics3d_isReady()).toBe(1);
        first.quit();
        second.addPlugin(plugin);
        await second.getResource(Physics3DRuntime).initPromise;
        expect(second.getResource(Physics3DRuntime).module).toBe(module);
    });

    it.skipIf(!HAS_WASM)('delivers a blast only to breakables in its own registry', async () => {
        const engine = await loadWasmModule();
        const plugin = new Physics3DPlugin('', { gravity: { x: 0, y: 0, z: 0 } },
            () => loadSideModule<Physics3DWasmModule>('physics3d'));
        const breakables = new BreakablePlugin();
        const scene = async () => {
            const app = build(plugin);
            app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
            app.addPlugin(breakables);
            const pot = app.world.spawn();
            app.world.insert(pot, Transform, { position: { x: 30, y: 0, z: 0 } });
            app.world.insert(pot, RigidBody3D, { bodyType: 2 });
            app.world.insert(pot, BoxCollider3D, { halfExtents: { x: 5, y: 5, z: 5 } });
            app.world.insert(pot, Breakable, { breakImpulse: 100 });
            await app.getResource(Physics3DRuntime).initPromise;
            await app.stepFrames(2, 1 / 30);
            return { app, pot };
        };
        const first = await scene();
        const second = await scene();
        expect(first.pot).toBe(second.pot);
        expect(first.app.getResource(Physics3D)!.explode({ x: 0, y: 0, z: 0 }, 100, 500)).toBe(1);
        await first.app.tick(1 / 30);
        await second.app.tick(1 / 30);
        expect(first.app.world.get(first.pot, Breakable).broken).toBe(true);
        expect(second.app.world.get(second.pot, Breakable).broken).toBe(false);
    });
});
