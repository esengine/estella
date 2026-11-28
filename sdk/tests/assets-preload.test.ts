// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assets-preload.test.ts
 * @brief   Assets.preload contract: explicit ref lists warm the typed caches
 *          with progress, types resolve via catalog → extension fallback, and
 *          undeterminable/failing refs land in `failed` without rejecting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { AssetLoader } from '../src/asset/AssetLoader';
import { registerComponent } from '../src/ecs/component';
import { UITooltip } from '../src/ui/behavior/tooltip';
import type { SceneData } from '../src/scene/scene';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 42),
        registerExternalTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        acquireTextureByPath: vi.fn(() => 0),
        invalidateTexturePath: vi.fn(() => false),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
    }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

// TextureLoader/imageDecode import the concrete base module (cycle-free); the
// rest go through the barrel — mock both ids with one factory.
const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 256, height: 256,
        getContext: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(256 * 256 * 4) } }),
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
    HEAPU8: new Uint8Array(1024 * 1024),
    GL: null,
    FS: null,
} as never;

const catalogData: CatalogData = {
    version: 1,
    entries: {
        'sprites/hero.png': { type: 'texture' },
        'data/level.custom': { type: 'custom' },
    },
    addresses: {},
    labels: {},
};

describe('Assets.preload', () => {
    let assets: Assets;
    let backend: Backend;
    let customLoads: string[];

    beforeEach(() => {
        customLoads = [];
        backend = {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => 'payload'),
            resolveUrl: (path: string) => `http://test/${path}`,
        } as unknown as Backend;
        assets = Assets.create({
            backend,
            catalog: Catalog.fromJson(catalogData),
            module: mockModule,
        });
        const customLoader: AssetLoader<{ value: string }> = {
            type: 'custom',
            extensions: ['.custom'],
            load: async (path) => {
                customLoads.push(path);
                return { value: path };
            },
            unload: vi.fn(),
        };
        assets.register(customLoader);
    });

    it('warms caches for catalog-typed and extension-inferred refs, with progress', async () => {
        const ticks: Array<[number, number]> = [];
        const { failed } = await assets.preload(
            ['sprites/hero.png', 'data/level.custom', 'data/other.custom'],
            (loaded, total) => ticks.push([loaded, total]),
        );

        expect(failed).toEqual([]);
        // 'data/other.custom' has no catalog entry — its type came from the
        // .custom extension of the registered loader.
        expect(customLoads.sort()).toEqual(['data/level.custom', 'data/other.custom']);
        expect(assets.getTexture('sprites/hero.png')).toBeDefined();
        expect(ticks[0]).toEqual([0, 3]);
        expect(ticks[ticks.length - 1]).toEqual([3, 3]);

        // The eventual real load is a pure cache hit — the loader doesn't re-run.
        await assets.load('custom', 'data/level.custom');
        expect(customLoads.filter(p => p === 'data/level.custom')).toHaveLength(1);
    });

    it('plans repeated refs once and keeps each occurrence independently releasable', async () => {
        const ref = 'data/level.custom';
        const copies = 256;
        const catalogLookup = vi.spyOn(assets.catalog, 'getEntry');
        const unload = vi.spyOn(assets.getLoader('custom')!, 'unload');
        const progress = vi.fn();
        try {
            expect((await assets.preload(Array(copies).fill(ref), progress)).failed).toEqual([]);
            expect(catalogLookup.mock.calls.filter(([path]) => path === ref)).toHaveLength(1);
            expect(customLoads).toEqual([ref]);
            expect(progress).toHaveBeenCalledTimes(copies + 1);
            expect(progress).toHaveBeenLastCalledWith(copies, copies);
            for (let i = 1; i < copies; i++) assets.releaseTyped('custom', ref);
            expect(unload).not.toHaveBeenCalled();
            assets.releaseTyped('custom', ref);
            expect(unload).toHaveBeenCalledTimes(1);
        } finally { assets.releaseAll(); }
    });

    it('preloads a tooltip style prefab through component metadata and owns its lease', async () => {
        registerComponent('UITooltip', UITooltip);
        const unload = vi.fn();
        assets.register({ type: 'prefab', extensions: ['.esprefab'], load: async () => ({ data: {} }), unload });
        const scene: SceneData = { version: '1.0', name: 'Hints', entities: [
            { id: 1, name: 'Volume', parent: null, children: [], components: [
                { type: 'UITooltip', data: { stylePrefab: 'ui/Tip.esprefab' } },
            ] },
        ] };
        const result = await assets.preloadSceneAssets(scene);
        expect(result.missing).toEqual([]);
        expect(result.acquisitions?.some(a => a.type === 'prefab' && a.path === 'ui/Tip.esprefab')).toBe(true);
        result.scope.releaseAll(); expect(unload).toHaveBeenCalledTimes(1);
    });

    it('reports refs whose type cannot be determined without rejecting', async () => {
        const { failed } = await assets.preload(['mystery/blob.xyz']);
        expect(failed).toEqual([
            { ref: 'mystery/blob.xyz', reason: 'unresolved' },
        ]);
    });

    it('uses indexed project types for ambiguous files without overriding catalog entries', async () => {
        const spine = '@uuid:spine';
        const dragonbones = 'assets/dragon.json';
        const animation = 'assets/camera.json';
        const legacyClip = 'assets/clip.json';
        const fromCatalog = 'data/level.custom';
        const skeleton = 'assets/hero.json';
        const types = new Map([[spine, 'spine'], [dragonbones, 'dragonbones'], [animation, 'animation'],
            [legacyClip, 'animclip'], [fromCatalog, 'spine']]);
        assets.setAssetRefResolver(ref => ref === spine ? skeleton : ref, ref => types.get(ref));
        const loadSpine = vi.spyOn(assets, 'loadSpine').mockResolvedValue({} as Awaited<ReturnType<Assets['loadSpine']>>);
        const timeline = vi.fn(async (path: string) => ({ path }));
        const clip = vi.fn(async (path: string) => ({ path }));
        assets.register({ type: 'timeline', extensions: [], load: timeline, unload: vi.fn() });
        assets.register({ type: 'anim-clip', extensions: [], load: clip, unload: vi.fn() });
        try {
            expect((await assets.preload([spine, dragonbones, animation, legacyClip, fromCatalog])).failed)
                .toEqual([{ ref: dragonbones, type: 'binary', reason: 'unresolved' }]);
            expect(loadSpine.mock.calls).toEqual([[skeleton]]);
            expect(timeline.mock.calls.map(([path]) => path)).toEqual([animation]);
            expect(clip.mock.calls.map(([path]) => path)).toEqual([legacyClip]);
            expect(customLoads).toEqual([fromCatalog]);
        } finally { assets.releaseAll(); }
    });

    it('infers URL types from the pathname and loads with the original query and fragment', async () => {
        const ref = 'https://cdn.example/data/level.CUSTOM?revision=build.42#source';
        const unknown = 'https://cdn.example/data/opaque?name=level.custom';
        const progress = vi.fn();
        expect((await assets.preload([ref, unknown], progress)).failed).toEqual([{ ref: unknown, reason: 'unresolved' }]);
        expect(customLoads).toEqual([ref]);
        expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
        assets.releaseTyped('custom', ref);
    });

    it('reports a resolver error without abandoning the other preloads', async () => {
        const offline = '@uuid:offline';
        const good = 'data/level.custom';
        assets.setAssetRefResolver(ref => {
            if (ref === offline) throw new Error('asset index unavailable');
            return ref;
        });
        const progress = vi.fn();
        expect((await assets.preload([offline, good, offline], progress)).failed).toEqual([
            { ref: offline, reason: 'load-failed', error: 'asset index unavailable' },
            { ref: offline, reason: 'load-failed', error: 'asset index unavailable' },
        ]);
        expect(customLoads).toEqual([good]);
        expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
        assets.releaseTyped('custom', good);
    });

    it('reports load failures per ref and still completes the rest', async () => {
        const failing: AssetLoader<never> = {
            type: 'broken',
            extensions: ['.broken'],
            load: async () => { throw new Error('boom'); },
            unload: vi.fn(),
        };
        assets.register(failing);

        const { failed } = await assets.preload(['a.broken', 'data/level.custom']);
        expect(customLoads).toEqual(['data/level.custom']);
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ ref: 'a.broken', type: 'broken', reason: 'load-failed', error: 'boom' });
    });
});
