// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The manager against the real module. Its interesting behaviour is bookkeeping —
// who shares a skeleton, when the last reference drops it, what a disabled entity
// stops doing — and every one of those fails quietly: a leak shows up as memory,
// a double free as a crash three frames later, a missed disable as a thing that
// keeps animating. So they are asserted, not eyeballed.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { DragonBonesManager } from '../src/dragonbones/DragonBonesManager';
import { DragonBonesModuleController } from '../src/dragonbones/DragonBonesController';
import { wrapDragonBonesModule, type DragonBonesWasmModule } from '../src/dragonbones/DragonBonesModuleLoader';
import type { Entity } from '../src/types';
import { ownAtlas, bindAtlasTexture } from '../src/dragonbones/atlasOwnership';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/Assets';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { EmbeddedBackend } from '../src/asset/Backend';
import { DragonBonesPlugin } from '../src/dragonbones/DragonBonesPlugin';
import { registerDragonBonesSupport } from '../src/dragonbones/dragonBonesSupport';
import { createRuntimeSceneConfig, prepareRuntimeScene, publishRuntimeScene } from '../src/runtime/runtimeLoader';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import type { CppResourceManager } from '../src/wasm';

const DB_JS = resolve(WASM_DIR, 'dragonbones.js');
const DB_WASM = resolve(WASM_DIR, 'dragonbones.wasm');
const ASSET_DIR = resolve(__dirname, 'assets/dragonbones');
const SKE = resolve(ASSET_DIR, 'DragonBoy_ske.json');
const TEX = resolve(ASSET_DIR, 'DragonBoy_tex.json');
const HAS_ASSETS = hasSideModule('dragonbones') && existsSync(SKE);

const e = (n: number): Entity => n as unknown as Entity;

describe.skipIf(!HAS_ASSETS)('DragonBonesManager', () => {
    let raw: DragonBonesWasmModule;
    let manager: DragonBonesManager;

    beforeAll(async () => {
        const factory = (await import(DB_JS)).default as
            (a: { wasmBinary: Uint8Array }) => Promise<DragonBonesWasmModule>;
        raw = await factory({ wasmBinary: new Uint8Array(readFileSync(DB_WASM)) });
    });

    const fresh = (): DragonBonesManager =>
        new DragonBonesManager(new DragonBonesModuleController(raw, wrapDragonBonesModule(raw)));

    const load = (m: DragonBonesManager, key?: string): number =>
        m.loadSkeleton(new Uint8Array(readFileSync(SKE)), readFileSync(TEX, 'utf8'), key);

    const bindPage = (manager: DragonBonesManager, handle: number, release: () => void): void => {
        const info = { textureId: 7 };
        ownAtlas(info, ownedAssetLease('page.png', 1, 7, release));
        bindAtlasTexture(info, manager, handle);
    };

    it('releases discarded scene preparations and transfers published pages to their armatures', async () => {
        const app = App.new(), manager = fresh();
        registerDragonBonesSupport();
        app.setSideModules({ acquire: async () => null });
        app.addPlugin(new DragonBonesPlugin(manager));
        const skeletonPath = 'DragonBoy_ske.json', atlasPath = 'DragonBoy_tex.json';
        const backend = new EmbeddedBackend({
            [skeletonPath]: 'data:application/json;base64,' + readFileSync(SKE).toString('base64'),
            [atlasPath]: readFileSync(TEX, 'utf8'),
        });
        const source = { backend, decodePixels: async () => { throw new Error('unexpected decode'); } };
        const sceneData = { version: 1, name: 'dragon', entities: [{
            id: 1, name: 'Dragon', parent: null, children: [],
            components: [{ type: 'DragonBonesAnimation', data: { skeletonPath, atlasPath, armature: 'Dragon' } }],
        }] };
        const release = vi.fn();
        const acquire = vi.spyOn(Assets.prototype, 'acquireTexture').mockImplementation(async path =>
            ownedAssetLease(path, 1, { handle: 7, width: 1, height: 1 }, release));
        initResourceManager({ getTextureGLId: (handle: number) => handle } as CppResourceManager);
        try {
            const progress = vi.fn(), options = { app, module: null, source, onProgress: progress };
            const config = createRuntimeSceneConfig('dragon', sceneData, options);
            await config.prepare!();
            expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
            expect(acquire).toHaveBeenCalledOnce();
            expect(config.discardPrepared!()).toBe(1);
            expect(config.discardPrepared!()).toBe(0);
            expect(release).toHaveBeenCalledTimes(1);

            progress.mockClear();
            const prepared = await prepareRuntimeScene({ ...options, sceneData });
            expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
            expect(prepared.assetResult.scope.size).toBe(1);
            await publishRuntimeScene(prepared);
            expect(prepared.assetResult.scope.size).toBe(0);
            prepared.assetResult.scope.releaseAll();
            const entity = app.world.getAllEntities().find(e => manager.hasInstance(e));
            expect(entity).toBeDefined();
            expect(release).toHaveBeenCalledTimes(1);
            app.world.despawn(entity!);
            expect(release).toHaveBeenCalledTimes(2);
        } finally {
            app.quit();
            acquire.mockRestore();
            shutdownResourceManager();
        }
    });

    it('releases a shared atlas only after its last instance is removed', () => {
        const m = fresh(), handle = load(m, 'shared-atlas'), release = vi.fn();
        bindPage(m, handle, release);
        expect(m.addEntity(e(101), handle, { armature: 'Dragon', assetKey: 'shared-atlas' })).toBe(true);
        expect(m.addEntity(e(102), handle, { armature: 'Dragon', assetKey: 'shared-atlas' })).toBe(true);
        m.removeEntity(e(101)); expect(release).not.toHaveBeenCalled();
        m.removeEntity(e(102)); expect(release).toHaveBeenCalledOnce();
        m.dispose(); expect(release).toHaveBeenCalledOnce();
    });
    it('replacement releases the old atlas and disposal releases the current one once', () => {
        const m = fresh(), handle = load(m, 'replace-atlas'), old = vi.fn(), next = vi.fn();
        bindPage(m, handle, old);
        bindPage(m, handle, next);
        expect(old).toHaveBeenCalledOnce(); expect(next).not.toHaveBeenCalled();
        m.dispose(); m.dispose(); expect(next).toHaveBeenCalledOnce();
    });

    it('keeps a refused page in its scene scope and never binds it after discard', () => {
        const manager = fresh(), handle = load(manager, 'refused-page');
        const page = { textureId: 8 }, scope = new AssetScope(), release = vi.fn();
        const current = vi.fn();
        bindPage(manager, handle, current);
        ownAtlas(page, ownedAssetLease('new.png', 2, 8, release), scope);
        const bind = vi.spyOn(manager, 'setAtlasTexture').mockImplementationOnce(() => { throw new Error('device lost'); });
        try {
            expect(() => bindAtlasTexture(page, manager, handle)).toThrow('device lost');
            expect(scope.size).toBe(1);
            scope.releaseAll();
            bindAtlasTexture(page, manager, handle);
            expect(bind).toHaveBeenCalledOnce();
            expect(page.textureId).toBe(-1);
            expect(current).not.toHaveBeenCalled();
            expect(release).toHaveBeenCalledOnce();
        } finally { manager.dispose(); }
        expect(current).toHaveBeenCalledOnce();
    });

    it('a refused armature releases its otherwise unbound skeleton and atlas', () => {
        const m = fresh(), handle = load(m, 'refused'), release = vi.fn();
        bindPage(m, handle, release);
        expect(m.addEntity(e(103), handle, { armature: 'missing', assetKey: 'refused' })).toBe(false);
        m.discardUnboundSkeleton('refused'); expect(release).toHaveBeenCalledOnce();
        m.dispose(); expect(release).toHaveBeenCalledOnce();
    });

    it('parses a keyed file once, however many entities want it', () => {
        manager = fresh();
        const first = load(manager, 'dragonboy');
        const second = load(manager, 'dragonboy');
        expect(second).toBe(first);

        // No key means no sharing — the honest fallback when a caller cannot say
        // that two requests are for the same asset.
        const unkeyed = load(manager);
        expect(unkeyed).not.toBe(first);
        manager.dispose();
    });

    it('attaches an armature and refuses one the file does not hold', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);

        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' })).toBe(true);
        expect(manager.hasInstance(e(1))).toBe(true);
        expect(manager.addEntity(e(2), handle, { armature: 'Nope', assetKey: 'dragonboy' })).toBe(false);
        expect(manager.hasInstance(e(2))).toBe(false);
        manager.dispose();
    });

    it('keeps a shared skeleton alive until its last entity leaves', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' });
        manager.addEntity(e(2), handle, { armature: 'Dragon', assetKey: 'dragonboy' });

        manager.removeEntity(e(1));
        // Still loaded: entity 2 holds the other reference. Asking the module is the
        // check that matters — an unloaded handle answers with no armatures.
        expect(manager.getArmatures(handle)).toEqual(['Dragon']);
        expect(manager.play(e(2), 'walk')).toBe(true);

        manager.removeEntity(e(2));
        expect(manager.getArmatures(handle)).toEqual([]);
        manager.dispose();
    });

    it('advances what is enabled and leaves the rest where it was', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' });
        manager.addEntity(e(2), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' });
        manager.updateAnimations(1 / 60);

        manager.setEnabled(e(2), false);
        const frozen = manager.getBounds(e(2));
        for (let i = 0; i < 20; i++) manager.updateAnimations(1 / 60);

        expect(manager.getBounds(e(1))).not.toEqual(frozen);
        expect(manager.getBounds(e(2))).toEqual(frozen);
        manager.dispose();
    });

    it('re-attaching an entity replaces its armature rather than stacking one', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' })).toBe(true);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' })).toBe(true);
        expect(manager.hasInstance(e(1))).toBe(true);
        expect(manager.play(e(1), 'walk')).toBe(true);

        // One entity, one instance — and the shared skeleton survives, which it
        // would not if the replace released a reference it never took.
        manager.removeEntity(e(1));
        expect(manager.getArmatures(handle)).toEqual([]);
        manager.dispose();
    });

    it('forgets everything on dispose, twice over', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' });

        manager.dispose();
        expect(manager.hasInstance(e(1))).toBe(false);
        // Idempotent: teardown runs from app shutdown and from an engine re-init,
        // and the second must not free a handle the first already did.
        expect(() => manager.dispose()).not.toThrow();
    });

    it('keeps the previous instance and its enable state when a replacement fails', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' })).toBe(true);
        manager.updateAnimations(1 / 60);
        manager.setEnabled(e(1), false);
        const bounds = manager.getBounds(e(1));
        expect(manager.addEntity(e(1), handle, { armature: 'Nope', assetKey: 'dragonboy' })).toBe(false);
        expect(manager.hasInstance(e(1))).toBe(true);
        expect(manager.getArmatures(handle)).toEqual(['Dragon']);
        for (let i = 0; i < 20; i++) manager.updateAnimations(1 / 60);
        expect(manager.getBounds(e(1))).toEqual(bounds);
        manager.setEnabled(e(1), true); manager.updateAnimations(1 / 60);
        expect(manager.getBounds(e(1))).not.toEqual(bounds);
        manager.dispose();
    });

    it('transfers an unkeyed skeleton to the replacement before releasing the last owner', () => {
        manager = fresh();
        const handle = load(manager);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon' })).toBe(true);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon' })).toBe(true);
        expect(manager.play(e(1), 'walk')).toBe(true);
        manager.removeEntity(e(1));
        expect(manager.getArmatures(handle)).toEqual([]);
        manager.dispose();
    });

    it('rejects inconsistent keyed ownership before replacing an instance', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        const other = load(manager, 'other');
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' })).toBe(true);
        expect(manager.addEntity(e(1), other, { armature: 'Dragon', assetKey: 'dragonboy' })).toBe(false);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'missing' })).toBe(false);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon' })).toBe(false);
        expect(manager.hasInstance(e(1))).toBe(true);
        expect(manager.play(e(1), 'walk')).toBe(true);
        manager.dispose();
    });

    it('keeps manual disable when a replacement succeeds', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy'); manager.setAtlasTexture(handle, 3);
        try {
            expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' })).toBe(true);
            manager.setEnabled(e(1), false);
            expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' })).toBe(true);
            const frozen = manager.getBounds(e(1));
            for (let i = 0; i < 20; i++) manager.updateAnimations(1 / 60);
            expect(manager.getBounds(e(1))).toEqual(frozen);
            manager.setEnabled(e(1), true); manager.updateAnimations(1 / 60);
            expect(manager.getBounds(e(1))).not.toEqual(frozen);
        } finally { manager.dispose(); }
    });

    it('releases unkeyed skeletons on dispose, including one never attached', () => {
        manager = fresh();
        const attached = load(manager);
        const unused = load(manager);
        expect(manager.addEntity(e(1), attached, { armature: 'Dragon' })).toBe(true);
        manager.dispose();
        expect(manager.getArmatures(attached)).toEqual([]);
        expect(manager.getArmatures(unused)).toEqual([]);
    });

    it('keeps an unkeyed handle alive while another attached entity holds it', () => {
        manager = fresh();
        const handle = load(manager);
        expect(manager.addEntity(e(1), handle, { armature: 'Dragon' })).toBe(true);
        expect(manager.addEntity(e(2), handle, { armature: 'Dragon' })).toBe(true);
        manager.removeEntity(e(1));
        expect(manager.getArmatures(handle)).toEqual(['Dragon']);
        expect(manager.play(e(2), 'walk')).toBe(true);
        manager.removeEntity(e(2));
        expect(manager.getArmatures(handle)).toEqual([]);
        manager.dispose();
    });
});
