// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset-dependencies.test.ts
 * @brief   What an asset's preparation took, as the acquisitions themselves say.
 *
 * @details An edge is a projection of what happened, not a description kept
 *          beside the work: a loader has no door for declaring one, and the
 *          doors it does have record what they hand over. Two kinds, and the
 *          difference is the whole point — `owned` is a runtime resource the era
 *          holds, `source` is content that decided what the era became.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';

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

/** A `.tmj` whose one tileset lives in an external `.tsj`. */
const MAP_WITH_EXTERNAL = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4,
    tilesets: [{ firstgid: 1, source: 'terrain.tsj' }],
    layers: [{ type: 'tilelayer', name: 'g', width: 1, height: 1, data: [1] }],
});
const EXTERNAL_TILESET = JSON.stringify({
    name: 'terrain', image: 'terrain.png', columns: 2, tilecount: 4,
    tilewidth: 4, tileheight: 4,
});
const MAP_WITH_COLLECTION = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4,
    tilesets: [{
        firstgid: 1, name: 'props', columns: 0, tilecount: 1,
        tiles: [{ id: 0, image: 'rock.png', imagewidth: 4, imageheight: 4 }],
    }],
    layers: [{ type: 'tilelayer', name: 'g', width: 1, height: 1, data: [1] }],
});

function realm(docs: Record<string, string>): Assets {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async (url: string) => {
                const key = Object.keys(docs).find((k) => url.endsWith(k));
                return key ? docs[key] : '{}';
            }),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
    assets.getTextureLoader().setPixelDecoder(async () => ({
        width: 4, height: 4, pixels: new Uint8Array(64),
    }));
    return assets;
}

describe('an edge comes from the acquisition that made it', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('an external .tsj is a SOURCE dependency of the map that folded it in', async () => {
        // Nothing is held for it — there is no runtime object — but what the map
        // IS was decided by it. Read through the plain text door it would leave
        // no trace, and a change to it could never reach the map.
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        const edges = assets.dependenciesOf('tilemap', 'maps/level.tmj');
        expect(edges).toContainEqual({ kind: 'source', path: 'maps/terrain.tsj' });
    });

    it('a texture the map loaded is an OWNED dependency, named as a texture', async () => {
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        expect(assets.dependenciesOf('tilemap', 'maps/level.tmj'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'maps/terrain.png' });
    });

    it('a composed atlas is owned, and is not pretending to be a path', async () => {
        // It has no asset identity at all: naming it one would put a lookup key
        // in the graph that no invalidation could ever match.
        const assets = realm({ 'level.tmj': MAP_WITH_COLLECTION });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        const edges = assets.dependenciesOf('tilemap', 'maps/level.tmj');
        const composed = edges.filter((e) => e.path.startsWith('composed:'));
        expect(composed).toHaveLength(1);
        expect(composed[0].kind).toBe('owned');
        expect(composed[0].type, 'a composed resource has no asset type').toBeUndefined();
    });

    it('releasing the parent gives the OWNED children back and destroys nothing else', async () => {
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        const base = assets.sizes().refRows;
        const held = await assets.acquireTyped('tilemap', 'maps/level.tmj');
        expect(pool.liveTextures()).toBe(1);

        held.release();
        expect(assets.sizes().refRows).toBe(base);
        expect(pool.liveTextures(), 'the owned texture stayed').toBe(0);
        // The source edge held nothing, so there was nothing of its to destroy —
        // and the graph is gone with the era that recorded it.
        expect(assets.dependenciesOf('tilemap', 'maps/level.tmj')).toEqual([]);
    });

    it('two realms record their own edges', async () => {
        const a = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        const b = realm({ 'level.tmj': MAP_WITH_COLLECTION });
        await a.acquireTyped('tilemap', 'maps/level.tmj');
        await b.acquireTyped('tilemap', 'maps/level.tmj');

        expect(a.dependenciesOf('tilemap', 'maps/level.tmj'))
            .toContainEqual({ kind: 'source', path: 'maps/terrain.tsj' });
        expect(b.dependenciesOf('tilemap', 'maps/level.tmj').some((e) => e.kind === 'source'),
               'one realm\'s edges showed up in the other').toBe(false);
    });
});

describe('a preparation is a transaction', () => {
    beforeEach(() => { pool = createPoolFake(); });

    /** A registry-backed loader that takes two textures and then fails. */
    function brittle(assets: Assets): void {
        assets.register({
            type: 'brittle',
            extensions: ['.brittle'],
            registry: {
                prepare: async (_path, ctx) => {
                    await ctx.acquireTexture('a.png');
                    await ctx.acquireTexture('b.png');
                    throw new Error('prepare failed');
                },
            },
        });
    }

    it('a preparation that throws keeps nothing it acquired', async () => {
        // Nothing took over the receipts: there is no era to hold them, and the
        // slot the acquire was for is gone. Only the attempt itself knows what
        // it took, so only the attempt can give it back.
        const assets = realm({});
        brittle(assets);
        const base = assets.sizes().refRows;

        await expect(assets.acquireTyped('brittle', 'x.brittle')).rejects.toThrow('prepare failed');

        expect(pool.liveTextures(), 'the textures the failed attempt took').toBe(0);
        expect(assets.sizes().refRows, 'the ledger rows it opened').toBe(base);
    });

    it('a failed preparation publishes nothing and leaves no edges', async () => {
        const assets = realm({});
        brittle(assets);

        await expect(assets.acquireTyped('brittle', 'x.brittle')).rejects.toThrow();

        expect(assets.dependenciesOf('brittle', 'x.brittle')).toEqual([]);
        expect(assets.resolveRegistryAsset('brittle', 'x.brittle')).toBeUndefined();
    });
});
