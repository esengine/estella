// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regression: a scene's textures must be preloaded through their AUTHORED ref,
 * because that is the key per-asset import settings are looked up by.
 *
 * Scene discovery buckets by RESOLVED path (the handle maps are keyed that way),
 * and preloading fed those resolved paths straight to loadTexture. In a realm
 * whose resolver rewrites refs — the play realm prefixes `estella://project` —
 * the settings resolver was then asked about a spelling no supplier had ever
 * heard of, so filter/wrap/sRGB and the 9-slice border were silently dropped. A
 * frame that sliced correctly in the edit viewport stretched the moment you
 * pressed Play.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import { ownedAssetLease } from '../src/asset/AssetLease';
import type { SceneData } from '../src/scene/scene';
import { defineComponent } from '../src/ecs/component';
import { reservePromise } from '../src/util/reservePromise';

const setTextureMetadata = vi.fn();
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 7),
        registerExternalTexture: vi.fn(() => 7),
        releaseTexture: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        acquireTextureByPath: vi.fn(() => 0),
        invalidateTexturePath: vi.fn(() => false),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
        setTextureMetadata: (...args: unknown[]) => setTextureMetadata(...args),
    }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 64, height: 64,
        getContext: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64 * 64 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(64 * 64 * 4),
    GL: null,
    FS: null,
} as never;

const AUTHORED = 'assets/ui/Button_Yellow.png';
const BORDER = { left: 24, right: 22, top: 25, bottom: 31 };

const scene: SceneData = {
    name: 's',
    entities: [{
        id: 1, name: 'Button', parent: null, children: [],
        components: [{ type: 'UIVisual', data: { texture: AUTHORED, visualType: 3 } }],
    }],
};

function backend(): Backend {
    return {
        fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(async () => '{}'),
        resolveUrl: (p: string) => p,
        resolvePath: (p: string) => p,
    } as unknown as Backend;
}

describe('preloadSceneAssets — texture import settings', () => {
    beforeEach(() => {
        setTextureMetadata.mockClear();
        defineComponent('UIVisual', { texture: '', visualType: 0 }, {
            assetFields: [{ field: 'texture', type: 'texture' }],
        });
    });

    it('asks the settings resolver with the authored ref, not the resolved path', async () => {
        const assets = Assets.create({ backend: backend(), catalog: Catalog.empty(), module: mockModule });
        // The play realm's shape: refs resolve to a realm URL the supplier has no
        // key for. Only the authored spelling is answerable.
        assets.setAssetRefResolver((ref) => (ref.includes('://') ? ref : `estella://project/${ref}`));
        const asked: string[] = [];
        assets.setTextureImportSettingsResolver((ref) => {
            asked.push(ref);
            return ref === AUTHORED ? { sliceBorder: BORDER } : undefined;
        });

        await assets.preloadSceneAssets(scene, undefined, { skipSpine: true });

        expect(asked).toContain(AUTHORED);
        expect(setTextureMetadata).toHaveBeenCalledWith(
            expect.any(Number), BORDER.left, BORDER.right, BORDER.top, BORDER.bottom,
        );
    });

    it('still keys the handle map by the resolved path', async () => {
        const assets = Assets.create({ backend: backend(), catalog: Catalog.empty(), module: mockModule });
        assets.setAssetRefResolver((ref) => (ref.includes('://') ? ref : `estella://project/${ref}`));

        const { textureHandles } = await assets.preloadSceneAssets(scene, undefined, { skipSpine: true });

        // resolveSceneAssetPaths looks handles up by resolved path — loading
        // through the authored ref must not move that key.
        expect(textureHandles.has(`estella://project/${AUTHORED}`)).toBe(true);
    });

    it('leaves the border unstamped when no supplier answers', async () => {
        const assets = Assets.create({ backend: backend(), catalog: Catalog.empty(), module: mockModule });

        await assets.preloadSceneAssets(scene, undefined, { skipSpine: true });

        expect(setTextureMetadata).not.toHaveBeenCalled();
    });

    const atlasCatalog = (page: string, offset: number) => Catalog.fromJson({ version: 1, entries: Object.fromEntries(
        ['first.png', 'second.png'].map(path => [path, { type: 'texture', atlas: page,
            frame: { x: offset * 64, y: 0, w: 16, h: 32 }, uv: { offset: [offset, 0], scale: [0.25, 0.5] },
            trim: { sourceW: 24, sourceH: 40, offsetX: 4, offsetY: 2 },
        }]),
    ) });

    it('uses frame coordinates from the catalog active when each texture acquisition began', async () => {
        const assets = Assets.create({ backend: backend(), module: mockModule, catalog: atlasCatalog('old.png', 0.25),
            activateManifest: () => atlasCatalog('new.png', 0.5) });
        const started = reservePromise<void>(), release = reservePromise<void>();
        vi.spyOn(assets, 'acquireTexture').mockImplementation(async ref => {
            if (ref === 'first.png') { started.resolve(); await release.promise; }
            return ownedAssetLease(ref, 1, { handle: ref === 'first.png' ? 7 : 8, width: 64, height: 64 } as never, () => {}, 'texture');
        });
        const doc: SceneData = { ...scene, entities: [{ ...scene.entities[0], components: [
            { type: 'Sprite', data: { texture: 'first.png' } },
            { type: 'UIVisual', data: { texture: 'second.png' } },
        ] }] };
        const loading = assets.preloadSceneAssets(doc, undefined, { maxConcurrent: 1 });
        await started.promise;
        assets.setManifest(null);
        release.resolve();
        const result = await loading;
        try {
            assets.resolveSceneAssetPaths(doc, result);
            expect(doc.entities[0].components.map(c => c.data)).toMatchObject([
                { texture: 7, uvOffset: { x: 0.25, y: 0 } }, { texture: 8, uvOffset: { x: 0.5, y: 0 } },
            ]);
        } finally { result.scope.releaseAll(); }
    });

    it('preserves authored UVs when an atlas texture fails to load', async () => {
        const assets = Assets.create({ backend: backend(), module: mockModule, catalog: atlasCatalog('page.png', 0.25) });
        vi.spyOn(assets, 'acquireTexture').mockRejectedValueOnce(new Error('atlas page unavailable'));
        const uv = { uvOffset: { x: 0.125, y: 0.25 }, uvScale: { x: 0.5, y: 0.5 } };
        const doc: SceneData = { ...scene, entities: [{ ...scene.entities[0], components: [
            { type: 'Sprite', data: { texture: 'first.png', ...uv } },
        ] }] };
        const result = await assets.preloadSceneAssets(doc);
        try {
            expect(result.missing).toEqual([expect.objectContaining({ reason: 'load-failed', ref: 'first.png' })]);
            assets.resolveSceneAssetPaths(doc, result);
            expect(doc.entities[0].components[0].data).toEqual({ texture: 0, ...uv });
        } finally { result.scope.releaseAll(); }
    });
});
