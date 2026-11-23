// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { EmbeddedBackend } from '../src/asset/Backend';
import { Catalog, atlasCatalogFields } from '../src/asset/Catalog';
import { ownedAssetLease } from '../src/asset/AssetLease';
import { bindAssetReferenceTracking } from '../src/asset/assetReferenceTracking';
import { MeshRenderer, Sprite } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { Mut, Query, QueryInstance } from '../src/ecs/query';
import { getDefaultContext } from '../src/ecs/context';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

vi.mock('../src/wasm/resourceManager', async original => ({
    ...await original<typeof import('../src/wasm/resourceManager')>(), getResourceManager: () => ({}), requireResourceManager: () => ({}),
}));

describe.skipIf(!HAS_WASM)('live asset field writes', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    function realm() {
        const world = new World(), registry = new core.Registry();
        world.connectCpp(registry as unknown as CppRegistry, core);
        const catalog = Catalog.fromJson({ version: 1, entries: { 'frame.png': { type: 'texture', ...atlasCatalogFields({
            frame: { x: 4, y: 0, width: 4, height: 4 }, pageWidth: 8, pageHeight: 8,
        }, 'page.png') } } });
        const assets = Assets.create({ backend: new EmbeddedBackend({}), module: core, catalog });
        let current: Assets | null = assets;
        bindAssetReferenceTracking(world, assets, () => current);
        const waiting = new Map<string, (handle: number) => void>(), released = vi.fn();
        vi.spyOn(assets, 'acquireTexture').mockImplementation(ref => new Promise(resolve => {
            waiting.set(ref, handle => resolve(ownedAssetLease(ref, 1, { handle, width: 8, height: 8 },
                () => released(ref), 'texture')));
        }));
        const preload = vi.spyOn(assets, 'preloadSceneAssets');
        const settle = async (ref: string, handle: number, batch: number) => {
            await vi.waitFor(() => expect(waiting.has(ref)).toBe(true));
            waiting.get(ref)!(handle);
            await preload.mock.results[batch]!.value;
            await Promise.resolve();
        };
        const entity = world.spawn();
        return { world, entity, assets, waiting, released, settle, unloadRealm: () => { current = null; },
            dispose() {
                for (const e of world.getAllEntities()) world.despawn(e);
                world.disconnectCpp(); registry.delete(); assets.releaseAll();
            } };
    }

    for (const component of [Sprite, MeshRenderer] as const) {
        it.each([true, false])(`${component._name} publishes the latest path (old finishes first: %s)`, async oldFirst => {
            const { world, entity, released, settle, dispose } = realm();
            try {
                world.insert(entity, component, { texture: 'old.png' as never });
                world.set(entity, component, { ...world.get(entity, component), texture: 'new.png' as never });
                if (oldFirst) {
                    await settle('old.png', 11, 0);
                    expect(world.get(entity, component).texture).toBe(0);
                    await settle('new.png', 22, 1);
                } else {
                    await settle('new.png', 22, 1);
                    await settle('old.png', 11, 0);
                }
                expect(world.get(entity, component).texture).toBe(22);
                expect(released.mock.calls).toEqual([['old.png']]);
                world.despawn(entity);
                expect(released.mock.calls).toEqual([['old.png'], ['new.png']]);
            } finally { dispose(); }
        });
    }

    it.each(['empty path', 'zero handle', 'zero in update', 'removed component', 'replaced component', 'replaced realm'])(
        'discards an in-flight atlas frame on %s', async action => {
            const { world, entity, assets, settle, released, unloadRealm, dispose } = realm();
            try {
                world.insert(entity, Sprite, { texture: 'frame.png' as never });
                if (action === 'empty path') world.update(entity, Sprite, draft => { draft.texture = '' as never; });
                if (action === 'zero handle') world.set(entity, Sprite, { ...world.get(entity, Sprite), texture: 0 });
                if (action === 'zero in update') world.update(entity, Sprite, draft => { draft.texture = 0; });
                if (action === 'removed component') { world.remove(entity, Sprite); world.insert(entity, Sprite); }
                if (action === 'replaced component') world.insert(entity, Sprite);
                if (action === 'replaced realm') unloadRealm();
                await settle('frame.png', 11, 0);
                expect(world.get(entity, Sprite)).toMatchObject({ texture: 0, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 } });
                expect(assets.entityScopes.scopeFor(entity, world)).toBeNull();
                expect(released.mock.calls).toEqual([['frame.png']]);
            } finally { dispose(); }
        },
    );

    it('publishes the surviving field of an overlapping batch and retains only its receipts', async () => {
        const { world, entity, assets, waiting, released, settle, dispose } = realm();
        try {
            world.insert(entity, MeshRenderer, { texture: 'old.png' as never, normalMap: 'normal.png' as never });
            world.update(entity, MeshRenderer, draft => { draft.texture = 'new.png' as never; });
            await settle('new.png', 22, 1);
            waiting.get('old.png')!(11);
            await settle('normal.png', 33, 0);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 22, normalMap: 33 });
            expect(released.mock.calls).toEqual([['old.png']]);
            expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(2);
        } finally { dispose(); }
    });

    it('composes the atlas frame with the current authored UVs', async () => {
        const { world, entity, settle, dispose } = realm();
        try {
            world.insert(entity, Sprite, { texture: 'frame.png' as never });
            world.update(entity, Sprite, draft => { draft.uvOffset = { x: 0.25, y: 0 }; });
            await settle('frame.png', 11, 0);
            expect(world.get(entity, Sprite)).toMatchObject({ texture: 11, uvOffset: { x: 0.625, y: 0.5 } });
        } finally { dispose(); }
    });

    it('returns the preload receipt if conversion to handles throws', async () => {
        const { world, entity, assets, settle, released, dispose } = realm();
        try {
            vi.spyOn(assets, 'resolveSceneAssetPaths').mockImplementation(() => { throw Error('catalog changed'); });
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            await settle('old.png', 11, 0);
            expect(world.get(entity, Sprite).texture).toBe(0);
            expect(released.mock.calls).toEqual([['old.png']]);
        } finally { dispose(); }
    });

    it('routes a pre-resolved query setter through the same field ordering', async () => {
        const { world, entity, released, settle, dispose } = realm();
        try {
            const write = world.resolveSetter(Sprite)!;
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            write(entity, { ...world.get(entity, Sprite), texture: 'new.png' });
            await settle('new.png', 22, 1);
            await settle('old.png', 11, 0);
            expect(world.get(entity, Sprite).texture).toBe(22);
            expect(released.mock.calls).toEqual([['old.png']]);
        } finally { dispose(); }
    });

    it.each(['keep', 'clear', 'replace'])('commits a kept Mut row once and honors its subsequent edit: %s', async action => {
        const { world, entity, assets, settle, released, dispose } = realm();
        try {
            world.insert(entity, Sprite);
            const query = new QueryInstance(world, Query(Mut(Sprite)));
            let kept;
            for (const [, sprite] of query) {
                sprite.texture = 'old.png' as never;
                kept = sprite;
            }
            if (action === 'clear') kept!.texture = 0;
            if (action === 'replace') world.update(entity, Sprite, draft => { draft.texture = 'new.png' as never; });
            query.settleKeptRows();
            expect(assets.acquireTexture).toHaveBeenCalledTimes(action === 'replace' ? 2 : 1);
            await settle('old.png', 11, 0);
            if (action === 'replace') await settle('new.png', 22, 1);
            expect(world.get(entity, Sprite).texture).toBe(action === 'keep' ? 11 : action === 'clear' ? 0 : 22);
            expect(released.mock.calls).toEqual(action === 'keep' ? [] : [['old.png']]);
        } finally { dispose(); }
    });

    it('clears a pending texture through a borrowed Mut row and keeps the other pending field', async () => {
        const { world, entity, assets, waiting, settle, dispose } = realm();
        try {
            world.insert(entity, MeshRenderer, { texture: 'shared.png' as never, normalMap: 'shared.png' as never });
            new QueryInstance(world, Query(Mut(MeshRenderer))).forEach((_e, renderer) => { renderer.texture = 0; });
            await settle('shared.png', 33, 0);
            expect(waiting.size).toBe(1);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 0, normalMap: 33 });
            expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(1);
        } finally { dispose(); }
    });

    it('preserves a published handle when a kept row is committed again after the load', async () => {
        const { world, entity, assets, settle, dispose } = realm();
        try {
            world.insert(entity, Sprite);
            const query = new QueryInstance(world, Query(Mut(Sprite)));
            for (const [, sprite] of query) sprite.texture = 'old.png' as never;
            world.update(entity, Sprite, draft => { expect(structuredClone(draft).texture).toBe(0); });
            await settle('old.png', 11, 0);
            query.settleKeptRows();
            expect(world.get(entity, Sprite).texture).toBe(11);
            expect(assets.acquireTexture).toHaveBeenCalledTimes(1);
        } finally { dispose(); }
    });

    it('keeps an unsuccessful atlas frame from changing UVs beside a successful material', async () => {
        const { world, entity, assets, released, settle, dispose } = realm();
        try {
            assets.register({ type: 'material', extensions: ['.esmaterial'], load: async () => ({ handle: 33 }) });
            world.insert(entity, Sprite, { texture: 'frame.png' as never, material: 'good.esmaterial' as never });
            await settle('frame.png', 0, 0);
            expect(world.get(entity, Sprite)).toMatchObject({ texture: 0, material: 33, uvOffset: { x: 0, y: 0 } });
            expect(released.mock.calls).toEqual([['frame.png']]);
        } finally { dispose(); }
    });

    it('reserves the write before a component-added observer assigns a newer path', async () => {
        const { world, entity, waiting, settle, dispose } = realm();
        const context = getDefaultContext(), previous = context.editorBridge;
        context.editorBridge = { registerComponent() {}, onComponentAdded(e, type) {
            if (e === entity && type === 'Sprite') world.update(entity, Sprite, draft => { draft.texture = 'new.png' as never; });
        } };
        try {
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            await settle('new.png', 22, 0);
            expect(world.get(entity, Sprite).texture).toBe(22);
            expect(waiting.has('old.png')).toBe(false);
        } finally { context.editorBridge = previous; dispose(); }
    });

    it('keeps the normal map when texture conversion reentrantly replaces only the color texture', async () => {
        const { world, entity, assets, waiting, released, settle, dispose } = realm();
        const convert = assets.resolveSceneAssetPaths.bind(assets);
        vi.spyOn(assets, 'resolveSceneAssetPaths').mockImplementationOnce((scene, result) => {
            world.update(entity, MeshRenderer, draft => { draft.texture = 'new.png' as never; });
            convert(scene, result);
        });
        try {
            world.insert(entity, MeshRenderer, { texture: 'old.png' as never, normalMap: 'normal.png' as never });
            await vi.waitFor(() => expect(waiting.has('normal.png')).toBe(true));
            waiting.get('old.png')!(11);
            await settle('normal.png', 33, 0);
            await settle('new.png', 22, 1);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 22, normalMap: 33 });
            expect(released.mock.calls).toEqual([['old.png']]);
        } finally { dispose(); }
    });

    it('starts only the surviving paths after an insertion observer clears one field of a mesh', async () => {
        const { world, entity, assets, settle, dispose } = realm();
        const context = getDefaultContext(), previous = context.editorBridge;
        context.editorBridge = { registerComponent() {}, onComponentAdded(e, type) {
            if (e === entity && type === 'MeshRenderer') world.update(entity, MeshRenderer, draft => { draft.texture = 0; });
        } };
        try {
            world.insert(entity, MeshRenderer, { texture: 'old.png' as never, normalMap: 'normal.png' as never });
            await settle('normal.png', 33, 0);
            expect(assets.acquireTexture).toHaveBeenCalledTimes(1);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 0, normalMap: 33 });
        } finally { context.editorBridge = previous; dispose(); }
    });
});
