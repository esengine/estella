import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    Tilemap,
    TilemapLayer,
    TilemapAPI,
    initTilemapAPI,
    shutdownTilemapAPI,
} from '../src/tilemap';
import {
    registerTextureDimensions,
    getTextureDimensions,
    clearTextureDimensionsCache,
    registerTilemapSource,
    getTilemapSource,
    clearTilemapSourceCache,
} from '../src/tilemap/tilesetCache';
import { loadTiledMap, parseTmjJson, resolveRelativePath } from '../src/tilemap/tiledLoader';
import type { TiledMapData } from '../src/tilemap/tiledLoader';
import { clearUserComponents } from '../src/component';
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

        it('should have texture field defaulting to 0', () => {
            expect(TilemapLayer._default.texture).toBe(0);
        });

        it('should have tilesetColumns field defaulting to 1', () => {
            expect(TilemapLayer._default.tilesetColumns).toBe(1);
        });

        it('should have tileWidth and tileHeight defaults', () => {
            expect(TilemapLayer._default.tileWidth).toBe(32);
            expect(TilemapLayer._default.tileHeight).toBe(32);
        });

        it('should have correct defaults', () => {
            expect(TilemapLayer._default).toEqual({
                width: 10,
                height: 10,
                tileWidth: 32,
                tileHeight: 32,
                texture: 0,
                tilesetColumns: 1,
                layer: 0,
                tiles: [],
            });
        });

        it('should create instances with deep-cloned tiles array', () => {
            const a = TilemapLayer.create();
            const b = TilemapLayer.create();
            a.tiles.push(1);
            expect(b.tiles).toEqual([]);
        });
    });
});

describe('TextureDimensions cache', () => {
    beforeEach(() => {
        clearTextureDimensionsCache();
    });

    it('should register and retrieve dimensions', () => {
        registerTextureDimensions(42, 256, 512);
        const dims = getTextureDimensions(42);
        expect(dims).toEqual({ width: 256, height: 512 });
    });

    it('should return undefined for unregistered handle', () => {
        expect(getTextureDimensions(99)).toBeUndefined();
    });

    it('should overwrite existing entry', () => {
        registerTextureDimensions(42, 100, 100);
        registerTextureDimensions(42, 200, 300);
        expect(getTextureDimensions(42)).toEqual({ width: 200, height: 300 });
    });

    it('should clear all entries', () => {
        registerTextureDimensions(1, 64, 64);
        registerTextureDimensions(2, 128, 128);
        clearTextureDimensionsCache();
        expect(getTextureDimensions(1)).toBeUndefined();
        expect(getTextureDimensions(2)).toBeUndefined();
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
            tilesets: [{ textureHandle: 42, columns: 8 }],
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
            },
            {
                name: 'Objects',
                width: 20,
                height: 15,
                visible: true,
                tiles: new Uint16Array([0, 0, 5, 6, 7]),
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

        expect(layerInserts[0][2].texture).toBe(42);
        expect(layerInserts[0][2].tilesetColumns).toBe(8);
        expect(layerInserts[0][2].tileWidth).toBe(16);
        expect(layerInserts[0][2].tileHeight).toBe(16);
        expect(layerInserts[0][2].width).toBe(20);
        expect(layerInserts[0][2].height).toBe(15);
        expect(layerInserts[0][2].layer).toBe(0);
    });

    it('should assign incremental layer sort order', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);

        loadTiledMap(world, sampleMapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInserts = insertCalls.filter((c: any) => c[1]._name === 'TilemapLayer');
        expect(layerInserts[0][2].layer).toBe(0);
        expect(layerInserts[1][2].layer).toBe(1);
    });

    it('should convert Uint16Array tiles to number[]', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);

        loadTiledMap(world, sampleMapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInsert = insertCalls.find((c: any) => c[1]._name === 'TilemapLayer');
        expect(Array.isArray(layerInsert[2].tiles)).toBe(true);
        expect(layerInsert[2].tiles).toEqual([1, 2, 3, 0, 0]);
    });

    it('should use texture handle 0 when tileset image is not in textureHandles', () => {
        const world = createMockWorld();
        const textureHandles = new Map<string, number>();

        loadTiledMap(world, sampleMapData, textureHandles);

        const insertCalls = (world.insert as any).mock.calls;
        const layerInsert = insertCalls.find((c: any) => c[1]._name === 'TilemapLayer');
        expect(layerInsert[2].texture).toBe(0);
    });

    it('should return empty array for map with no layers', () => {
        const world = createMockWorld();
        const textureHandles = new Map([['terrain.png', 42]]);
        const emptyMap: TiledMapData = { ...sampleMapData, layers: [] };

        const entities = loadTiledMap(world, emptyMap, textureHandles);

        expect(entities).toHaveLength(0);
        expect(world.spawn).not.toHaveBeenCalled();
    });
});
