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
import { loadTiledMap, parseTmjJson, resolveRelativePath, loadTiledCollisionObjects } from '../src/tilemap/tiledLoader';
import type { TiledMapData } from '../src/tilemap/tiledLoader';
import { mergeCollisionTiles } from '../src/tilemap/collisionMerge';
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

    it('should create entities for rect objects', () => {
        const world = createMockWorld();
        const mapData: TiledMapData = {
            width: 10, height: 10, tileWidth: 32, tileHeight: 32,
            layers: [], tilesets: [], collisionTileIds: [],
            objectGroups: [{
                name: 'Collision',
                objects: [
                    { shape: 'rect' as const, x: 64, y: 96, width: 32, height: 32, rotation: 0, vertices: null, properties: new Map() },
                ],
            }],
        };

        const entities = loadTiledCollisionObjects(world, mapData, 0, 0);
        expect(entities).toHaveLength(1);
        expect(world.spawn).toHaveBeenCalledTimes(1);

        const insertCalls = (world.insert as any).mock.calls;
        const rbInsert = insertCalls.find((c: any) => c[1]._name === 'RigidBody');
        expect(rbInsert).toBeDefined();
        expect(rbInsert[2].bodyType).toBe(0);

        const boxInsert = insertCalls.find((c: any) => c[1]._name === 'BoxCollider');
        expect(boxInsert).toBeDefined();
        expect(boxInsert[2].halfExtents.x).toBe(16);
        expect(boxInsert[2].halfExtents.y).toBe(16);
    });

    it('should create CircleCollider for ellipse objects', () => {
        const world = createMockWorld();
        const mapData: TiledMapData = {
            width: 10, height: 10, tileWidth: 32, tileHeight: 32,
            layers: [], tilesets: [], collisionTileIds: [],
            objectGroups: [{
                name: 'Collision',
                objects: [
                    { shape: 'ellipse' as const, x: 0, y: 0, width: 64, height: 32, rotation: 0, vertices: null, properties: new Map() },
                ],
            }],
        };

        loadTiledCollisionObjects(world, mapData, 0, 0);

        const insertCalls = (world.insert as any).mock.calls;
        const circleInsert = insertCalls.find((c: any) => c[1]._name === 'CircleCollider');
        expect(circleInsert).toBeDefined();
        expect(circleInsert[2].radius).toBe(32);
    });

    it('should skip point objects', () => {
        const world = createMockWorld();
        const mapData: TiledMapData = {
            width: 10, height: 10, tileWidth: 32, tileHeight: 32,
            layers: [], tilesets: [], collisionTileIds: [],
            objectGroups: [{
                name: 'Points',
                objects: [
                    { shape: 'point' as const, x: 10, y: 20, width: 0, height: 0, rotation: 0, vertices: null, properties: new Map() },
                ],
            }],
        };

        const entities = loadTiledCollisionObjects(world, mapData, 0, 0);
        expect(entities).toHaveLength(0);
        expect(world.spawn).not.toHaveBeenCalled();
    });

    it('should create BoxCollider for polygon using bounding box', () => {
        const world = createMockWorld();
        const mapData: TiledMapData = {
            width: 10, height: 10, tileWidth: 32, tileHeight: 32,
            layers: [], tilesets: [], collisionTileIds: [],
            objectGroups: [{
                name: 'Polys',
                objects: [{
                    shape: 'polygon' as const,
                    x: 0, y: 0, width: 0, height: 0, rotation: 0,
                    vertices: [0, 0, 40, 0, 40, 20, 0, 20],
                    properties: new Map(),
                }],
            }],
        };

        loadTiledCollisionObjects(world, mapData, 0, 0);

        const insertCalls = (world.insert as any).mock.calls;
        const boxInsert = insertCalls.find((c: any) => c[1]._name === 'BoxCollider');
        expect(boxInsert).toBeDefined();
        expect(boxInsert[2].halfExtents.x).toBe(20);
        expect(boxInsert[2].halfExtents.y).toBe(10);
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
