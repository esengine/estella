// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Resolution prepares handles; tracking after spawning records runtime IDs so
 * tools can answer "which live entities hold this asset?" and despawn cleans up.
 *
 * We only exercise the bookkeeping path — no WASM, no real loader.
 * resolveSceneAssetPaths takes a SceneAssetResult whose handle maps we
 * prebuild here; the refCounter should then reflect every (path,entity)
 * pair that got a non-zero handle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, clearUserComponents, getComponent } from '../src/ecs/component';
import { Assets } from '../src/asset/Assets';
import { AssetRefCounter } from '../src/asset/AssetRefCounter';
import type { Backend } from '../src/asset/Backend';
import type { SceneData } from '../src/scene/scene';
import type { SceneAssetResult } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import { World } from '../src/ecs/world';
import { loadSceneData, loadSceneWithAssets } from '../src/scene/scene';

vi.mock('../src/wasm/resourceManager', async original => ({
    ...await original<typeof import('../src/wasm/resourceManager')>(),
    requireResourceManager: () => ({ releaseTexture: vi.fn() }),
    evictTextureDimensions: vi.fn(),
}));

const SPRITE = 'RefCountTest_Sprite';
const LABEL  = 'RefCountTest_Label';

const mockModule = {} as never;
const mockBackend: Backend = {
    fetchText: vi.fn(), fetchBinary: vi.fn(), fetchJson: vi.fn(),
    resolveUrl: (p: string) => p,
} as unknown as Backend;

function makeAssets(): Assets {
    return Assets.create({ backend: mockBackend, module: mockModule });
}

function sceneWith(entityId: number, sprite: { texture: string; material?: string }): SceneData {
    const data: Record<string, unknown> = { texture: sprite.texture, color: { r: 1, g: 1, b: 1, a: 1 } };
    if (sprite.material !== undefined) data.material = sprite.material;
    return {
        version: '1.0',
        name: 'test',
        entities: [{
            id: entityId, name: 'e', parent: null, children: [],
            components: [{ type: SPRITE, data }],
        }],
    };
}

function emptyResult(): SceneAssetResult {
    return {
        textureHandles: new Map(),
        materialHandles: new Map(),
        fontHandles: new Map(),
        meshHandles: new Map(),
        environmentHandles: new Map(),
        probeVolumeHandles: new Map(),
        releaseCallbacks: [],
        scope: new AssetScope(),
        missing: [],
        timings: {},
        wallMs: 0,
    };
}

beforeEach(() => {
    clearUserComponents();
    // resolveSceneAssetPaths reads the asset fields declared on the component
    // def itself (the single source) — no separate registry.
    defineComponent(SPRITE, {
        texture: '',
        material: '',
        color: { r: 1, g: 1, b: 1, a: 1 },
    }, {
        assetFields: [
            { field: 'texture',  type: 'texture' },
            { field: 'material', type: 'material' },
        ],
    });
    defineComponent(LABEL, { font: '', text: '' }, {
        assetFields: [{ field: 'font', type: 'font' }],
    });
});

describe('Assets.resolveSceneAssetPaths → AssetRefCounter', () => {
    it('preserves the other scene user when two standalone Worlds allocate the same ID', async () => {
        const assets = makeAssets(), counter = new AssetRefCounter();
        const a = new World(), b = new World();
        assets.setRefCounter(counter);
        const path = 'assets/shared.png';
        vi.spyOn(assets, 'preloadSceneAssets').mockImplementation(async () => {
            const result = emptyResult();
            result.textureHandles.set(path, 42);
            return result;
        });
        const scene = sceneWith(7, { texture: path });
        const first = (await loadSceneWithAssets(a, scene, { assets })).get(7)!;
        const second = (await loadSceneWithAssets(b, scene, { assets })).get(7)!;
        expect(first).toBe(second);
        expect(counter.getTextureRefs(path)).toEqual([first, second]);
        a.despawn(first);
        expect(counter.getAllTextureRefs(b)).toEqual([{ assetPath: path, refCount: 1, entities: [second] }]);
        b.disconnectCpp();
        expect(assets.sizes().trackedRefRows).toBe(0);
    });
    it('records runtime IDs after spawning and removes the rows when those entities despawn', () => {
        const assets = makeAssets(), counter = new AssetRefCounter(), world = new World();
        assets.setRefCounter(counter);
        world.spawn(); world.spawn();
        world.onDespawn(entity => counter.removeAllRefsForEntity(entity));
        const scene = sceneWith(7, { texture: 'assets/player.png' }), result = emptyResult();
        result.textureHandles.set('assets/player.png', 42);
        assets.resolveSceneAssetPaths(scene, result);
        expect(counter.getTotalRefRows()).toBe(0);
        const entities = loadSceneData(world, scene);
        const entity = entities.get(7)!;
        expect(entity).not.toBe(7);
        assets.trackSceneAssetReferences(scene, entities);
        expect(counter.getTextureRefs('assets/player.png')).toEqual([entity]);
        world.despawn(entity);
        expect(counter.getTotalRefRows()).toBe(0);
    });
    it('follows a standalone component through an empty field and synchronous numeric reassignment', async () => {
        const assets = makeAssets(), counter = new AssetRefCounter(), world = new World();
        assets.setRefCounter(counter);
        const path = 'assets/shared.png', component = getComponent(SPRITE)!;
        const result = emptyResult();
        result.textureHandles.set(path, 42);
        result.materialHandles.set('surface.mat', 42);
        result.fontHandles.set('text.font', 42);
        vi.spyOn(assets, 'preloadSceneAssets').mockResolvedValue(result);
        const scene = sceneWith(7, { texture: path, material: 'surface.mat' });
        scene.entities[0].components.push({ type: LABEL, data: { font: 'text.font' } });
        const [entity] = (await loadSceneWithAssets(world, scene, { assets })).values();
        expect(counter.getTextureRefs(path, world)).toEqual([entity]);
        world.update(entity, component, data => { data.texture = 0; });
        expect(counter.getTextureRefs(path, world)).toEqual([]);
        expect(counter.getMaterialRefs('surface.mat', world)).toEqual([entity]);
        expect(counter.getFontRefs('text.font', world)).toEqual([entity]);
        world.remove(entity, getComponent(LABEL)!);
        expect(counter.getTotalRefRows()).toBe(1);
        world.resolveSetter(component)!(entity, { ...world.get(entity, component), texture: 42 });
        expect(counter.getTextureRefs(path, world)).toEqual([entity]);
        counter.removeTextureRef(path, entity);
        expect(counter.getTextureRefs(path, world)).toEqual([]);
        world.update(entity, component, data => { data.texture = 42; });
        expect(counter.getTextureRefs(path, world)).toEqual([entity]);
        world.remove(entity, component);
        expect(counter.getTotalRefRows()).toBe(0);
        world.despawn(entity);
        expect(world.getStorageSizes().despawnCallbacks).toBe(0);
    });
    it('records texture refs against the entity id when a handle resolves', () => {
        const assets = makeAssets();
        const counter = new AssetRefCounter();
        assets.setRefCounter(counter);

        const scene = sceneWith(7, { texture: 'assets/player.png' });
        const result = emptyResult();
        result.textureHandles.set('assets/player.png', 42);

        assets.resolveSceneAssetPaths(scene, result);
        assets.trackSceneAssetReferences(scene, new Map(scene.entities.map(e => [e.id, e.id])));

        expect(counter.getTextureRefCount('assets/player.png')).toBe(1);
        expect(counter.getTextureRefs('assets/player.png')).toEqual([7]);
    });

    it('does not record when the handle is 0 (asset load failed)', () => {
        const assets = makeAssets();
        const counter = new AssetRefCounter();
        assets.setRefCounter(counter);

        const scene = sceneWith(7, { texture: 'assets/missing.png' });
        // Result has the path but the handle is 0 (load failed).
        const result = emptyResult();
        result.textureHandles.set('assets/missing.png', 0);

        assets.resolveSceneAssetPaths(scene, result);
        assets.trackSceneAssetReferences(scene, new Map(scene.entities.map(e => [e.id, e.id])));

        expect(counter.getTextureRefCount('assets/missing.png')).toBe(0);
    });

    it('records material and font refs under their own buckets', () => {
        const assets = makeAssets();
        const counter = new AssetRefCounter();
        assets.setRefCounter(counter);

        const scene: SceneData = {
            version: '1.0', name: 't',
            entities: [
                {
                    id: 1, name: 'a', parent: null, children: [],
                    components: [{
                        type: SPRITE,
                        data: { texture: 'a.png', material: 'a.mat', color: { r: 1, g: 1, b: 1, a: 1 } },
                    }],
                },
                {
                    id: 2, name: 'b', parent: null, children: [],
                    components: [{ type: LABEL, data: { font: 'font.fnt', text: 'hi' } }],
                },
            ],
        };
        const result = emptyResult();
        result.textureHandles.set('a.png', 10);
        result.materialHandles.set('a.mat', 20);
        result.fontHandles.set('font.fnt', 30);

        assets.resolveSceneAssetPaths(scene, result);
        assets.trackSceneAssetReferences(scene, new Map(scene.entities.map(e => [e.id, e.id])));

        expect(counter.getTextureRefCount('a.png')).toBe(1);
        expect(counter.getMaterialRefCount('a.mat')).toBe(1);
        expect(counter.getFontRefCount('font.fnt')).toBe(1);
    });

    it('is a no-op when no counter is attached', () => {
        const assets = makeAssets();
        // deliberately no setRefCounter

        const scene = sceneWith(7, { texture: 'assets/player.png' });
        const result = emptyResult();
        result.textureHandles.set('assets/player.png', 42);

        // Must not throw.
        expect(() => assets.resolveSceneAssetPaths(scene, result)).not.toThrow();
        expect(assets.getRefCounter()).toBeNull();
    });

    it('removeAllRefsForEntity cleans up after despawn', () => {
        const counter = new AssetRefCounter();
        counter.addTextureRef('a.png', 1);
        counter.addTextureRef('a.png', 2);
        counter.addMaterialRef('a.mat', 1);

        counter.removeAllRefsForEntity(1);

        expect(counter.getTextureRefs('a.png')).toEqual([2]);
        expect(counter.getMaterialRefCount('a.mat')).toBe(0);
    });
});
