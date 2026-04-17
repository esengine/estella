/**
 * Verifies that Assets.resolveSceneAssetPaths populates an attached
 * AssetRefCounter so tools can answer "which entities hold this asset?".
 *
 * We only exercise the bookkeeping path — no WASM, no real loader.
 * resolveSceneAssetPaths takes a SceneAssetResult whose handle maps we
 * prebuild here; the refCounter should then reflect every (path,entity)
 * pair that got a non-zero handle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, clearUserComponents } from '../src/component';
import { Assets } from '../src/asset/Assets';
import { AssetRefCounter } from '../src/asset/AssetRefCounter';
import { registerAssetFields, clearAssetFieldRegistry } from '../src/asset/AssetFieldRegistry';
import type { Backend } from '../src/asset/Backend';
import type { SceneData } from '../src/scene';
import type { SceneAssetResult } from '../src/asset/Assets';

vi.mock('../src/resourceManager', () => ({
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
        releaseCallbacks: [],
        missing: [],
    };
}

beforeEach(() => {
    clearUserComponents();
    clearAssetFieldRegistry();
    defineComponent(SPRITE, {
        texture: '',
        material: '',
        color: { r: 1, g: 1, b: 1, a: 1 },
    });
    defineComponent(LABEL, { font: '', text: '' });
    // resolveSceneAssetPaths pulls fields from this registry, not from
    // defineComponent metadata.
    registerAssetFields(SPRITE, [
        { field: 'texture',  type: 'texture' },
        { field: 'material', type: 'material' },
    ]);
    registerAssetFields(LABEL, [{ field: 'font', type: 'font' }]);
});

describe('Assets.resolveSceneAssetPaths → AssetRefCounter', () => {
    it('records texture refs against the entity id when a handle resolves', () => {
        const assets = makeAssets();
        const counter = new AssetRefCounter();
        assets.setRefCounter(counter);

        const scene = sceneWith(7, { texture: 'assets/player.png' });
        const result = emptyResult();
        result.textureHandles.set('assets/player.png', 42);

        assets.resolveSceneAssetPaths(scene, result);

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
