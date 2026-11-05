// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * An asset path written into an engine-backed component at run time is loaded
 * and swapped for its handle. Written straight through, `Sprite.texture` read
 * back as the path while the engine held 0, and the sprite never drew.
 */
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import { bindAssetReferenceTracking } from '../src/asset/assetReferenceTracking';
import { World } from '../src/ecs/world';
import { Sprite } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';

// One resource manager, answered by both doors as a real core answers them: the
// path resolver loads only on a core that has one (see assetReferenceTracking).
// `core.hasResourceManager` false plays a headless core, which has none.
const core = vi.hoisted(() => ({ hasResourceManager: true }));
vi.mock('../src/wasm/resourceManager', () => {
    const rm = {
        createTexture: vi.fn(() => 42),
        registerExternalTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        acquireTextureByPath: vi.fn(() => 0),
        invalidateTexturePath: vi.fn(() => false),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
    };
    return { requireResourceManager: () => rm, getResourceManager: () => (core.hasResourceManager ? rm : null), evictTextureDimensions: vi.fn() };
});

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
    version: 1, entries: { 'sprites/hero.png': { type: 'texture' } }, addresses: {}, labels: {},
};

describe('asset paths in engine-backed components', () => {
    it('loads the path and writes the handle once it is in', async () => {
        const mod = createMockModule();
        const world = new World();
        world.connectCpp(mod.getRegistry(), mod);
        const backend = {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => ''),
            resolveUrl: (path: string) => `http://test/${path}`,
        } as unknown as Backend;
        const assets = Assets.create({ backend, catalog: Catalog.fromJson(catalogData), module: mockModule });
        bindAssetReferenceTracking(world, assets, () => assets);

        const e = world.spawn();
        world.insert(e, Sprite, { texture: 'sprites/hero.png' as never, size: { x: 3, y: 4 } });
        // Not a string in a handle field: a placeholder, until the load lands.
        expect(world.get(e, Sprite).texture).toBe(0);
        expect(world.get(e, Sprite).size).toEqual({ x: 3, y: 4 });

        await vi.waitFor(() => expect(world.get(e, Sprite).texture).toBe(42));
        expect(world.get(e, Sprite).size).toEqual({ x: 3, y: 4 });
    });

    it('a handle written during the load wins over the late one', async () => {
        const mod = createMockModule();
        const world = new World();
        world.connectCpp(mod.getRegistry(), mod);
        const backend = { fetchBinary: vi.fn(async () => new ArrayBuffer(8)), fetchText: vi.fn(async () => ''),
            resolveUrl: (path: string) => `http://test/${path}` } as unknown as Backend;
        const assets = Assets.create({ backend, catalog: Catalog.fromJson(catalogData), module: mockModule });
        bindAssetReferenceTracking(world, assets, () => assets);
        const e = world.spawn();
        world.insert(e, Sprite, { texture: 'sprites/hero.png' as never });
        world.set(e, Sprite, { ...world.get(e, Sprite), texture: 7 });
        await new Promise((r) => setTimeout(r, 30));
        expect(world.get(e, Sprite).texture).toBe(7);
    });

    // A headless core (a server, the scale suite's world) has no resource manager
    // and loads nothing. Asking it to failed every path with an Error behind it:
    // 6000 a scene in the scale suite, which then ran its worker out of memory.
    it('leaves a path alone on a core with no resource manager', async () => {
        core.hasResourceManager = false;
        try {
            const mod = createMockModule();
            const world = new World();
            world.connectCpp(mod.getRegistry(), mod);
            const backend = { fetchBinary: vi.fn(async () => new ArrayBuffer(8)), fetchText: vi.fn(async () => ''),
                resolveUrl: (path: string) => `http://test/${path}` } as unknown as Backend;
            const assets = Assets.create({ backend, catalog: Catalog.fromJson(catalogData), module: mockModule });
            const preload = vi.spyOn(assets, 'preloadSceneAssets');
            bindAssetReferenceTracking(world, assets, () => assets);
            const e = world.spawn();
            world.insert(e, Sprite, { texture: 'sprites/hero.png' as never });
            await new Promise((r) => setTimeout(r, 30));
            expect(preload).not.toHaveBeenCalled();
            expect(backend.fetchBinary).not.toHaveBeenCalled();
        } finally {
            core.hasResourceManager = true;
        }
    });
});
