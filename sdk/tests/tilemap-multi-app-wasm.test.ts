// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HAS_WASM, WASM_DIR, WASM_FILE, loadWasmModule } from './helpers/loadWasm';
import type { ESEngineModule } from '../src/wasm';
import { App } from '../src/app/app';
import { Transform, TilemapLayer } from '../src/ecs/component';
import { TilemapPlugin, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';
import { TilemapAPI, Tilemaps } from '../src/tilemap/tilemapAPI';
import { Tilemap } from '../src/tilemap/components';
import { isTileSolid } from '../src/tilemap/tileQuery';
import { loadSceneData, serializeEntityComponents } from '../src/scene/scene';
import { loadTiledMap, parseTmjJson } from '../src/tilemap/tiledLoader';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { registerTilemapSupport } from '../src/tilemap/tilemapSupport';
import type { Backend } from '../src/asset/Backend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: () => false }),
    getResourceManager: () => null, evictTextureDimensions: vi.fn(),
}));

let mainCore: ESEngineModule, previewCore: ESEngineModule;
const apps: App[] = [];
const registries: Array<{ delete(): void }> = [];
afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
    for (const registry of registries.splice(0)) registry.delete();
});
describe.skipIf(!HAS_WASM)('tilemap runtimes in independent apps', () => {
    beforeAll(async () => {
        mainCore = await loadWasmModule();
        const factory = (await import(resolve(WASM_DIR, 'esengine.js'))).default;
        previewCore = await factory({ wasmBinary: readFileSync(WASM_FILE) });
        mainCore.setActiveContext(null); previewCore.setActiveContext(null);
    });
    async function scene(engine: ESEngineModule, tile: number) {
        const registry = new engine.Registry(); registries.push(registry as unknown as { delete(): void });
        const app = App.new(); app.connectCpp(registry, engine); app.addPlugin(new TilemapPlugin()); apps.push(app);
        const entity = app.world.spawn(); app.world.insert(entity, Transform);
        app.world.insert(entity, TilemapLayer, { cellSize: { x: 16, y: 16 } });
        const tiles = app.getResource(Tilemaps);
        const runtime = app.getResource(TilemapRuntimeState);
        runtime.setLayerTilesets(entity, ['builtin:collision']);
        tiles.initInfiniteLayer(entity, 16, 16); tiles.setTile(entity, 0, 0, tile);
        await app.tick(1 / 60);
        return { app, entity, tiles, runtime };
    }
    it('applies fractional cell dimensions without a combined-key collision', async () => {
        const { app, entity, tiles } = await scene(mainCore, 1);
        const before = tiles.tileToWorld(entity, 1, 1, 0, 0);
        const reinitialize = vi.spyOn(tiles, 'initInfiniteLayer');
        app.world.update(entity, TilemapLayer, value => { value.cellSize = { x: 16 + 8 / 65536, y: 8 }; });
        await app.tick(1 / 60);
        expect(reinitialize).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 20; i++) await app.tick(1 / 60);
        expect(reinitialize).toHaveBeenCalledTimes(1);
        const edited = tiles.tileToWorld(entity, 1, 1, 0, 0);
        tiles.initInfiniteLayer(entity, 16 + 8 / 65536, 8);
        const rebuilt = tiles.tileToWorld(entity, 1, 1, 0, 0);
        expect(rebuilt).not.toEqual(before);
        expect(edited).toEqual(rebuilt);
        expect(tiles.getTile(entity, 0, 0)).toBe(1);
    });

    it.each(['loaded', 'pending'])('retires a lazy tileset slot when its last layer leaves (%s)', async mode => {
        registerTilemapSupport();
        const { app, entity, runtime } = await scene(mainCore, 1);
        let resolve!: (document: string) => void;
        const fetchText = vi.fn(() => new Promise<string>(r => { resolve = r; }));
        const assets = Assets.create({ backend: { fetchText, resolveUrl: (path: string) => path } as unknown as Backend,
            module: mainCore });
        app.insertResource(AssetsResource, assets);
        const ref = 'lazy.estileset';
        runtime.setLayerTilesets(entity, [ref]);
        await app.tick(1 / 60);
        await new Promise(r => setTimeout(r, 0));
        expect(fetchText).toHaveBeenCalledOnce();
        const document = JSON.stringify({ version: '1', texture: '', tileWidth: 16, tileHeight: 16,
            columns: 1, tileCount: 1, tiles: {} });
        if (mode === 'loaded') {
            resolve(document); await new Promise(r => setTimeout(r, 0)); await app.tick(1 / 60);
            expect(assets.resolveRegistryAsset('tileset', ref)).toBeDefined();
            const resolvePath = vi.spyOn(assets, 'resolveLoadPath');
            for (let i = 0; i < 20; i++) await app.tick(1 / 60);
            expect(resolvePath).not.toHaveBeenCalled();
        }
        app.world.despawn(entity); await app.tick(1 / 60);
        if (mode === 'pending') { resolve(document); await new Promise(r => setTimeout(r, 0)); }
        expect(assets.resolveRegistryAsset('tileset', ref)).toBeUndefined();
        assets.releaseAll();
    });

    it('refreshes collision after a tileset replacement without reassigning its refs', async () => {
        registerTilemapSupport();
        const { app, entity, runtime, tiles } = await scene(mainCore, 1);
        let document = JSON.stringify({ version: '1', texture: '', tileWidth: 16, tileHeight: 16,
            columns: 1, tileCount: 1, tiles: { '1': { collision: { type: 'box' } } } });
        const assets = Assets.create({ backend: { fetchText: async () => document,
            resolveUrl: (path: string) => path } as unknown as Backend, module: mainCore });
        app.insertResource(AssetsResource, assets);
        const held = await assets.acquireTyped('tileset', 'hot.estileset');
        runtime.setLayerTilesets(entity, ['hot.estileset']); await app.tick(1 / 60);
        expect(isTileSolid(entity, 0, 0)).toBe(true);
        const setTilesets = vi.spyOn(tiles, 'setTilesets');
        document = JSON.stringify({ version: '1', texture: '', tileWidth: 16, tileHeight: 16,
            columns: 2, tileCount: 1, tiles: {} });
        assets.invalidate('hot.estileset'); await new Promise(r => setTimeout(r, 0)); await app.tick(1 / 60);
        expect(isTileSolid(entity, 0, 0)).toBe(false);
        expect(setTilesets).toHaveBeenCalledOnce();
        for (let i = 0; i < 20; i++) await app.tick(1 / 60);
        expect(setTilesets).toHaveBeenCalledOnce();
        app.world.despawn(entity); await app.tick(1 / 60); held.release(); assets.releaseAll();
    });

    it('keeps missing atlas ranges when deriving layers from a Tiled asset', async () => {
        const { app, tiles } = await scene(mainCore, 1);
        const source = parseTmjJson({ width: 2, height: 1, tilewidth: 16, tileheight: 16,
            layers: [{ type: 'tilelayer', data: [1, 5] }] })!;
        const slots = [
            { firstId: 1, textureHandle: 42, columns: 4, rows: 4, margin: 2, spacing: 3 },
            { firstId: 5, textureHandle: 0, columns: 2, rows: 1, margin: 0, spacing: 0 },
        ];
        const assets = Assets.create({ module: mainCore });
        vi.spyOn(assets, 'resolveRegistryAsset').mockReturnValue({ source: { ...source, tilesets: slots } });
        app.insertResource(AssetsResource, assets);
        const setTilesets = vi.spyOn(tiles, 'setTilesets');
        const root = app.world.spawn();
        app.world.insert(root, Transform);
        app.world.insert(root, Tilemap, { source: 'test.tmj' });
        await app.tick(1 / 60);

        expect(setTilesets).toHaveBeenCalledOnce();
        const [child, installed] = setTilesets.mock.calls[0];
        expect(installed).toEqual(slots);
        expect([tiles.getTile(child, 0, 0), tiles.getTile(child, 1, 0)]).toEqual([1, 5]);
    });

    it.each([42, 0])('keeps direct Tiled animations and properties with texture handle %i', async handle => {
        const { app, tiles } = await scene(mainCore, 1);
        const map = parseTmjJson({ width: 2, height: 1, tilewidth: 16, tileheight: 16,
            layers: [{ type: 'tilelayer', data: [1, 2] }],
            tilesets: [{ firstgid: 1, image: 'terrain.png', columns: 2, tilecount: 2, tiles: [{
                id: 0, properties: [{ name: 'surface', value: 'water' }],
                animation: [{ tileid: 0, duration: 200 }, { tileid: 1, duration: 200 }],
            }] }],
        })!;
        const setAnimation = vi.spyOn(tiles, 'setTileAnimation');
        const advance = vi.spyOn(tiles, 'advanceAnimations');
        const [layer] = loadTiledMap(app.world, map, new Map([['terrain.png', handle]]));
        await app.tick(1 / 60);
        tiles.setTile(layer, 2, 0, 1);

        expect(tiles.getTile(layer, 2, 0)).toBe(0);
        expect(tiles.getTileProperty(layer, 0, 0, 'surface')).toBe('water');
        expect(setAnimation).toHaveBeenCalledWith(layer, 1, [{ tileId: 1, duration: 200 }, { tileId: 2, duration: 200 }]);
        expect(advance).toHaveBeenCalledWith(layer, expect.any(Number));

        app.world.despawn(layer);
        advance.mockClear();
        await app.tick(1 / 60);
        expect(tiles.hasLayer(layer)).toBe(false);
        expect(advance).not.toHaveBeenCalled();

        const [unseen] = loadTiledMap(app.world, map, new Map([['terrain.png', handle]]));
        app.world.despawn(unseen);
        expect(tiles.hasLayer(unseen)).toBe(false);
    });

    it.each(['main', 'preview'] as const)('isolates matching layer IDs on one engine when %s quits', async closing => {
        const main = await scene(mainCore, 11), preview = await scene(mainCore, 29);
        expect(main.entity).toBe(preview.entity);
        const saved = (s: typeof main) => serializeEntityComponents(s.app.world, s.entity)
            .find(component => component.type === 'TilemapLayer')?.data.chunks;
        expect([main, preview].map(s => s.tiles.getTile(s.entity, 0, 0))).toEqual([11, 29]);
        expect(saved(main)).toBe(main.tiles.exportChunks(main.entity));
        expect(saved(preview)).toBe(preview.tiles.exportChunks(preview.entity));
        expect(saved(main)).not.toBe(saved(preview));
        main.tiles.setTile(main.entity, -1, -1, 1);
        await main.app.tick(1 / 60);
        expect(preview.tiles.getTile(preview.entity, -1, -1)).toBe(0);
        expect(isTileSolid(main.entity, -1, -1, main.app.world)).toBe(true);
        expect(isTileSolid(preview.entity, -1, -1, preview.app.world)).toBe(false);
        expect(main.tiles.readCollisionChunks(main.entity, null)?.has('-1,-1')).toBe(true);
        expect(preview.tiles.readCollisionChunks(preview.entity, null)?.has('-1,-1')).toBe(false);
        expect(TilemapAPI.getTile(preview.entity, 0, 0)).toBe(29);
        const [retiring, surviving] = closing === 'main' ? [main, preview] : [preview, main];
        retiring.app.quit({ keepRenderer: true });
        expect(retiring.tiles.hasLayer(retiring.entity)).toBe(false);
        const expected = closing === 'main' ? 29 : 11;
        expect(surviving.tiles.getTile(surviving.entity, 0, 0)).toBe(expected);
        expect(TilemapAPI.getTile(surviving.entity, 0, 0)).toBe(expected);
    });

    it('loads Tiled and saved scene data into the requested world with a preview open', async () => {
        const main = await scene(mainCore, 11), preview = await scene(mainCore, 29);
        const width = 19, height = 18;
        const data = Array.from({ length: width * height }, (_, i) => i + 1);
        const map = parseTmjJson({
            type: 'map', orientation: 'orthogonal', width, height, tilewidth: 16, tileheight: 16,
            tilesets: [], layers: [{ type: 'tilelayer', name: 'Ground', visible: true, width, height, data }],
        })!;
        const [imported] = loadTiledMap(main.app.world, map, new Map());
        const cells = data.map((_, i) => main.tiles.getTile(imported, i % width, Math.floor(i / width)));
        expect(cells).toEqual(data);
        main.tiles.setTile(imported, -1, 0, 4);
        main.tiles.setTile(imported, width, 0, 5);
        main.tiles.setTile(imported, 0, height, 6);
        expect(main.tiles.getTile(imported, -1, 0)).toBe(0);
        expect(main.tiles.getTile(imported, width, 0)).toBe(0);
        expect(main.tiles.getTile(imported, 0, height)).toBe(0);
        expect(main.tiles.getTile(imported, width - 1, height - 1)).toBe(data.at(-1));
        expect(preview.tiles.hasLayer(imported)).toBe(false);
        const copy = loadSceneData(main.app.world, {
            version: '1.0', name: 'saved preview', entities: [{ id: 1, name: 'Ground', parent: null, children: [],
                components: serializeEntityComponents(preview.app.world, preview.entity) }],
        }).get(1)!;
        expect(main.tiles.getTile(copy, 0, 0)).toBe(29);
        main.tiles.setTile(copy, 0, 0, 5);
        expect(preview.tiles.getTile(preview.entity, 0, 0)).toBe(29);
    });

    it('quitting the older app leaves the newer map and runtime alive', async () => {
        const main = await scene(mainCore, 1), preview = await scene(previewCore, 2);
        expect(main.entity).toBe(preview.entity);
        main.app.quit();
        expect(preview.tiles.getTile(preview.entity, 0, 0)).toBe(2);
        preview.tiles.setTile(preview.entity, 0, 0, 1); await preview.app.tick(1 / 60);
        expect(previewCore.tilemap_hasLayer!(preview.entity)).toBe(true);
        const colliders = (preview.runtime as unknown as { collisionEntities_: Map<number, Set<number>> })
            .collisionEntities_.get(preview.entity);
        expect(colliders?.size).toBeGreaterThan(0);
    });
    it('quitting the preview lets the main runtime keep rebuilding collision', async () => {
        const main = await scene(mainCore, 1), preview = await scene(previewCore, 2);
        preview.app.quit();
        main.tiles.setTile(main.entity, 0, 0, 0); await main.app.tick(1 / 60);
        main.tiles.setTile(main.entity, -1, -1, 1); await main.app.tick(1 / 60);
        const colliders = (main.runtime as unknown as { collisionEntities_: Map<number, Set<number>> })
            .collisionEntities_.get(main.entity);
        expect(colliders?.size).toBeGreaterThan(0);
        expect(main.tiles.getTile(main.entity, -1, -1)).toBe(1);
        expect(TilemapAPI.getTile(main.entity, -1, -1)).toBe(1);
        expect(isTileSolid(main.entity, -1, -1)).toBe(true);
    });
    it('serializes each world with its own tile chunks', async () => {
        const main = await scene(mainCore, 1), preview = await scene(previewCore, 2);
        const mainBlob = main.tiles.exportChunks(main.entity);
        const previewBlob = preview.tiles.exportChunks(preview.entity);
        expect(mainBlob).not.toBe(previewBlob);
        const saved = (scene: typeof main) => serializeEntityComponents(scene.app.world, scene.entity)
            .find(component => component.type === 'TilemapLayer')?.data.chunks;
        expect(saved(main)).toBe(mainBlob);
        expect(saved(preview)).toBe(previewBlob);
    });
    it('retires 100 previews without losing the main map or retaining native allocations', async () => {
        const main = await scene(mainCore, 1);
        const cycle = async () => {
            const preview = await scene(previewCore, 2);
            preview.app.quit(); apps.pop(); registries.pop()!.delete();
            expect(main.tiles.getTile(main.entity, 0, 0)).toBe(1);
        };
        for (let i = 0; i < 10; i++) await cycle();
        const memory = previewCore as unknown as { es_getMallocBytes(): number };
        const before = memory.es_getMallocBytes();
        for (let i = 0; i < 100; i++) await cycle();
        expect(memory.es_getMallocBytes()).toBe(before);
        main.tiles.setTile(main.entity, -1, -1, 1); await main.app.tick(1 / 60);
        expect(isTileSolid(main.entity, -1, -1)).toBe(true);
    });
});
