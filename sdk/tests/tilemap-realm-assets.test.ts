// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilemap-realm-assets.test.ts
 * @brief   A tilemap era owns every texture it resolved — including the atlas it
 *          composed itself, which no ledger can account for.
 *
 * @details Both loaders took their textures with `loadTexture` and released
 *          none: a tileset atlas, every Tiled tileset image, and the grid an
 *          image collection is folded into stayed on the GPU for the life of
 *          the app. The folded one is the interesting case — it has no path, so
 *          it never was in the reference ledger and only the pool can say
 *          whether it is still alive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { PublishedTilemap, PublishedTileset } from '../src/tilemap/tilesetCache';

/** The pool, modelled: what is live is what has not been released. */
function createPoolFake() {
    const live = new Set<number>();
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        createTextureFromBytes: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn((handle: number) => { live.delete(handle); }),
        getTextureDimensions: vi.fn(() => ({ width: 4, height: 4 })),
        getTextureGLId: vi.fn(() => 1),
        setTextureMetadata: vi.fn(),
        liveTextures: () => live.size,
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
        width: 4, height: 4,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 4; img.height = 4; img.onload?.(); }, 0);
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

const GRID_MAP = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4,
    tilesets: [{ firstgid: 1, name: 'ground', image: '../tiles/atlas.png', columns: 2, tilecount: 4 }],
    layers: [{ type: 'tilelayer', name: 'g', width: 1, height: 1, data: [1] }],
});
const COLLECTION_MAP = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4,
    tilesets: [{
        firstgid: 1, name: 'props', columns: 0, tilecount: 2,
        tiles: [
            { id: 0, image: '../tiles/rock.png', imagewidth: 4, imageheight: 4 },
            { id: 1, image: '../tiles/bush.png', imagewidth: 4, imageheight: 4 },
        ],
    }],
    layers: [{ type: 'tilelayer', name: 'g', width: 1, height: 1, data: [1] }],
});
const TILESET_DOC = JSON.stringify({
    version: 1, type: 'tileset', texture: 'tiles/atlas.png',
    tileWidth: 4, tileHeight: 4, columns: 2, rows: 2,
});

function realm(text: string): Assets {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => text),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
    // The realm's one decode path, as a platform provides it.
    assets.getTextureLoader().setPixelDecoder(async () => ({
        width: 4, height: 4, pixels: new Uint8Array(64),
    }));
    return assets;
}

describe('a tilemap era owns the textures it resolved', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('a tileset gives its atlas back when the last holder goes', async () => {
        const assets = realm(TILESET_DOC);
        const base = assets.sizes().refRows;

        const held = await assets.acquireTyped('tileset', 'tiles/ground.estileset');
        const resolved = assets.resolveRegistryAsset<PublishedTileset>('tileset', 'tiles/ground.estileset')!.resolved;
        expect(resolved.textureHandle).toBeGreaterThan(0);
        expect(pool.liveTextures()).toBe(1);
        expect(assets.sizes().refRows, 'the atlas is the era\'s acquisition').toBe(base + 1);

        held.release();
        expect(assets.sizes().refRows).toBe(base);
        expect(pool.liveTextures(), 'the atlas outlived every holder').toBe(0);
    });

    it('a tilemap gives back every tileset image it loaded', async () => {
        const assets = realm(GRID_MAP);
        const base = assets.sizes().refRows;
        const held = await assets.acquireTyped('tilemap', 'maps/level.tmj');
        expect(assets.sizes().refRows).toBe(base + 1);

        held.release();
        expect(assets.sizes().refRows).toBe(base);
        expect(pool.liveTextures()).toBe(0);
    });

    it('and the atlas it COMPOSED, which no ledger accounts for', async () => {
        // An image-collection tileset is decoded and packed into one grid the
        // engine uploads itself: no path, no cache entry, no reference row —
        // only the pool can say whether it is still there.
        const assets = realm(COLLECTION_MAP);
        const base = assets.sizes().refRows;

        const held = await assets.acquireTyped('tilemap', 'maps/level.tmj');
        const source = assets.resolveRegistryAsset<PublishedTilemap>('tilemap', 'maps/level.tmj')!.source;
        expect(source.tilesets[0].columns, 'the collection folded into one page').toBe(2);
        expect(pool.liveTextures(), 'the composed atlas').toBe(1);
        expect(assets.sizes().refRows, 'and it is nobody\'s reference row').toBe(base);

        held.release();
        expect(pool.liveTextures(), 'a composed texture nothing can name was left behind').toBe(0);
    });
});
