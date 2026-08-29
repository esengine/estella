// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    persistent-promotion.test.ts
 * @brief   An entity that outlives its scene owns what it is still bound to.
 *
 * @details The scene is about to give its receipts back and the app's ownership
 *          never ends, so neither could answer for a persistent entity: the
 *          documented workaround was for the game to preload the asset itself.
 *          Promotion splits the scene's acquisition instead — the exact one the
 *          entity's fields name, which after a hot update the scene did not
 *          follow is not the one its path resolves to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { ensureBuiltinComponentsRegistered, Sprite, MeshRenderer, TrailRenderer } from '../src/ecs/component';
import { connectFakeCpp } from './helpers/fakeEngine';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';

/** The pool, modelled: every decode mints a handle, invalidate severs revival. */
function createPoolFake() {
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => next++),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn(),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
        getTextureGLId: vi.fn(() => 1),
        setTextureMetadata: vi.fn(),
    };
}
let pool = createPoolFake();
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 64, height: 64,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64 * 64 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(), platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(), platformFileExists: vi.fn(),
    platformLoadSubpackage: vi.fn(async () => {}),
    platformGetStorageItem: () => null, platformSetStorageItem: vi.fn(),
    platformWriteCacheFile: vi.fn(async () => {}),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

ensureBuiltinComponentsRegistered();

function harness(withRebinder = false) {
    const app = App.new();
    connectFakeCpp(app.world);
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => '{}'),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
    const manager = new SceneManagerState(app);
    app.insertResource(AssetsResource, assets as never);
    app.insertResource(SceneManager, manager);
    if (withRebinder) installHotUpdateRebind(app, assets);
    return { app, assets, manager };
}

/** Run frames until a reload's promise has landed and its swap been applied. */
async function settle(app: App, frames = 4): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await app.tick(1 / 60);
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

describe('a persistent entity owns what it carries out of the scene', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('two survivors of one scene receipt each end up owing a release', async () => {
        // The scene acquired the texture ONCE for everything in it, so handing
        // that receipt to the first survivor leaves the second holding an asset
        // it does not own.
        const { app, assets, manager } = harness();
        const base = assets.sizes().refRows;
        let a = 0 as Entity;
        let b = 0 as Entity;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                const scope = new AssetScope();
                const lease = await assets.acquireTexture('hero.png');
                scope.add(lease);
                ctx.trackAssetScope(scope);
                a = ctx.spawn();
                b = ctx.spawn();
                app.world.insert(a, Sprite, { texture: lease.value.handle });
                app.world.insert(b, TrailRenderer, { texture: lease.value.handle });
                ctx.setPersistent(a, true);
                ctx.setPersistent(b, true);
            },
        });
        await manager.loadAdditive('level');
        expect(assets.sizes().refRows, 'one scene acquisition').toBe(base + 1);

        await manager.unload('level');
        // The scene's own is gone; each survivor owes one.
        expect(assets.sizes().refRows, 'one receipt per survivor').toBe(base + 2);
        expect(app.world.valid(a) && app.world.valid(b)).toBe(true);

        app.world.despawn(a);
        expect(assets.sizes().refRows, 'B still draws it').toBe(base + 1);
        expect(app.world.valid(b)).toBe(true);

        app.world.despawn(b);
        expect(assets.sizes().refRows, 'nothing stranded').toBe(base);
    });

    it('three fields of one entity are one acquisition to split', async () => {
        // Sprite.texture, MeshRenderer.texture and MeshRenderer.normalMap all
        // hold the one handle the scene acquired, so the entity owes once.
        const { app, assets, manager } = harness();
        const base = assets.sizes().refRows;
        let e = 0 as Entity;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                const scope = new AssetScope();
                const lease = await assets.acquireTexture('hero.png');
                scope.add(lease);
                ctx.trackAssetScope(scope);
                e = ctx.spawn();
                app.world.insert(e, Sprite, { texture: lease.value.handle });
                app.world.insert(e, MeshRenderer, {
                    texture: lease.value.handle, normalMap: lease.value.handle,
                });
                ctx.setPersistent(e, true);
            },
        });
        await manager.loadAdditive('level');
        await manager.unload('level');

        expect(assets.sizes().refRows).toBe(base + 1);
        app.world.despawn(e);
        expect(assets.sizes().refRows).toBe(base);
    });

    it('carries out the era it is BOUND to, not the one its path resolves to', async () => {
        // No rebinder here, so the scene still owns gen1 and the entity still
        // draws H1 while the path resolves to gen2. A promotion that re-acquired
        // would receipt an instance nothing on screen is using.
        const { app, assets, manager } = harness();
        const base = assets.sizes().refRows;
        let e = 0 as Entity;
        let before = 0;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                const scope = new AssetScope();
                const lease = await assets.acquireTexture('hero.png');
                scope.add(lease);
                ctx.trackAssetScope(scope);
                before = lease.value.handle;
                e = ctx.spawn();
                app.world.insert(e, Sprite, { texture: before });
                ctx.setPersistent(e, true);
            },
        });
        await manager.loadAdditive('level');

        assets.invalidate('hero.png');
        const fresh = await assets.acquireTexture('hero.png');
        expect(fresh.value.handle).not.toBe(before);

        await manager.unload('level');

        expect((app.world.get(e, Sprite) as { texture: number }).texture).toBe(before);
        // The entity's receipt is for the era it is bound to: releasing the
        // other holder of gen2 cannot take the entity's asset with it.
        fresh.release();
        expect(pool.releaseTexture).not.toHaveBeenCalledWith(before);
        expect(assets.sizes().refRows).toBe(base + 1);

        app.world.despawn(e);
        expect(assets.sizes().refRows).toBe(base);
    });

    it('a hot update after promotion is the ENTITY\'s transaction', async () => {
        // Ownership resolution has to find the entity scope first: answered as
        // "no scene tag, so the app", the replacement outlives the entity.
        const { app, assets, manager } = harness(true);
        const base = assets.sizes().refRows;
        let e = 0 as Entity;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                const scope = new AssetScope();
                const lease = await assets.acquireTexture('hero.png');
                scope.add(lease);
                ctx.trackAssetScope(scope);
                e = ctx.spawn();
                app.world.insert(e, Sprite, { texture: lease.value.handle });
                ctx.setPersistent(e, true);
            },
        });
        await manager.loadAdditive('level');
        await manager.unload('level');
        expect(assets.sizes().refRows).toBe(base + 1);

        assets.invalidate('hero.png');
        await settle(app);
        const after = assets.getTexture('hero.png')!.handle;
        expect((app.world.get(e, Sprite) as { texture: number }).texture).toBe(after);
        expect(assets.sizes().refRows, 'the replacement went somewhere else').toBe(base + 1);

        app.world.despawn(e);
        expect(assets.sizes().refRows, 'the entity owed both eras').toBe(base);
    });

    it('a survivor despawned as part of a subtree still gives its assets back', async () => {
        const { app, assets, manager } = harness();
        const base = assets.sizes().refRows;
        let parent = 0 as Entity;
        let child = 0 as Entity;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                const scope = new AssetScope();
                const lease = await assets.acquireTexture('hero.png');
                scope.add(lease);
                ctx.trackAssetScope(scope);
                parent = ctx.spawn();
                child = ctx.spawn();
                app.world.setParent(child, parent);
                app.world.insert(child, Sprite, { texture: lease.value.handle });
                ctx.setPersistent(parent, true);
                ctx.setPersistent(child, true);
            },
        });
        await manager.loadAdditive('level');
        await manager.unload('level');
        expect(assets.sizes().refRows).toBe(base + 1);

        // The child is despawned by its parent's teardown, not by name.
        app.world.despawn(parent);
        expect(app.world.valid(child)).toBe(false);
        expect(assets.sizes().refRows).toBe(base);
    });
});
