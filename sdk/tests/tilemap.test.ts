// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    Tilemap,
    TilemapLayer,
    TilemapAPI,
    initTilemapAPI,
    shutdownTilemapAPI,
} from '../src/tilemap';
import {
    registerTilemapSource,
    getTilemapSource,
    clearTilemapSourceCache,
} from '../src/tilemap/tilesetCache';
import {
    loadTiledMap, parseTmjJson, parseTmjWithExternals, resolveRelativePath, loadTiledCollisionObjects,
    generateLayerCollision, generateObjectCollision, spawnObjectRegion, isCollisionObjectGroup, decodeTiledGid,
    packCollectionGrid,
    type TiledObjectData, type TiledObjectGroupData,
} from '../src/tilemap/tiledLoader';
import type { TiledMapData } from '../src/tilemap/tiledLoader';
import { resolveTilesetModel } from '../src/tilemap/tilesetResolve';
import type { TilesetAsset } from '../src/tilemap/tilesetAsset';
import { mergeCollisionTiles } from '../src/tilemap/collisionMerge';
import { TilemapAssetLoader } from '../src/asset/loaders/TilemapAssetLoader';
import type { LoadContext } from '../src/asset/AssetLoader';
import { BodyType, RigidBody, BoxCollider, CircleCollider, PolygonCollider, ChainCollider } from '../src/physics/PhysicsComponents';
import { clearUserComponents, Transform, Marker } from '../src/component';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

describe('Tilemap Components', () => {
    beforeEach(() => {
        clearUserComponents();
    });

    describe('Tilemap component', () => {
        it('should be defined with correct name', () => {
            expect(Tilemap._name).toBe('Tilemap');
        });

        it('should have correct defaults', () => {
            expect(Tilemap._default).toEqual({
                source: '',
            });
        });

        it('should not be a builtin', () => {
            expect(Tilemap._builtin).toBe(false);
        });
    });

    describe('TilemapLayer component', () => {
        it('should be defined with correct name', () => {
            expect(TilemapLayer._name).toBe('TilemapLayer');
        });

        it('should be a C++ builtin', () => {
            expect(TilemapLayer._builtin).toBe(true);
        });

        it('should have tileset field defaulting to 0', () => {
            expect(TilemapLayer._default.tileset).toBe(0);
        });

        it('should have tilesetColumns and tilesetRows defaults', () => {
            expect(TilemapLayer._default.tilesetColumns).toBe(1);
            expect(TilemapLayer._default.tilesetRows).toBe(1);
        });

        it('should have cellSize defaulting to 32x32', () => {
            expect(TilemapLayer._default.cellSize).toEqual({ x: 32, y: 32 });
        });

        it('should have correct defaults', () => {
            expect(TilemapLayer._default).toEqual({
                cellSize: { x: 32, y: 32 },
                orientation: 0,
                hexSideLength: 0,
                staggerAxis: 0,
                staggerIndex: 0,
                originOffset: { x: 0, y: 0 },
                tileset: 0,
                tilesetColumns: 1,
                tilesetRows: 1,
                renderLayer: 0,
                tintColor: { r: 1, g: 1, b: 1, a: 1 },
                opacity: 1,
                parallaxFactor: { x: 1, y: 1 },
                visible: true,
            });
        });
    });
});

describe('image-collection tilesets fold into a grid atlas', () => {
    const tilePixels = (r: number, w = 2, h = 2): Uint8Array => {
        const px = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) { px[i * 4] = r; px[i * 4 + 3] = 255; }
        return px;
    };

    it('parseTmjJson carries collection tiles (sparse ids, no top-level image)', () => {
        const map = parseTmjJson({
            width: 1, height: 1, tilewidth: 2, tileheight: 2,
            tilesets: [{
                firstgid: 1, name: 'props', columns: 0, tilecount: 2,
                tiles: [
                    { id: 0, image: 'rock.png', imagewidth: 2, imageheight: 2 },
                    { id: 3, image: 'bush.png', imagewidth: 2, imageheight: 2 }, // sparse
                ],
            }],
            layers: [{ type: 'tilelayer', width: 1, height: 1, data: [1] }],
        })!;
        expect(map.tilesets[0].image).toBe('');
        expect(map.tilesets[0].collectionTiles).toEqual([
            { id: 0, image: 'rock.png', width: 2, height: 2 },
            { id: 3, image: 'bush.png', width: 2, height: 2 },
        ]);
    });

    it('external .tsj collection tiles get their images rewritten map-relative', async () => {
        const map = await parseTmjWithExternals({
            width: 1, height: 1, tilewidth: 2, tileheight: 2,
            tilesets: [{ firstgid: 1, source: 'tilesets/props.tsj' }],
            layers: [{ type: 'tilelayer', width: 1, height: 1, data: [1] }],
        }, async () => JSON.stringify({
            name: 'props', columns: 0, tilecount: 1,
            tiles: [{ id: 0, image: '../textures/rock.png', imagewidth: 2, imageheight: 2 }],
        }))!;
        expect(map!.tilesets[0].collectionTiles![0].image).toBe('textures/rock.png');
    });

    it('packCollectionGrid packs by local id with transparent holes', () => {
        const grid = packCollectionGrid([
            { id: 0, pixels: tilePixels(10) },
            { id: 3, pixels: tilePixels(30) }, // ids 1-2 deleted in Tiled
        ], 2, 2);
        expect({ columns: grid.columns, rows: grid.rows }).toEqual({ columns: 2, rows: 2 });
        expect({ width: grid.width, height: grid.height }).toEqual({ width: 4, height: 4 });
        expect(grid.pixels[0]).toBe(10);                          // id 0 → cell (0,0)
        expect(grid.pixels[(2 * 4 + 2) * 4]).toBe(30);            // id 3 → cell (1,1)
        expect(grid.pixels[(0 * 4 + 2) * 4 + 3]).toBe(0);         // id 1 hole: transparent
    });

    it('the loader folds a collection into one uploaded grid tileset', async () => {
        const loader = new TilemapAssetLoader();
        const uploads: Array<{ width: number; height: number }> = [];
        const sources = new Map<string, string>([['maps/level.tmj', JSON.stringify({
            width: 1, height: 1, tilewidth: 2, tileheight: 2,
            tilesets: [{
                firstgid: 5, name: 'props', columns: 0, tilecount: 2,
                tiles: [
                    { id: 0, image: '../tiles/rock.png', imagewidth: 2, imageheight: 2 },
                    { id: 1, image: '../tiles/bush.png', imagewidth: 2, imageheight: 2 },
                ],
            }],
            layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [5] }],
        })]]);
        const ctx = {
            catalog: { getBuildPath: (p: string) => p },
            loadText: async (p: string) => sources.get(p)!,
            decodePixels: async (p: string) => ({
                width: 2, height: 2, pixels: tilePixels(p.includes('rock') ? 10 : 30),
            }),
            createTextureFromPixels: async (width: number, height: number) => {
                uploads.push({ width, height });
                return { handle: 77, width, height };
            },
        } as unknown as LoadContext;

        await loader.load('maps/level.tmj', ctx);
        expect(uploads).toEqual([{ width: 4, height: 2 }]); // ONE folded 2x1 page
        const src = getTilemapSource('maps/level.tmj')!;
        expect(src.tilesets[0]).toEqual({ textureHandle: 77, columns: 2, rows: 1, firstId: 5, margin: 0, spacing: 0 });
    });

    it('a collection tile off the map grid fails loud with the fix', async () => {
        const loader = new TilemapAssetLoader();
        const ctx = {
            catalog: { getBuildPath: (p: string) => p },
            loadText: async () => JSON.stringify({
                width: 1, height: 1, tilewidth: 2, tileheight: 2,
                tilesets: [{
                    firstgid: 1, name: 'props', columns: 0, tilecount: 1,
                    tiles: [{ id: 0, image: 'big.png', imagewidth: 4, imageheight: 4 }],
                }],
                layers: [{ type: 'tilelayer', width: 1, height: 1, data: [1] }],
            }),
            decodePixels: async () => ({ width: 4, height: 4, pixels: new Uint8Array(64) }),
            createTextureFromPixels: async () => ({ handle: 1, width: 4, height: 4 }),
        } as unknown as LoadContext;
        await expect(loader.load('maps/level.tmj', ctx)).rejects.toThrow(/match the\s+grid/);
    });

    it('a provider without pixel plumbing fails loud, not silently white', async () => {
        const loader = new TilemapAssetLoader();
        const ctx = {
            catalog: { getBuildPath: (p: string) => p },
            loadText: async () => JSON.stringify({
                width: 1, height: 1, tilewidth: 2, tileheight: 2,
                tilesets: [{
                    firstgid: 1, name: 'props', columns: 0, tilecount: 1,
                    tiles: [{ id: 0, image: 'rock.png', imagewidth: 2, imageheight: 2 }],
                }],
                layers: [{ type: 'tilelayer', width: 1, height: 1, data: [1] }],
            }),
        } as unknown as LoadContext;
        await expect(loader.load('maps/level.tmj', ctx)).rejects.toThrow(/image collection/);
    });
});

describe('TilemapAssetLoader — .tmx fails loud with the fix', () => {
    it('a Tiled XML map errors with the JSON-export guidance, not a JSON syntax error', async () => {
        const loader = new TilemapAssetLoader();
        const ctx = {
            catalog: { getBuildPath: (p: string) => p },
            loadText: async () => '<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.10"></map>',
        } as unknown as LoadContext;
        await expect(loader.load('maps/level.tmx', ctx)).rejects.toThrow(/JSON map files \(\*\.tmj\)/);
    });
});

describe('TilemapSource cache', () => {
    beforeEach(() => {
        clearTilemapSourceCache();
    });

    it('should register and retrieve tilemap source', () => {
        const source = {
            tileWidth: 16,
            tileHeight: 16,
            layers: [{ name: 'Ground', width: 10, height: 10, tiles: new Uint16Array([1, 2, 3]) }],
            tilesets: [{ textureHandle: 42, columns: 8, rows: 8, firstId: 1 }],
        };
        registerTilemapSource('maps/level1.tmj', source);
        expect(getTilemapSource('maps/level1.tmj')).toBe(source);
    });

    it('should return undefined for unregistered path', () => {
        expect(getTilemapSource('nonexistent.tmj')).toBeUndefined();
    });

    it('should clear all entries', () => {
        const source = {
            tileWidth: 16, tileHeight: 16,
            layers: [], tilesets: [],
        };
        registerTilemapSource('a.tmj', source);
        registerTilemapSource('b.tmj', source);
        clearTilemapSourceCache();
        expect(getTilemapSource('a.tmj')).toBeUndefined();
        expect(getTilemapSource('b.tmj')).toBeUndefined();
    });
});

describe('parseTmjJson', () => {
    it('should parse a valid tmj json', () => {
        const json = {
            width: 20,
            height: 15,
            tilewidth: 16,
            tileheight: 16,
            tilesets: [{
                firstgid: 1,
                name: 'terrain',
                image: 'terrain.png',
                tilewidth: 16,
                tileheight: 16,
                columns: 8,
                tilecount: 64,
            }],
            layers: [{
                type: 'tilelayer',
                name: 'Ground',
                width: 20,
                height: 15,
                visible: true,
                data: [0, 1, 2, 3],
            }],
        };

        const result = parseTmjJson(json);
        expect(result).not.toBeNull();
        expect(result!.width).toBe(20);
        expect(result!.height).toBe(15);
        expect(result!.tileWidth).toBe(16);
        expect(result!.tileHeight).toBe(16);
        expect(result!.layers).toHaveLength(1);
        expect(result!.layers[0].name).toBe('Ground');
        expect(result!.tilesets).toHaveLength(1);
        expect(result!.tilesets[0].name).toBe('terrain');
    });

    it('should return null for invalid json', () => {
        expect(parseTmjJson({})).toBeNull();
        expect(parseTmjJson({ width: 10, height: 0, tilewidth: 16, tileheight: 16 })).toBeNull();
    });

    it('should convert GIDs to local tile IDs', () => {
        const json = {
            width: 2, height: 1, tilewidth: 32, tileheight: 32,
            tilesets: [{ firstgid: 1, name: 'ts', image: 'ts.png', tilewidth: 32, tileheight: 32, columns: 4, tilecount: 16 }],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, data: [0, 3] }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].tiles[0]).toBe(0);
        expect(result!.layers[0].tiles[1]).toBe(3);
    });

    it('should keep global GIDs across multiple tilesets and expose firstGid', () => {
        const json = {
            width: 3, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [
                { firstgid: 1, name: 'a', image: 'a.png', tilewidth: 16, tileheight: 16, columns: 4, tilecount: 4 },
                { firstgid: 5, name: 'b', image: 'b.png', tilewidth: 16, tileheight: 16, columns: 4, tilecount: 4 },
            ],
            layers: [{ type: 'tilelayer', name: 'L', width: 3, height: 1, visible: true, data: [1, 5, 8] }],
        };
        const result = parseTmjJson(json)!;
        // Tiles keep the global GID (not collapsed to a per-tileset local id), so the
        // runtime tileset table can resolve which tileset each tile belongs to.
        expect(Array.from(result.layers[0].tiles)).toEqual([1, 5, 8]);
        expect(result.tilesets).toHaveLength(2);
        expect(result.tilesets[0].firstGid).toBe(1);
        expect(result.tilesets[1].firstGid).toBe(5);
    });

    it('should skip non-tilelayer layers', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            layers: [
                { type: 'objectgroup', name: 'Objects' },
                { type: 'tilelayer', name: 'Ground', width: 10, height: 10, visible: true, data: [] },
            ],
        };
        const result = parseTmjJson(json);
        expect(result!.layers).toHaveLength(1);
        expect(result!.layers[0].name).toBe('Ground');
    });
});

describe('resolveRelativePath', () => {
    it('should resolve relative path from base', () => {
        expect(resolveRelativePath('maps/level1.tmj', 'tileset.png')).toBe('maps/tileset.png');
    });

    it('should resolve parent directory references', () => {
        expect(resolveRelativePath('maps/level1.tmj', '../images/tileset.png')).toBe('images/tileset.png');
    });

    it('should handle base path without directory', () => {
        expect(resolveRelativePath('level1.tmj', 'tileset.png')).toBe('tileset.png');
    });

    it('should preserve a URL scheme+authority in the base (editor Play realm)', () => {
        // The "//" after the scheme must survive; otherwise the fetch breaks
        // ("estella://" collapsing to "estella:/" produced a 404 in play mode).
        expect(resolveRelativePath('estella://project/assets/maps/level.tmj', '../textures/tileset.png'))
            .toBe('estella://project/assets/textures/tileset.png');
        expect(resolveRelativePath('http://127.0.0.1:5173/assets/maps/level.tmj', '../textures/props.png'))
            .toBe('http://127.0.0.1:5173/assets/textures/props.png');
    });
});

describe('TilemapAPI', () => {
    const mockModule = {
        tilemap_initLayer: vi.fn(),
        tilemap_destroyLayer: vi.fn(),
        tilemap_setTile: vi.fn(),
        tilemap_getTile: vi.fn().mockReturnValue(5),
        tilemap_fillRect: vi.fn(),
        tilemap_setTiles: vi.fn(),
        tilemap_hasLayer: vi.fn().mockReturnValue(true),
        tilemap_submitLayer: vi.fn(),
        HEAPU8: new Uint8Array(1024),
        _malloc: vi.fn().mockReturnValue(256),
        _free: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        shutdownTilemapAPI();
    });

    it('should not call wasm before init', () => {
        TilemapAPI.initLayer(1, 10, 8, 32, 32);
        expect(mockModule.tilemap_initLayer).not.toHaveBeenCalled();
    });

    it('should delegate initLayer to wasm', () => {
        initTilemapAPI(mockModule as any);
        TilemapAPI.initLayer(1, 10, 8, 32, 32);
        expect(mockModule.tilemap_initLayer).toHaveBeenCalledWith(1, 10, 8, 32, 32);
    });

    it('should delegate destroyLayer to wasm', () => {
        initTilemapAPI(mockModule as any);
        TilemapAPI.destroyLayer(1);
        expect(mockModule.tilemap_destroyLayer).toHaveBeenCalledWith(1);
    });

    it('should delegate setTile to wasm', () => {
        initTilemapAPI(mockModule as any);
        TilemapAPI.setTile(1, 3, 4, 42);
        expect(mockModule.tilemap_setTile).toHaveBeenCalledWith(1, 3, 4, 42);
    });

    it('should delegate getTile to wasm', () => {
        initTilemapAPI(mockModule as any);
        const result = TilemapAPI.getTile(1, 3, 4);
        expect(mockModule.tilemap_getTile).toHaveBeenCalledWith(1, 3, 4);
        expect(result).toBe(5);
    });

    it('should return 0 for getTile before init', () => {
        expect(TilemapAPI.getTile(1, 0, 0)).toBe(0);
    });

    it('should delegate fillRect to wasm', () => {
        initTilemapAPI(mockModule as any);
        TilemapAPI.fillRect(1, 2, 3, 5, 4, 7);
        expect(mockModule.tilemap_fillRect).toHaveBeenCalledWith(1, 2, 3, 5, 4, 7);
    });

    it('should delegate hasLayer to wasm', () => {
        initTilemapAPI(mockModule as any);
        const result = TilemapAPI.hasLayer(1);
        expect(mockModule.tilemap_hasLayer).toHaveBeenCalledWith(1);
        expect(result).toBe(true);
    });

    it('should return false for hasLayer before init', () => {
        expect(TilemapAPI.hasLayer(1)).toBe(false);
    });

    it('should be safe to call after shutdown', () => {
        initTilemapAPI(mockModule as any);
        shutdownTilemapAPI();
        TilemapAPI.initLayer(1, 10, 8, 32, 32);
        expect(mockModule.tilemap_initLayer).not.toHaveBeenCalled();
    });
});

describe('loadTiledMap', () => {
    function createMockWorld(): World {
        let nextId = 1;
        const components = new Map<number, Map<string, any>>();

        return {
            spawn: vi.fn(() => {
                const id = nextId++ as Entity;
                components.set(id, new Map());
                return id;
            }),
            insert: vi.fn((entity: Entity, comp: any, data: any) => {
                const map = components.get(entity)!;
                map.set(comp._name, data);
            }),
            setParent: vi.fn(),
            get: vi.fn((entity: Entity, comp: any) => {
                return components.get(entity)?.get(comp._name) ?? null;
            }),
        } as unknown as World;
    }

    const defaultLayerProps = {
        opacity: 1,
        tintColor: { r: 1, g: 1, b: 1, a: 1 },
        parallaxX: 1,
        parallaxY: 1,
    };

    const sampleMapData: TiledMapData = {
        width: 20,
        height: 15,
        tileWidth: 16,
        tileHeight: 16,
        layers: [
            {
                name: 'Ground',
                width: 20,
                height: 15,
                visible: true,
                tiles: new Uint16Array([1, 2, 3, 0, 0]),
                ...defaultLayerProps,
            },
            {
                name: 'Objects',
                width: 20,
                height: 15,
                visible: true,
                tiles: new Uint16Array([0, 0, 5, 6, 7]),
                ...defaultLayerProps,
            },
        ],
        tilesets: [
            {
                name: 'terrain',
                image: 'terrain.png',
                tileWidth: 16,
                tileHeight: 16,
                columns: 8,
                tileCount: 64,
            },
        ],
        objectGroups: [],
        collisionTileIds: [],
    };

    it('should create one entity per visible layer', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);

        const entities = loadTiledMap(world, sampleMapData, textureHandles);

        expect(entities).toHaveLength(2);
        expect(world.spawn).toHaveBeenCalledTimes(2);
    });

    it('should skip invisible layers', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);
        const mapData: TiledMapData = {
            ...sampleMapData,
            layers: [
                { ...sampleMapData.layers[0], visible: false },
                sampleMapData.layers[1],
            ],
        };

        const entities = loadTiledMap(world, mapData, textureHandles);

        expect(entities).toHaveLength(1);
    });

    it('should insert TilemapLayer with correct texture handle and columns', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);

        loadTiledMap(world, sampleMapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInserts = insertCalls.filter((c: any) => c[1]._name === 'TilemapLayer');
        expect(layerInserts).toHaveLength(2);

        expect(layerInserts[0][2].tileset).toBe(42);
        expect(layerInserts[0][2].tilesetColumns).toBe(8);
        expect(layerInserts[0][2].cellSize).toEqual({ x: 16, y: 16 });
        expect(layerInserts[0][2].renderLayer).toBe(0);
    });

    it('should assign incremental layer sort order', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);

        loadTiledMap(world, sampleMapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInserts = insertCalls.filter((c: any) => c[1]._name === 'TilemapLayer');
        expect(layerInserts[0][2].renderLayer).toBe(0);
        expect(layerInserts[1][2].renderLayer).toBe(1);
    });

    it('should use texture handle 0 when tileset image is not in textureHandles', () => {
        const world = createMockWorld();
        const textureHandles = new Map<string, number>();

        loadTiledMap(world, sampleMapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInsert = insertCalls.find((c: any) => c[1]._name === 'TilemapLayer');
        expect(layerInsert[2].tileset).toBe(0);
    });

    it('should return empty array for map with no layers', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);
        const emptyMap: TiledMapData = { ...sampleMapData, layers: [] };

        const entities = loadTiledMap(world, emptyMap, textureHandles);

        expect(entities).toHaveLength(0);
        expect(world.spawn).not.toHaveBeenCalled();
    });

    it('should pass tint/opacity/parallax from layer data to TilemapLayer component', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);
        const mapData: TiledMapData = {
            ...sampleMapData,
            layers: [{
                name: 'Tinted',
                width: 2, height: 1, visible: true,
                tiles: new Uint16Array([1, 2]),
                opacity: 0.5,
                tintColor: { r: 1, g: 0.5, b: 0, a: 0.8 },
                parallaxX: 0.5,
                parallaxY: 0.75,
            }],
        };

        loadTiledMap(world, mapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInsert = insertCalls.find((c: any) => c[1]._name === 'TilemapLayer');
        expect(layerInsert[2].opacity).toBe(0.5);
        expect(layerInsert[2].tintColor).toEqual({ r: 1, g: 0.5, b: 0, a: 0.8 });
        expect(layerInsert[2].parallaxFactor).toEqual({ x: 0.5, y: 0.75 });
        expect(layerInsert[2].visible).toBe(true);
    });
});

describe('parseTmjJson — Phase A: layer render properties', () => {
    it('should parse layer opacity', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [{ firstgid: 1, name: 'ts', image: 'ts.png', tilewidth: 16, tileheight: 16, columns: 4, tilecount: 16 }],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, opacity: 0.6, data: [1, 2] }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].opacity).toBeCloseTo(0.6);
    });

    it('should default opacity to 1 when missing', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [{ firstgid: 1, name: 'ts', image: 'ts.png', tilewidth: 16, tileheight: 16, columns: 4, tilecount: 16 }],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, data: [1, 2] }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].opacity).toBe(1);
    });

    it('should parse layer tintcolor hex string', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [],
            layers: [{
                type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true,
                data: [0, 0],
                tintcolor: '#ff0000',
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].tintColor.r).toBeCloseTo(1);
        expect(result!.layers[0].tintColor.g).toBeCloseTo(0);
        expect(result!.layers[0].tintColor.b).toBeCloseTo(0);
    });

    it('should parse layer tintcolor with alpha (#AARRGGBB)', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [],
            layers: [{
                type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true,
                data: [0, 0],
                tintcolor: '#80ff8000',
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].tintColor.a).toBeCloseTo(128 / 255);
        expect(result!.layers[0].tintColor.r).toBeCloseTo(1);
        expect(result!.layers[0].tintColor.g).toBeCloseTo(128 / 255);
        expect(result!.layers[0].tintColor.b).toBeCloseTo(0);
    });

    it('should default tintColor to white when missing', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, data: [0, 0] }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].tintColor).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });

    it('should parse parallax factors', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [],
            layers: [{
                type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true,
                data: [0, 0],
                parallaxx: 0.5,
                parallaxy: 0.8,
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].parallaxX).toBeCloseTo(0.5);
        expect(result!.layers[0].parallaxY).toBeCloseTo(0.8);
    });

    it('should default parallax to 1 when missing', () => {
        const json = {
            width: 2, height: 1, tilewidth: 16, tileheight: 16,
            tilesets: [],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, data: [0, 0] }],
        };
        const result = parseTmjJson(json);
        expect(result!.layers[0].parallaxX).toBe(1);
        expect(result!.layers[0].parallaxY).toBe(1);
    });
});

describe('parseTmjJson — Phase B: objectgroup parsing', () => {
    it('should parse objectgroup layers into objectGroups', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [
                {
                    type: 'objectgroup',
                    name: 'Collisions',
                    objects: [
                        { x: 64, y: 128, width: 32, height: 32, rotation: 0 },
                        { x: 0, y: 0, width: 64, height: 16, rotation: 45 },
                    ],
                },
            ],
        };
        const result = parseTmjJson(json);
        expect(result!.objectGroups).toHaveLength(1);
        expect(result!.objectGroups[0].name).toBe('Collisions');
        expect(result!.objectGroups[0].objects).toHaveLength(2);
    });

    it('should carry the gid of a tile (GID) object', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'Decor',
                objects: [
                    { id: 1, x: 96, y: 128, width: 32, height: 32, gid: 5, rotation: 0 },
                    { id: 2, x: 0, y: 0, width: 32, height: 32, rotation: 0 },  // shape object, no gid
                ],
            }],
        };
        const result = parseTmjJson(json)!;
        expect(result.objectGroups[0].objects[0].gid).toBe(5);
        expect(result.objectGroups[0].objects[1].gid).toBeUndefined();
    });

    it('resolveTilesetModel: multiple tilesets get non-overlapping firstId ranges from texture height', () => {
        const mk = (columns: number, tileH: number): TilesetAsset => ({
            version: '1', texture: '', tileWidth: tileH, tileHeight: tileH,
            columns, margin: 0, spacing: 0, tiles: {},
        });
        // A: 4 cols, 64px tall / 16px tiles → 4 rows → 16 tiles → firstId 1, then +16.
        // B: 2 cols, 32px tall / 16px tiles → 2 rows → 4 tiles → firstId 17.
        const model = resolveTilesetModel([
            { asset: mk(4, 16), textureHandle: 1, textureHeight: 64 },
            { asset: mk(2, 16), textureHandle: 2, textureHeight: 32 },
        ]);
        expect(model.slots.map((s) => s.firstId)).toEqual([1, 17]); // pre-fix: [1, 2] (collision)
    });

    it('decodeTiledGid splits the global id + H/V/D flip flags', () => {
        expect(decodeTiledGid(5)).toEqual({ globalId: 5, flipH: false, flipV: false, flipD: false });
        // Tiled packs flips in the high bits: H=0x80000000, V=0x40000000, D=0x20000000.
        const flipped = 5 | 0x80000000 | 0x40000000;
        expect(decodeTiledGid(flipped)).toEqual({ globalId: 5, flipH: true, flipV: true, flipD: false });
        // A large global id (multi-tileset) survives — not truncated to 13 bits.
        expect(decodeTiledGid(9000).globalId).toBe(9000);
    });

    it('should detect ellipse objects', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'Shapes',
                objects: [
                    { x: 10, y: 20, width: 30, height: 30, ellipse: true, rotation: 0 },
                ],
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.objectGroups[0].objects[0].shape).toBe('ellipse');
    });

    it('should detect point objects', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'Points',
                objects: [
                    { x: 10, y: 20, width: 0, height: 0, point: true, rotation: 0 },
                ],
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.objectGroups[0].objects[0].shape).toBe('point');
    });

    it('should detect polygon objects with vertices', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'Polys',
                objects: [{
                    x: 0, y: 0, width: 0, height: 0, rotation: 0,
                    polygon: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 16, y: 32 }],
                }],
            }],
        };
        const result = parseTmjJson(json);
        const obj = result!.objectGroups[0].objects[0];
        expect(obj.shape).toBe('polygon');
        expect(obj.vertices).toEqual([0, 0, 32, 0, 16, 32]);
    });

    it('should extract object custom properties', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'G',
                objects: [{
                    x: 0, y: 0, width: 32, height: 32, rotation: 0,
                    properties: [
                        { name: 'friction', value: 0.5 },
                        { name: 'oneway', value: true },
                    ],
                }],
            }],
        };
        const result = parseTmjJson(json);
        const props = result!.objectGroups[0].objects[0].properties;
        expect(props.get('friction')).toBe(0.5);
        expect(props.get('oneway')).toBe(true);
    });

    it('should default rect shape for plain objects', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'G',
                objects: [{ x: 0, y: 0, width: 32, height: 64, rotation: 0 }],
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.objectGroups[0].objects[0].shape).toBe('rect');
    });

    it('should still parse tilelayers alongside objectgroups', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [{ firstgid: 1, name: 'ts', image: 'ts.png', tilewidth: 32, tileheight: 32, columns: 4, tilecount: 16 }],
            layers: [
                { type: 'tilelayer', name: 'Ground', width: 10, height: 10, visible: true, data: [] },
                { type: 'objectgroup', name: 'Collision', objects: [{ x: 0, y: 0, width: 32, height: 32, rotation: 0 }] },
            ],
        };
        const result = parseTmjJson(json);
        expect(result!.layers).toHaveLength(1);
        expect(result!.objectGroups).toHaveLength(1);
    });

    it('should parse object identity (id/name/type) and visibility', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup',
                name: 'Spawns',
                objects: [
                    { id: 7, name: 'player-start', type: 'SpawnPoint', x: 10, y: 20, width: 0, height: 0, point: true, rotation: 0 },
                    { id: 8, name: 'hidden', x: 0, y: 0, width: 8, height: 8, rotation: 0, visible: false },
                ],
            }],
        };
        const result = parseTmjJson(json);
        const [a, b] = result!.objectGroups[0].objects;
        expect(a.id).toBe(7);
        expect(a.name).toBe('player-start');
        expect(a.type).toBe('SpawnPoint');
        expect(a.visible).toBe(true);
        expect(b.visible).toBe(false);
    });

    it('should read the Tiled 1.9 class field as type', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup', name: 'G',
                objects: [{ id: 1, class: 'Enemy', x: 0, y: 0, width: 8, height: 8, rotation: 0 }],
            }],
        };
        const result = parseTmjJson(json);
        expect(result!.objectGroups[0].objects[0].type).toBe('Enemy');
    });

    it('should distinguish polylines from polygons', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup', name: 'Terrain',
                objects: [{
                    id: 1, x: 0, y: 64, width: 0, height: 0, rotation: 0,
                    polyline: [{ x: 0, y: 0 }, { x: 32, y: -16 }, { x: 64, y: 0 }, { x: 96, y: 8 }],
                }],
            }],
        };
        const result = parseTmjJson(json);
        const obj = result!.objectGroups[0].objects[0];
        expect(obj.shape).toBe('polyline');
        expect(obj.vertices).toEqual([0, 0, 32, -16, 64, 0, 96, 8]);
    });

    it('should parse group-level properties and visibility', () => {
        const json = {
            width: 10, height: 10, tilewidth: 32, tileheight: 32,
            tilesets: [],
            layers: [{
                type: 'objectgroup', name: 'Walls', visible: false,
                properties: [{ name: 'collision', type: 'bool', value: true }],
                objects: [{ id: 1, x: 0, y: 0, width: 32, height: 32, rotation: 0 }],
            }],
        };
        const result = parseTmjJson(json);
        const group = result!.objectGroups[0];
        expect(group.visible).toBe(false);
        expect(group.properties.get('collision')).toBe(true);
    });
});

describe('parseTmjJson — group layers, infinite chunks, external tilesets', () => {
    it('flattens Tiled group layers (tile + object layers inside groups surface)', () => {
        const json = {
            width: 4, height: 4, tilewidth: 16, tileheight: 16,
            tilesets: [],
            layers: [{
                type: 'group', name: 'World',
                layers: [
                    { type: 'tilelayer', name: 'Ground', width: 4, height: 4, data: [1, 0, 0, 0] },
                    {
                        type: 'group', name: 'Inner',
                        layers: [{ type: 'objectgroup', name: 'Collision', objects: [{ id: 1, x: 0, y: 0, width: 16, height: 16, rotation: 0 }] }],
                    },
                ],
            }],
        };
        const result = parseTmjJson(json)!;
        expect(result.layers.map((l) => l.name)).toEqual(['Ground']);
        expect(result.objectGroups.map((g) => g.name)).toEqual(['Collision']);
    });

    it('re-chunks infinite layers into engine chunk indices (16x16, floor for negatives)', () => {
        const chunkData = (fill: Array<[number, number]>): number[] => {
            const d = new Array(256).fill(0);
            for (const [i, gid] of fill) d[i] = gid;
            return d;
        };
        const json = {
            width: 4, height: 4, tilewidth: 16, tileheight: 16, infinite: true,
            tilesets: [],
            layers: [{
                type: 'tilelayer', name: 'Ground',
                chunks: [
                    { x: 16, y: 0, width: 16, height: 16, data: chunkData([[0, 5]]) },
                    { x: -16, y: -16, width: 16, height: 16, data: chunkData([[255, 7]]) },
                ],
            }],
        };
        const result = parseTmjJson(json)!;
        const layer = result.layers[0];
        expect(layer.infinite).toBe(true);
        expect(layer.tiles.length).toBe(0);
        const byKey = new Map(layer.chunks.map((c) => [`${c.x},${c.y}`, c]));
        expect(byKey.get('1,0')!.tiles[0]).toBe(5);
        expect(byKey.get('-1,-1')!.tiles[255]).toBe(7);
    });

    it('splits chunk data that straddles engine chunk boundaries', () => {
        // A 16-wide Tiled chunk anchored at tile x=8 spans engine chunks 0 and 1.
        const data = new Array(256).fill(0);
        data[0] = 3;   // tile (8, 0)  -> engine chunk 0, local (8, 0)
        data[8] = 4;   // tile (16, 0) -> engine chunk 1, local (0, 0)
        const json = {
            width: 4, height: 4, tilewidth: 16, tileheight: 16, infinite: true,
            tilesets: [],
            layers: [{ type: 'tilelayer', name: 'G', chunks: [{ x: 8, y: 0, width: 16, height: 16, data }] }],
        };
        const layer = parseTmjJson(json)!.layers[0];
        const byKey = new Map(layer.chunks.map((c) => [`${c.x},${c.y}`, c]));
        expect(byKey.get('0,0')!.tiles[8]).toBe(3);
        expect(byKey.get('1,0')!.tiles[0]).toBe(4);
    });

    it('converts chunk GIDs (flip flags become engine flags)', () => {
        const data = new Array(256).fill(0);
        data[0] = (5 | 0x80000000) >>> 0; // gid 5, horizontally flipped
        const json = {
            width: 4, height: 4, tilewidth: 16, tileheight: 16, infinite: true,
            tilesets: [],
            layers: [{ type: 'tilelayer', name: 'G', chunks: [{ x: 0, y: 0, width: 16, height: 16, data }] }],
        };
        const layer = parseTmjJson(json)!.layers[0];
        expect(layer.chunks[0].tiles[0]).toBe(5 | 0x2000);
    });

    it('parseTmjWithExternals merges external .tsj tilesets (map-relative image, animations, collision)', async () => {
        const tsj = {
            name: 'terrain', image: '../textures/terrain.png',
            tilewidth: 16, tileheight: 16, columns: 8, tilecount: 64,
            tiles: [
                { id: 2, properties: [{ name: 'collision', value: true }] },
                { id: 3, animation: [{ tileid: 3, duration: 100 }, { tileid: 4, duration: 150 }] },
            ],
        };
        const resolver = vi.fn(async (source: string) => {
            expect(source).toBe('tilesets/terrain.tsj');
            return JSON.stringify(tsj);
        });
        const json = {
            width: 4, height: 4, tilewidth: 16, tileheight: 16,
            tilesets: [{ firstgid: 1, source: 'tilesets/terrain.tsj' }],
            layers: [{ type: 'tilelayer', name: 'G', width: 4, height: 4, data: [3, 0, 0, 0] }],
        };
        const result = (await parseTmjWithExternals(json, resolver))!;
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(result.tilesets[0]).toEqual({
            name: 'terrain', image: 'textures/terrain.png', firstGid: 1,
            tileWidth: 16, tileHeight: 16, columns: 8, tileCount: 64,
            margin: 0, spacing: 0,
        });
        expect(result.collisionTileIds).toEqual([3]);
        expect(result.tileAnimations.get(4)).toEqual([
            { tileId: 4, duration: 100 }, { tileId: 5, duration: 150 },
        ]);
    });

    it('parseTmjWithExternals never invokes the resolver for inline-only maps', async () => {
        const resolver = vi.fn();
        const json = {
            width: 4, height: 4, tilewidth: 16, tileheight: 16,
            tilesets: [{ firstgid: 1, name: 'ts', image: 'ts.png', tilewidth: 16, tileheight: 16, columns: 4, tilecount: 16 }],
            layers: [],
        };
        const result = await parseTmjWithExternals(json, resolver as never);
        expect(result).not.toBeNull();
        expect(resolver).not.toHaveBeenCalled();
    });
});

describe('parseTmjJson — Phase C: collision tile IDs', () => {
    it('should collect tile IDs with collision=true property', () => {
        const json = {
            width: 2, height: 1, tilewidth: 32, tileheight: 32,
            tilesets: [{
                firstgid: 1,
                name: 'ts',
                image: 'ts.png',
                tilewidth: 32,
                tileheight: 32,
                columns: 4,
                tilecount: 16,
                tiles: [
                    { id: 0, properties: [{ name: 'collision', value: true }] },
                    { id: 3, properties: [{ name: 'collision', value: true }] },
                    { id: 5, properties: [{ name: 'decoration', value: true }] },
                ],
            }],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, data: [1, 4] }],
        };
        const result = parseTmjJson(json);
        expect(result!.collisionTileIds).toContain(1);
        expect(result!.collisionTileIds).toContain(4);
        expect(result!.collisionTileIds).not.toContain(6);
        expect(result!.collisionTileIds).toHaveLength(2);
    });

    it('should return empty collisionTileIds when no collision properties', () => {
        const json = {
            width: 2, height: 1, tilewidth: 32, tileheight: 32,
            tilesets: [{ firstgid: 1, name: 'ts', image: 'ts.png', tilewidth: 32, tileheight: 32, columns: 4, tilecount: 16 }],
            layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, visible: true, data: [1, 2] }],
        };
        const result = parseTmjJson(json);
        expect(result!.collisionTileIds).toEqual([]);
    });
});

describe('mergeCollisionTiles', () => {
    it('should merge a single collision tile', () => {
        const tiles = new Uint16Array([1, 0, 0, 0]);
        const result = mergeCollisionTiles(tiles, 2, 2, new Set([1]));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ col: 0, row: 0, width: 1, height: 1 });
    });

    it('should merge a horizontal row of tiles', () => {
        const tiles = new Uint16Array([1, 1, 1, 0, 0, 0]);
        const result = mergeCollisionTiles(tiles, 3, 2, new Set([1]));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ col: 0, row: 0, width: 3, height: 1 });
    });

    it('should merge a vertical column of tiles', () => {
        const tiles = new Uint16Array([
            1, 0,
            1, 0,
            1, 0,
        ]);
        const result = mergeCollisionTiles(tiles, 2, 3, new Set([1]));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ col: 0, row: 0, width: 1, height: 3 });
    });

    it('should merge a rectangular block', () => {
        const tiles = new Uint16Array([
            1, 1, 0,
            1, 1, 0,
            0, 0, 0,
        ]);
        const result = mergeCollisionTiles(tiles, 3, 3, new Set([1]));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ col: 0, row: 0, width: 2, height: 2 });
    });

    it('should produce separate rectangles for non-contiguous tiles', () => {
        const tiles = new Uint16Array([
            1, 0, 1,
            0, 0, 0,
            1, 0, 1,
        ]);
        const result = mergeCollisionTiles(tiles, 3, 3, new Set([1]));
        expect(result).toHaveLength(4);
    });

    it('should return empty for no collision tiles', () => {
        const tiles = new Uint16Array([0, 0, 0, 0]);
        const result = mergeCollisionTiles(tiles, 2, 2, new Set([1]));
        expect(result).toHaveLength(0);
    });

    it('should handle multiple collision tile IDs', () => {
        const tiles = new Uint16Array([1, 2, 3, 0]);
        const result = mergeCollisionTiles(tiles, 2, 2, new Set([1, 2]));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ col: 0, row: 0, width: 2, height: 1 });
    });

    it('should handle L-shaped tiles as multiple rects', () => {
        const tiles = new Uint16Array([
            1, 1,
            1, 0,
        ]);
        const result = mergeCollisionTiles(tiles, 2, 2, new Set([1]));
        expect(result).toHaveLength(2);
        const totalArea = result.reduce((sum, r) => sum + r.width * r.height, 0);
        expect(totalArea).toBe(3);
    });
});

describe('loadTiledCollisionObjects', () => {
    function createMockWorld(): World {
        let nextId = 1;
        const components = new Map<number, Map<string, any>>();

        return {
            spawn: vi.fn(() => {
                const id = nextId++ as Entity;
                components.set(id, new Map());
                return id;
            }),
            insert: vi.fn((entity: Entity, comp: any, data: any) => {
                const map = components.get(entity)!;
                map.set(comp._name, data);
            }),
            setParent: vi.fn(),
            get: vi.fn((entity: Entity, comp: any) => {
                return components.get(entity)?.get(comp._name) ?? null;
            }),
        } as unknown as World;
    }

    const makeObject = (o: Partial<TiledObjectData>): TiledObjectData => ({
        id: 1, name: '', type: '', visible: true, shape: 'rect', x: 0, y: 0,
        width: 0, height: 0, rotation: 0, vertices: null, properties: new Map(),
        ...o,
    });
    const makeGroup = (name: string, objects: TiledObjectData[], properties?: Map<string, unknown>): TiledObjectGroupData => ({
        name, visible: true, properties: properties ?? new Map(), objects,
    });
    const makeMap = (groups: TiledObjectGroupData[]): TiledMapData => ({
        width: 10, height: 10, tileWidth: 32, tileHeight: 32,
        orientation: 'orthogonal', hexSideLength: 0, staggerAxis: 'y', staggerIndex: 'odd',
        layers: [], tilesets: [], collisionTileIds: [],
        tileAnimations: new Map(), tileProperties: new Map(),
        objectGroups: groups,
    });

    it('should place rect colliders on the tile convention (top-left origin, y-down)', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Collision', [
            makeObject({ shape: 'rect', x: 64, y: 96, width: 32, height: 32 }),
        ])]);

        const entities = loadTiledCollisionObjects(world, mapData, 0, 0);
        expect(entities).toHaveLength(1);

        const insertCalls = (world.insert as any).mock.calls;
        const rbInsert = insertCalls.find((c: any) => c[1]._name === 'RigidBody');
        expect(rbInsert[2].bodyType).toBe(0);

        // Centre (80, 112) in Tiled pixels -> world (80, -112), like a tile at that spot.
        const tfInsert = insertCalls.find((c: any) => c[1]._name === 'Transform');
        expect(tfInsert[2].position).toEqual({ x: 80, y: -112, z: 0 });

        const boxInsert = insertCalls.find((c: any) => c[1]._name === 'BoxCollider');
        expect(boxInsert[2].halfExtents).toEqual({ x: 16, y: 16 });
    });

    it('should divide collider geometry by pixelsPerUnit (positions stay pixels)', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Collision', [
            makeObject({ shape: 'rect', x: 64, y: 96, width: 32, height: 32 }),
        ])]);

        loadTiledCollisionObjects(world, mapData, 0, 0, 100);

        const insertCalls = (world.insert as any).mock.calls;
        expect(insertCalls.find((c: any) => c[1]._name === 'Transform')[2].position)
            .toEqual({ x: 80, y: -112, z: 0 });
        expect(insertCalls.find((c: any) => c[1]._name === 'BoxCollider')[2].halfExtents)
            .toEqual({ x: 0.16, y: 0.16 });
    });

    it('should create CircleCollider on the mean semi-axis for ellipse objects', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Collision', [
            makeObject({ shape: 'ellipse', x: 0, y: 0, width: 64, height: 32 }),
        ])]);

        loadTiledCollisionObjects(world, mapData, 0, 0);

        const insertCalls = (world.insert as any).mock.calls;
        const circleInsert = insertCalls.find((c: any) => c[1]._name === 'CircleCollider');
        expect(circleInsert[2].radius).toBe(24);
        expect(insertCalls.find((c: any) => c[1]._name === 'Transform')[2].position)
            .toEqual({ x: 32, y: -16, z: 0 });
    });

    it('should skip point objects', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Points', [
            makeObject({ shape: 'point', x: 10, y: 20 }),
        ])]);

        const entities = loadTiledCollisionObjects(world, mapData, 0, 0);
        expect(entities).toHaveLength(0);
        expect(world.spawn).not.toHaveBeenCalled();
    });

    it('should create a real PolygonCollider (y-flipped local verts) for small polygons', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Polys', [
            makeObject({ shape: 'polygon', x: 16, y: 48, vertices: [0, 0, 40, 0, 40, 20, 0, 20] }),
        ])]);

        loadTiledCollisionObjects(world, mapData, 0, 0);

        const insertCalls = (world.insert as any).mock.calls;
        const polyInsert = insertCalls.find((c: any) => c[1]._name === 'PolygonCollider');
        expect(polyInsert[2].vertices).toEqual([
            { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: -20 }, { x: 0, y: -20 },
        ]);
        expect(insertCalls.find((c: any) => c[1]._name === 'Transform')[2].position)
            .toEqual({ x: 16, y: -48, z: 0 });
    });

    it('should create an open ChainCollider for polylines', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Terrain', [
            makeObject({ shape: 'polyline', x: 0, y: 64, vertices: [0, 0, 32, -16, 64, 0, 96, 8] }),
        ])]);

        loadTiledCollisionObjects(world, mapData, 0, 0, 2);

        const insertCalls = (world.insert as any).mock.calls;
        const chainInsert = insertCalls.find((c: any) => c[1]._name === 'ChainCollider');
        expect(chainInsert[2].isLoop).toBe(false);
        expect(chainInsert[2].points).toEqual([
            { x: 0, y: 0 }, { x: 16, y: 8 }, { x: 32, y: 0 }, { x: 48, y: -4 },
        ]);
        expect(insertCalls.find((c: any) => c[1]._name === 'Transform')[2].position)
            .toEqual({ x: 0, y: -64, z: 0 });
    });

    it('should fall back to the bounding box for polygons over the Box2D vertex cap', () => {
        const world = createMockWorld();
        const verts: number[] = [];
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            verts.push(Math.cos(a) * 50, Math.sin(a) * 50);
        }
        const mapData = makeMap([makeGroup('Blob', [
            makeObject({ shape: 'polygon', x: 100, y: 100, vertices: verts }),
        ])]);

        loadTiledCollisionObjects(world, mapData, 0, 0);

        const insertCalls = (world.insert as any).mock.calls;
        expect(insertCalls.find((c: any) => c[1]._name === 'PolygonCollider')).toBeUndefined();
        const boxInsert = insertCalls.find((c: any) => c[1]._name === 'BoxCollider');
        expect(boxInsert[2].halfExtents.x).toBeCloseTo(50, 3);
    });

    it('should rotate about the object anchor like Tiled (clockwise degrees)', () => {
        const world = createMockWorld();
        const mapData = makeMap([makeGroup('Collision', [
            makeObject({ shape: 'rect', x: 0, y: 0, width: 64, height: 16, rotation: 90 }),
        ])]);

        loadTiledCollisionObjects(world, mapData, 0, 0);

        const insertCalls = (world.insert as any).mock.calls;
        const tf = insertCalls.find((c: any) => c[1]._name === 'Transform')[2];
        // Anchor-pivot rotation moves the centre to (-8, 32) in Tiled pixels -> world (-8, -32).
        expect(tf.position.x).toBeCloseTo(-8, 5);
        expect(tf.position.y).toBeCloseTo(-32, 5);
        // World rotation is the negative angle (y-flip mirrors the direction).
        expect(tf.rotation.z).toBeCloseTo(Math.sin(-Math.PI / 4), 5);
        expect(tf.rotation.w).toBeCloseTo(Math.cos(-Math.PI / 4), 5);
    });
});

describe('isCollisionObjectGroup', () => {
    const group = (name: string, properties?: Map<string, unknown>): TiledObjectGroupData =>
        ({ name, visible: true, properties: properties ?? new Map(), objects: [] });

    it('matches a collision=true group property', () => {
        expect(isCollisionObjectGroup(group('Walls', new Map([['collision', true]])))).toBe(true);
    });

    it('matches a group named collision (case-insensitive)', () => {
        expect(isCollisionObjectGroup(group('Collision'))).toBe(true);
        expect(isCollisionObjectGroup(group('collision'))).toBe(true);
    });

    it('rejects unmarked groups', () => {
        expect(isCollisionObjectGroup(group('Spawns'))).toBe(false);
        expect(isCollisionObjectGroup(group('Walls', new Map([['collision', false]])))).toBe(false);
    });
});

describe('loadTiledMap — collision integration', () => {
    function createMockWorld(): World {
        let nextId = 1;
        const components = new Map<number, Map<string, any>>();

        return {
            spawn: vi.fn(() => {
                const id = nextId++ as Entity;
                components.set(id, new Map());
                return id;
            }),
            insert: vi.fn((entity: Entity, comp: any, data: any) => {
                const map = components.get(entity)!;
                map.set(comp._name, data);
            }),
            setParent: vi.fn(),
            get: vi.fn((entity: Entity, comp: any) => {
                return components.get(entity)?.get(comp._name) ?? null;
            }),
        } as unknown as World;
    }

    const defaultLayerProps = {
        opacity: 1,
        tintColor: { r: 1, g: 1, b: 1, a: 1 },
        parallaxX: 1,
        parallaxY: 1,
    };

    it('should generate collision entities from objectGroups', () => {
        const world = createMockWorld();
        const mapData: TiledMapData = {
            width: 10, height: 10, tileWidth: 32, tileHeight: 32,
            layers: [{
                name: 'Ground', width: 10, height: 10, visible: true,
                tiles: new Uint16Array(100),
                ...defaultLayerProps,
            }],
            tilesets: [{ name: 'ts', image: 'ts.png', tileWidth: 32, tileHeight: 32, columns: 4, tileCount: 16 }],
            objectGroups: [{
                name: 'Collision',
                objects: [
                    { shape: 'rect' as const, x: 0, y: 0, width: 32, height: 32, rotation: 0, vertices: null, properties: new Map() },
                ],
            }],
            collisionTileIds: [],
        };

        const entities = loadTiledMap(world, mapData, new Map([['ts.png', 1]]));
        expect(entities).toHaveLength(2);
    });

    it('should skip collision generation when generateObjectCollision=false', () => {
        const world = createMockWorld();
        const mapData: TiledMapData = {
            width: 10, height: 10, tileWidth: 32, tileHeight: 32,
            layers: [{
                name: 'Ground', width: 10, height: 10, visible: true,
                tiles: new Uint16Array(100),
                ...defaultLayerProps,
            }],
            tilesets: [{ name: 'ts', image: 'ts.png', tileWidth: 32, tileHeight: 32, columns: 4, tileCount: 16 }],
            objectGroups: [{
                name: 'Collision',
                objects: [
                    { shape: 'rect' as const, x: 0, y: 0, width: 32, height: 32, rotation: 0, vertices: null, properties: new Map() },
                ],
            }],
            collisionTileIds: [],
        };

        const entities = loadTiledMap(world, mapData, new Map([['ts.png', 1]]), {
            generateObjectCollision: false,
        });
        expect(entities).toHaveLength(1);
    });

    describe('spawnObjectRegion (object → Trigger-Area / solid-region convergence)', () => {
        const obj = (over: Partial<Record<string, unknown>>) => ({
            id: 7, name: 'gate', type: 'door', visible: true, rotation: 0,
            x: 100, y: 50, width: 40, height: 20, vertices: null,
            properties: new Map([['event', 'open']]),
            ...over,
        }) as never;

        it('rect (sensor) → parented Marker + static body + SENSOR box (metres), props carried', () => {
            const world = createMockWorld();
            const parent = world.spawn();
            const e = spawnObjectRegion(world, obj({ shape: 'rect' }), parent, 100, true);
            expect(e).not.toBeNull();
            expect(world.get(e!, Marker)).toEqual({ type: 'door', properties: { event: 'open' } });
            expect(world.get(e!, RigidBody).bodyType).toBe(0); // Static
            const box = world.get(e!, BoxCollider);
            expect(box.isSensor).toBe(true);
            expect(box.halfExtents).toEqual({ x: 40 * 0.5 / 100, y: 20 * 0.5 / 100 });
            expect(world.get(e!, Transform).position).toEqual({ x: 120, y: -60, z: 0 }); // local centre, y-up
            expect(world.setParent).toHaveBeenCalledWith(e, parent);
        });

        it('sensor=false → the SAME shape as a SOLID collider (collision-group geometry)', () => {
            const world = createMockWorld();
            const e = spawnObjectRegion(world, obj({ shape: 'rect' }), world.spawn(), 100, false);
            expect(world.get(e!, BoxCollider).isSensor).toBe(false);
            expect(world.get(e!, RigidBody).bodyType).toBe(0);
        });

        it('ellipse → circle on the mean semi-axis; polyline → open chain', () => {
            const world = createMockWorld();
            const c = world.get(spawnObjectRegion(world, obj({ shape: 'ellipse', width: 80, height: 40 }), world.spawn(), 100, true)!, CircleCollider);
            expect(c.isSensor).toBe(true);
            expect(c.radius).toBeCloseTo((80 + 40) * 0.25 / 100);
            const chain = world.get(spawnObjectRegion(world, obj({ shape: 'polyline', vertices: [0, 0, 10, 0, 10, 10] }), world.spawn(), 100, false)!, ChainCollider);
            expect(chain.isLoop).toBe(false);
            // A sensor-group polyline is skipped (open chains have no sensor mode).
            expect(spawnObjectRegion(world, obj({ shape: 'polyline', vertices: [0, 0, 10, 10] }), world.spawn(), 100, true)).toBeNull();
        });

        it('polygon (≤8 pts) → polygon; point / gid → null (projected elsewhere)', () => {
            const world = createMockWorld();
            expect(world.get(spawnObjectRegion(world, obj({ shape: 'polygon', vertices: [0, 0, 30, 0, 30, 30] }), world.spawn(), 100, true)!, PolygonCollider).isSensor).toBe(true);
            expect(spawnObjectRegion(world, obj({ shape: 'point' }), world.spawn(), 100, true)).toBeNull();
            expect(spawnObjectRegion(world, obj({ shape: 'rect', gid: 5 }), world.spawn(), 100, true)).toBeNull();
        });

        it('shares ONE shape→collider decision with generateObjectCollision (the runtime path)', () => {
            // The same object, projected by the region path (parented, sensor-capable) and by
            // the legacy runtime collider path (world-placed), must yield the SAME collider
            // geometry + local placement — both now route through attachObjectShape, so they
            // can never silently re-diverge. generateObjectCollision at origin 0 == the
            // region's parent-local space; sensor=false makes the region collider solid too.
            const shapes: Partial<Record<string, unknown>>[] = [
                { shape: 'rect', width: 40, height: 20 },
                { shape: 'ellipse', width: 80, height: 40 },
                { shape: 'polygon', vertices: [0, 0, 30, 0, 30, 30] },
                { shape: 'polyline', vertices: [0, 0, 10, 0, 10, 10] },
            ];
            for (const s of shapes) {
                const o = obj({ ...s, x: 0, y: 0, rotation: 0 });
                const rw = createMockWorld();
                const region = spawnObjectRegion(rw, o, rw.spawn(), 100, false)!;
                const lw = createMockWorld();
                const legacy = generateObjectCollision(
                    lw, [{ name: 'g', visible: true, properties: new Map(), objects: [o] } as never], 0, 0, 100,
                )[0];
                for (const C of [BoxCollider, CircleCollider, PolygonCollider, ChainCollider]) {
                    expect(rw.get(region, C)).toEqual(lw.get(legacy, C));
                }
                expect(rw.get(region, Transform).position).toEqual(lw.get(legacy, Transform).position);
            }
        });
    });

    it('should generate tile collision from collisionTileIds option', () => {
        const world = createMockWorld();
        const tiles = new Uint16Array([1, 1, 0, 0]);
        const mapData: TiledMapData = {
            width: 2, height: 2, tileWidth: 32, tileHeight: 32,
            layers: [{
                name: 'Ground', width: 2, height: 2, visible: true,
                tiles,
                ...defaultLayerProps,
            }],
            tilesets: [{ name: 'ts', image: 'ts.png', tileWidth: 32, tileHeight: 32, columns: 4, tileCount: 16 }],
            objectGroups: [],
            collisionTileIds: [],
        };

        const entities = loadTiledMap(world, mapData, new Map([['ts.png', 1]]), {
            collisionTileIds: [1],
        });
        expect(entities.length).toBeGreaterThan(1);
    });
});

describe('generateLayerCollision (B2-1 runtime tile collision)', () => {
    interface MockEntity { Transform?: any; RigidBody?: any; BoxCollider?: any }

    function createMockWorld(): { world: World; store: Map<number, MockEntity> } {
        let nextId = 1;
        const store = new Map<number, MockEntity>();
        const world = {
            spawn: vi.fn(() => {
                const id = nextId++ as Entity;
                store.set(id, {});
                return id;
            }),
            insert: vi.fn((entity: Entity, comp: any, data: any) => {
                (store.get(entity) as any)[comp._name] = data;
            }),
        } as unknown as World;
        return { world, store };
    }

    it('merges a solid block into one centered static box collider', () => {
        const { world, store } = createMockWorld();
        // 2×2 grid, all tile id 1 (collidable), 16px tiles → one merged 32×32 rect.
        const tiles = new Uint16Array([1, 1, 1, 1]);
        const ents = generateLayerCollision(world, tiles, 2, 2, 16, 16, new Set([1]), 0, 0);

        expect(ents).toHaveLength(1);
        const e = store.get(ents[0])!;
        // y-DOWN (matches the renderer): row 0 top edge at origin y=0, centre below.
        expect(e.Transform.position).toEqual({ x: 16, y: -16, z: 0 });
        expect(e.BoxCollider.halfExtents).toEqual({ x: 16, y: 16 });
        expect(e.RigidBody.bodyType).toBe(BodyType.Static);
    });

    it('places rows y-down so lower rows sit at more-negative world-Y', () => {
        const { world, store } = createMockWorld();
        // 1 column × 3 rows, only the BOTTOM row (row index 2, stored last) is collidable.
        const tiles = new Uint16Array([0, 0, 1]);
        const ents = generateLayerCollision(world, tiles, 1, 3, 10, 10, new Set([1]), 0, 0);

        expect(ents).toHaveLength(1);
        // row2 → worldY = -(2*10) - 5 = -25 (matches renderer `origin - ty*th - hh`).
        expect(store.get(ents[0])!.Transform.position).toEqual({ x: 5, y: -25, z: 0 });
    });

    it('offsets colliders by the tilemap entity world origin', () => {
        const { world, store } = createMockWorld();
        const tiles = new Uint16Array([1, 1, 1, 1]);
        const ents = generateLayerCollision(world, tiles, 2, 2, 16, 16, new Set([1]), 100, 200);
        expect(store.get(ents[0])!.Transform.position).toEqual({ x: 116, y: 184, z: 0 });
    });

    it('ignores non-collidable and empty tiles', () => {
        const { world } = createMockWorld();
        const tiles = new Uint16Array([0, 2, 0, 0]); // tile 2 not in the collision set
        expect(generateLayerCollision(world, tiles, 2, 2, 16, 16, new Set([1]), 0, 0)).toHaveLength(0);
    });

    it('carries collisionTileIds through the runtime source cache', () => {
        clearTilemapSourceCache();
        registerTilemapSource('lvl.tmj', {
            tileWidth: 16, tileHeight: 16, layers: [], tilesets: [],
            collisionTileIds: [3, 7],
        });
        expect(getTilemapSource('lvl.tmj')?.collisionTileIds).toEqual([3, 7]);
    });
});
