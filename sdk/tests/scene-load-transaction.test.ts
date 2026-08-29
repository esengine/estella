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
import { Schedule, defineSystem } from '../src/ecs/system';
import { SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import { PostProcess } from '../src/postprocess';
import { getDrawCallbacks, clearDrawCallbacks } from '../src/render/customDraw';
import { Disabled, Parent, Transform, defineComponent } from '../src/ecs/component';
import { connectFakeCpp } from './helpers/fakeEngine';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';

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

/** The post-process surface a scene binds against, modelled: bind/unbind/getStack
 *  over a table, so "the binding is gone" is something the test can read. */
function postProcessFake() {
    const bound = new Map<Entity, unknown>();
    return {
        bind: (camera: Entity, stack: unknown) => { bound.set(camera, stack); },
        unbind: (camera: Entity) => { bound.delete(camera); },
        getStack: (camera: Entity) => bound.get(camera) ?? null,
        size: () => bound.size,
    };
}

function harness() {
    const unloaded: string[] = [];
    const app = App.new();
    const assets = makeAssets(unloaded);
    const manager = new SceneManagerState(app);
    const pp = postProcessFake();
    app.insertResource(AssetsResource, assets as never);
    app.insertResource(SceneManager, manager);
    app.insertResource(PostProcess, pp as never);
    return { app, assets, manager, pp, unloaded };
}

const CAMERA = 7 as Entity;

/** Something sleep() switches off — the engine's renderables are C++-backed,
 *  and what is under test is the protocol, not the component. */
const Drawn = defineComponent('SleepPromotionDrawn', { visible: true }, { renderableField: 'visible' });

describe('a scene load that fails leaves nothing of itself behind', () => {
    beforeEach(() => { clearDrawCallbacks(); });

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
        expect(getDrawCallbacks().has('ghost'), 'the draw callback it registered').toBe(false);
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
        expect(getDrawCallbacks().has('ghost')).toBe(false);
        expect(pp.getStack(CAMERA)).toBeNull();
        expect(manager.getScene('level')).toBeNull();
    });

    it('an unload during the load, then the load\'s own rollback, frees each thing once', async () => {
        // The teardown runs twice over one instance — and the second time it has
        // to cope with what the first one could not have seen: the in-flight
        // setup went on acquiring after the unload had already let go.
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
                spawned = ctx.spawn();
                const scope = new AssetScope();
                scope.add(await assets.acquireTyped('font', 'hero.ttf'));
                ctx.trackAssetScope(scope);
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

        expect(app.world.valid(spawned), 'the entity the cancelled load spawned').toBe(false);
        expect(assets.sizes().refRows, 'what it acquired after the unload').toBe(base);
        expect(unloaded, 'freed once, not twice').toEqual(['gen1']);
        expect(getDrawCallbacks().has('ghost')).toBe(false);
        expect(pp.size()).toBe(0);
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
