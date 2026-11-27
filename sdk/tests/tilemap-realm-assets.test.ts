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
import { resolveTilesetModel } from '../src/tilemap/tilesetResolve';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

// The tilemap loaders come with the subsystem now, not with the asset
// registry: a package without tilemaps does not carry a tilemap parser.
import { registerTilemapSupport } from '../src/tilemap/tilemapSupport';
registerTilemapSupport();

/** The pool, modelled: what is live is what has not been released. */
function createPoolFake() {
    const live = new Set<number>();
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        createTextureFromBytes: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        adoptTextureContent: vi.fn((target: number, source: number) => live.has(target) && live.has(source)),
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

    it('publishes and holds every Tiled atlas at its imported size while meshes share the same handles', async () => {
        const map = JSON.parse(GRID_MAP);
        map.tilesets.push({ ...map.tilesets[0], firstgid: 5, image: '../tiles/second.png' });
        const assets = realm(JSON.stringify(map));
        assets.setTextureStreamingStart(64);
        assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
            const width = edge || 512, height = width / 4;
            return { width, height, pixels: new Uint8Array(width * height * 4), sourceWidth: 512, sourceHeight: 128 };
        });
        try {
            const meshes = await Promise.all(['tiles/atlas.png', 'tiles/second.png'].map(path => {
                assets.noteMeshSurface({ texture: path });
                return assets.acquireTexture(path);
            }));
            expect(meshes.map(mesh => mesh.value.width)).toEqual([64, 64]);
            const mapLease = await assets.acquireTyped('tilemap', 'maps/level.tmj');
            const { source } = assets.resolveRegistryAsset<PublishedTilemap>('tilemap', 'maps/level.tmj')!;
            expect(source.tilesets.map(slot => slot.textureHandle)).toEqual(meshes.map(mesh => mesh.value.handle));
            expect(meshes.map(mesh => mesh.value.width)).toEqual([512, 512]);
            const second = meshes[1].value;
            expect(await assets.resizeTexture(second.handle, 64)).toBeNull();
            mapLease.release();
            expect(await assets.resizeTexture(second.handle, 64)).toEqual({ width: 64, height: 16 });
            for (const mesh of meshes) mesh.release();
            expect(pool.liveTextures()).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('derives contiguous painted tile IDs from the imported atlas until the last tileset releases it', async () => {
        const assets = realm(JSON.stringify({ ...JSON.parse(TILESET_DOC), tileWidth: 32, tileHeight: 32, columns: 8 }));
        assets.setTextureStreamingStart(64);
        assets.noteMeshSurface({ texture: 'tiles/atlas.png' });
        assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
            const size = edge || 256;
            return { width: size, height: size, pixels: new Uint8Array(size * size * 4) };
        });
        try {
            const mesh = await assets.acquireTexture('tiles/atlas.png');
            expect(mesh.value.width).toBe(64);
            const refs = ['tiles/ground.estileset', 'tiles/overlay.estileset'];
            const tilesets = await Promise.all(refs.map(ref => assets.acquireTyped('tileset', ref)));
            const resolved = refs.map(ref => assets.resolveRegistryAsset<PublishedTileset>('tileset', ref)!.resolved);
            expect(resolved[0]).toMatchObject({ textureHandle: mesh.value.handle, textureWidth: 256, textureHeight: 256 });
            expect(resolveTilesetModel(resolved).slots.map(slot => slot.firstId)).toEqual([1, 65]);
            tilesets[0].release();
            expect(await assets.resizeTexture(mesh.value.handle, 64)).toBeNull();
            tilesets[1].release();
            expect(await assets.resizeTexture(mesh.value.handle, 64)).toEqual({ width: 64, height: 64 });
            mesh.release();
        } finally { assets.releaseAll(); }
    });

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

    it('republishes native tile ranges when the atlas is resized on disk', async () => {
        const assets = realm(TILESET_DOC);
        const refs = ['tiles/ground.estileset', 'tiles/overlay.estileset'];
        let height = 8;
        assets.getTextureLoader().setPixelDecoder(async () => ({ width: 8, height, pixels: new Uint8Array(8 * height * 4) }));
        const slots = () => resolveTilesetModel(refs.map(ref => assets.resolveRegistryAsset<PublishedTileset>('tileset', ref)!.resolved)).slots;
        try {
            const held = await Promise.all(refs.map(ref => assets.acquireTyped('tileset', ref)));
            expect(slots().map(slot => slot.firstId)).toEqual([1, 5]);
            height = 12;
            expect(assets.invalidate('tiles/atlas.png')).toBe(true);
            await assets.assetGraphSettled();
            expect(slots().map(slot => slot.firstId)).toEqual([1, 7]);
            for (const lease of held) lease.release();
            expect(pool.liveTextures()).toBe(0);
        } finally { assets.releaseAll(); }
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

describe('a tilemap runtime belongs to one app', () => {
    it.skipIf(!HAS_WASM)('projects Tiled group offsets and sprite colors into the scene', async () => {
        const { App } = await import('../src/app/app');
        const { Assets: AssetsResource } = await import('../src/asset/AssetPlugin');
        const { Marker, Sprite, Transform } = await import('../src/ecs/component');
        const { Tilemap, TilemapLayer } = await import('../src/tilemap/components');
        const { TilemapPlugin } = await import('../src/tilemap/tilemapPlugin');
        const map = JSON.parse(GRID_MAP);
        map.layers = [{ type: 'group', offsetx: 12, offsety: 5, opacity: 0.5, tintcolor: '#80ff8040', layers: [
            map.layers[0],
            { type: 'objectgroup', objects: [{ id: 1, gid: 1, x: 4, y: 9, width: 4, height: 4 }] },
            { type: 'group', visible: false, layers: [{ type: 'objectgroup', objects: [{ id: 2, point: true }] }] },
        ] }];
        const assets = realm(JSON.stringify(map));
        const engine = await loadWasmModule();
        const registry = new engine.Registry();
        const app = App.new();
        app.connectCpp(registry, engine);
        app.insertResource(AssetsResource, assets);
        app.addPlugin(new TilemapPlugin());
        const ref = 'maps/level.tmj';
        try {
            await assets.acquireTyped('tilemap', ref);
            const parent = app.world.spawn();
            app.world.insert(parent, Transform);
            app.world.insert(parent, Tilemap, { source: ref });
            await app.tick(1 / 60);
            const layers = app.world.getEntitiesWithComponents([TilemapLayer]);
            const sprites = app.world.getEntitiesWithComponents([Sprite]);
            expect(layers).toHaveLength(1);
            expect(sprites).toHaveLength(1);
            const [layer] = layers, [sprite] = sprites;
            expect(app.world.get(layer, TilemapLayer).originOffset).toEqual({ x: 12, y: -5 });
            expect(app.world.get(sprite, Transform).position).toEqual({ x: 18, y: -12, z: 0 });
            const color = app.world.get(sprite, Sprite).color;
            expect(color.r).toBe(1);
            expect(color.g).toBeCloseTo(128 / 255, 6);
            expect(color.b).toBeCloseTo(64 / 255, 6);
            expect(color.a).toBeCloseTo(64 / 255, 6);
            expect(app.world.getEntitiesWithComponents([Marker])).toHaveLength(0);
        } finally {
            app.quit();
            assets.releaseAll();
            (registry as unknown as { delete(): void }).delete();
        }
    });

    it('two apps with the same entity ids do not share derived state', async () => {
        // The plugin object is a shared singleton and every one of these
        // collections is entity-keyed. Two apps both count entities from 1.
        const { tilemapPlugin, TilemapRuntimeState } = await import('../src/tilemap/tilemapPlugin');
        const { App } = await import('../src/app/app');

        // Through the real installer, and the SAME plugin object both times —
        // which is what `DefaultPlugins` hands every app.
        const a = App.new();
        const b = App.new();
        tilemapPlugin.build(a);
        tilemapPlugin.build(b);
        expect(a.getResource(TilemapRuntimeState), 'one plugin object, one runtime for both apps')
            .not.toBe(b.getResource(TilemapRuntimeState));

        const layersOf = (app: typeof a): Set<number> =>
            (app.getResource(TilemapRuntimeState) as unknown as { initializedLayers_: Set<number> })
                .initializedLayers_;
        layersOf(a).add(1);
        expect(layersOf(b).has(1), 'one app\'s layer showed up in the other').toBe(false);

        // And a teardown is one app's: B keeps what it had.
        layersOf(b).add(1);
        a.getResource(TilemapRuntimeState).dispose();
        expect(layersOf(a).size).toBe(0);
        expect(layersOf(b).has(1), 'one app\'s cleanup emptied the other').toBe(true);
    });
});

describe('the tilemap toolkit reads its own app\'s core', () => {
    it('two apps with two engines answer for themselves', async () => {
        // `Res(Tilemaps)` was one static object over a module-level `module_`,
        // so the app that initialised last answered for both — an editor world
        // reading tiles out of the play world's engine.
        const { createTilemapAPI, Tilemaps } = await import('../src/tilemap/tilemapAPI');
        const { App } = await import('../src/app/app');
        const core = (answer: number) =>
            ({ tilemap_getTile: vi.fn(() => answer), tilemap_initLayer: vi.fn() }) as never;

        const a = App.new();
        const b = App.new();
        a.insertResource(Tilemaps, createTilemapAPI(core(111)));
        b.insertResource(Tilemaps, createTilemapAPI(core(222)));

        expect(a.getResource(Tilemaps).getTile(1, 0, 0)).toBe(111);
        expect(b.getResource(Tilemaps).getTile(1, 0, 0), 'both apps read one engine').toBe(222);
    });
});
