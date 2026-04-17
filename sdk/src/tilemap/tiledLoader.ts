import { getTiledAPI } from './tilemapAPI';
import type { World } from '../world';
import type { Entity } from '../types';
import { TilemapLayer } from './components';
import { Transform } from '../component';
import { RigidBody, BoxCollider, CircleCollider, BodyType } from '../physics/PhysicsComponents';
import { mergeCollisionTiles } from './collisionMerge';
import { log } from '../logger';

export interface TiledChunkData {
    x: number;
    y: number;
    width: number;
    height: number;
    tiles: Uint16Array;
}

export interface TiledLayerData {
    name: string;
    width: number;
    height: number;
    visible: boolean;
    tiles: Uint16Array;
    chunks: TiledChunkData[];
    infinite: boolean;
    opacity: number;
    tintColor: { r: number; g: number; b: number; a: number };
    parallaxX: number;
    parallaxY: number;
}

export interface TiledTilesetData {
    name: string;
    image: string;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    tileCount: number;
}

export type TiledObjectShape = 'rect' | 'ellipse' | 'polygon' | 'point';

export interface TiledObjectData {
    shape: TiledObjectShape;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    vertices: number[] | null;
    properties: Map<string, unknown>;
}

export interface TiledObjectGroupData {
    name: string;
    objects: TiledObjectData[];
}

export interface TiledAnimFrame {
    tileId: number;
    duration: number;
}

export interface TiledMapData {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    orientation: string;
    layers: TiledLayerData[];
    tilesets: TiledTilesetData[];
    objectGroups: TiledObjectGroupData[];
    collisionTileIds: number[];
    tileAnimations: Map<number, TiledAnimFrame[]>;
    tileProperties: Map<number, Map<string, string>>;
}

const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;
const TILED_GID_MASK = 0x1FFFFFFF;
const ENGINE_FLIP_H = 0x2000;
const ENGINE_FLIP_V = 0x4000;
const ENGINE_FLIP_D = 0x8000;

function parseTintColorU32(val: number): { r: number; g: number; b: number; a: number } {
    if (val === 0) return { r: 1, g: 1, b: 1, a: 1 };
    const a = ((val >>> 24) & 0xFF) / 255;
    const r = ((val >>> 16) & 0xFF) / 255;
    const g = ((val >>> 8) & 0xFF) / 255;
    const b = (val & 0xFF) / 255;
    return { r, g, b, a: a === 0 ? 1 : a };
}

function parseTintColor(hex: string | undefined): { r: number; g: number; b: number; a: number } {
    if (!hex) return { r: 1, g: 1, b: 1, a: 1 };
    const s = hex.startsWith('#') ? hex.slice(1) : hex;
    if (s.length === 8) {
        const a = parseInt(s.slice(0, 2), 16) / 255;
        const r = parseInt(s.slice(2, 4), 16) / 255;
        const g = parseInt(s.slice(4, 6), 16) / 255;
        const b = parseInt(s.slice(6, 8), 16) / 255;
        return { r, g, b, a };
    }
    if (s.length === 6) {
        const r = parseInt(s.slice(0, 2), 16) / 255;
        const g = parseInt(s.slice(2, 4), 16) / 255;
        const b = parseInt(s.slice(4, 6), 16) / 255;
        return { r, g, b, a: 1 };
    }
    return { r: 1, g: 1, b: 1, a: 1 };
}

function convertGid(gid: number, firstGid: number): number {
    if (gid === 0) return 0;
    let flags = 0;
    if (gid & TILED_FLIP_H) flags |= ENGINE_FLIP_H;
    if (gid & TILED_FLIP_V) flags |= ENGINE_FLIP_V;
    if (gid & TILED_FLIP_D) flags |= ENGINE_FLIP_D;
    const localId = (gid & TILED_GID_MASK) - firstGid;
    return (localId + 1) | flags;
}

export function parseTmjJson(json: Record<string, unknown>): TiledMapData | null {
    const width = json.width as number;
    const height = json.height as number;
    const tileWidth = (json.tilewidth as number) ?? 0;
    const tileHeight = (json.tileheight as number) ?? 0;
    if (!width || !height || !tileWidth || !tileHeight) return null;

    const rawTilesets = json.tilesets as Array<Record<string, unknown>> | undefined;
    const tilesets: TiledTilesetData[] = [];
    const firstGids: number[] = [];

    if (rawTilesets) {
        for (const ts of rawTilesets) {
            const firstGid = (ts.firstgid as number) ?? 1;
            firstGids.push(firstGid);
            tilesets.push({
                name: (ts.name as string) ?? '',
                image: (ts.image as string) ?? '',
                tileWidth: (ts.tilewidth as number) ?? tileWidth,
                tileHeight: (ts.tileheight as number) ?? tileHeight,
                columns: (ts.columns as number) ?? 1,
                tileCount: (ts.tilecount as number) ?? 0,
            });
        }
    }

    const rawLayers = json.layers as Array<Record<string, unknown>> | undefined;
    const layers: TiledLayerData[] = [];

    if (rawLayers) {
        for (const layer of rawLayers) {
            if (layer.type !== 'tilelayer') continue;
            const lw = (layer.width as number) ?? width;
            const lh = (layer.height as number) ?? height;
            const visible = layer.visible !== false;
            const rawData = layer.data as number[] | undefined;

            const tiles = new Uint16Array(lw * lh);
            if (rawData) {
                const firstGid = firstGids[0] ?? 1;
                for (let i = 0; i < rawData.length && i < tiles.length; i++) {
                    tiles[i] = convertGid(rawData[i], firstGid);
                }
            }

            const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1;
            const rawTint = layer.tintcolor as string | undefined;
            const tintColor = parseTintColor(rawTint);
            const parallaxX = typeof layer.parallaxx === 'number' ? layer.parallaxx : 1;
            const parallaxY = typeof layer.parallaxy === 'number' ? layer.parallaxy : 1;

            layers.push({
                name: (layer.name as string) ?? '',
                width: lw,
                height: lh,
                visible,
                tiles,
                chunks: [],
                infinite: false,
                opacity,
                tintColor,
                parallaxX,
                parallaxY,
            });
        }
    }

    const objectGroups: TiledObjectGroupData[] = [];
    const collisionTileIds: number[] = [];

    if (rawLayers) {
        for (const layer of rawLayers) {
            if (layer.type !== 'objectgroup') continue;
            const objs = layer.objects as Array<Record<string, unknown>> | undefined;
            if (!objs) continue;
            const parsed: TiledObjectData[] = [];
            for (const obj of objs) {
                const props = new Map<string, unknown>();
                const rawProps = obj.properties as Array<Record<string, unknown>> | undefined;
                if (rawProps) {
                    for (const p of rawProps) {
                        props.set(p.name as string, p.value);
                    }
                }
                let shape: TiledObjectShape = 'rect';
                let vertices: number[] | null = null;
                if (obj.ellipse) {
                    shape = 'ellipse';
                } else if (obj.point) {
                    shape = 'point';
                } else if (obj.polygon) {
                    shape = 'polygon';
                    const polyPts = obj.polygon as Array<{ x: number; y: number }>;
                    vertices = [];
                    for (const pt of polyPts) {
                        vertices.push(pt.x, pt.y);
                    }
                } else if (obj.polyline) {
                    shape = 'polygon';
                    const linePts = obj.polyline as Array<{ x: number; y: number }>;
                    vertices = [];
                    for (const pt of linePts) {
                        vertices.push(pt.x, pt.y);
                    }
                }
                parsed.push({
                    shape,
                    x: (obj.x as number) ?? 0,
                    y: (obj.y as number) ?? 0,
                    width: (obj.width as number) ?? 0,
                    height: (obj.height as number) ?? 0,
                    rotation: (obj.rotation as number) ?? 0,
                    vertices,
                    properties: props,
                });
            }
            objectGroups.push({
                name: (layer.name as string) ?? '',
                objects: parsed,
            });
        }
    }

    const tileAnimations = new Map<number, TiledAnimFrame[]>();
    const tileProperties = new Map<number, Map<string, string>>();

    if (rawTilesets) {
        for (const ts of rawTilesets) {
            const firstGid = (ts.firstgid as number) ?? 1;
            const rawTiles = ts.tiles as Array<Record<string, unknown>> | undefined;
            if (rawTiles) {
                for (const tile of rawTiles) {
                    const localId = (tile.id as number);
                    const engineId = localId + 1;

                    const rawAnim = tile.animation as Array<Record<string, unknown>> | undefined;
                    if (rawAnim && rawAnim.length > 0) {
                        const frames: TiledAnimFrame[] = rawAnim.map(f => ({
                            tileId: ((f.tileid as number) ?? 0) + 1,
                            duration: (f.duration as number) ?? 100,
                        }));
                        tileAnimations.set(engineId, frames);
                    }

                    const tileProps = tile.properties as Array<Record<string, unknown>> | undefined;
                    if (tileProps) {
                        const propMap = new Map<string, string>();
                        for (const p of tileProps) {
                            const name = p.name as string;
                            if (name === 'collision' && p.value === true) {
                                collisionTileIds.push(localId + firstGid);
                            }
                            propMap.set(name, String(p.value));
                        }
                        if (propMap.size > 0) {
                            tileProperties.set(engineId, propMap);
                        }
                    }
                }
            }
        }
    }

    const orientation = (json.orientation as string) ?? 'orthogonal';

    return {
        width, height, tileWidth, tileHeight, orientation,
        layers, tilesets, objectGroups, collisionTileIds,
        tileAnimations, tileProperties,
    };
}

export function resolveRelativePath(basePath: string, relativePath: string): string {
    const lastSlash = basePath.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? basePath.substring(0, lastSlash + 1) : '';
    const parts = (baseDir + relativePath).split('/');
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            resolved.pop();
        } else if (part !== '.' && part !== '') {
            resolved.push(part);
        }
    }
    return resolved.join('/');
}

export async function parseTiledMap(
    jsonString: string,
    resolveExternal?: (source: string) => Promise<string>
): Promise<TiledMapData | null> {
    const api = getTiledAPI();
    if (!api) return null;

    const encoder = new TextEncoder();
    const encoded = encoder.encode(jsonString);
    const ptr = api._malloc(encoded.byteLength);
    api.HEAPU8.set(encoded, ptr);

    const handle = api.tiled_loadMap(ptr, encoded.byteLength);
    api._free(ptr);

    if (handle === 0) return null;

    try {
        const extCount = api.tiled_getExternalTilesetCount(handle);
        for (let i = 0; i < extCount; i++) {
            const source = api.tiled_getExternalTilesetSource(handle, i);
            if (!resolveExternal) {
                api.tiled_freeMap(handle);
                return null;
            }
            const tsjContent = await resolveExternal(source);
            const tsjEncoded = encoder.encode(tsjContent);
            const tsjPtr = api._malloc(tsjEncoded.byteLength);
            api.HEAPU8.set(tsjEncoded, tsjPtr);
            const ok = api.tiled_loadExternalTileset(handle, i, tsjPtr, tsjEncoded.byteLength);
            api._free(tsjPtr);
            if (!ok) {
                api.tiled_freeMap(handle);
                return null;
            }
        }

        if (!api.tiled_finalize(handle)) {
            api.tiled_freeMap(handle);
            return null;
        }

        const result: TiledMapData = {
            width: api.tiled_getMapWidth(handle),
            height: api.tiled_getMapHeight(handle),
            tileWidth: api.tiled_getMapTileWidth(handle),
            tileHeight: api.tiled_getMapTileHeight(handle),
            orientation: 'orthogonal',
            layers: [],
            tilesets: [],
            objectGroups: [],
            collisionTileIds: [],
            tileAnimations: new Map(),
            tileProperties: new Map(),
        };

        const layerCount = api.tiled_getLayerCount(handle);
        for (let i = 0; i < layerCount; i++) {
            const w = api.tiled_getLayerWidth(handle, i);
            const h = api.tiled_getLayerHeight(handle, i);
            const layerInfinite = api.tiled_isLayerInfinite(handle, i);

            let tiles = new Uint16Array(0);
            const chunks: TiledChunkData[] = [];

            if (layerInfinite) {
                const chunkCount = api.tiled_getLayerChunkCount(handle, i);
                for (let c = 0; c < chunkCount; c++) {
                    const cx = api.tiled_getLayerChunkX(handle, i, c);
                    const cy = api.tiled_getLayerChunkY(handle, i, c);
                    const cw = api.tiled_getLayerChunkWidth(handle, i, c);
                    const ch = api.tiled_getLayerChunkHeight(handle, i, c);
                    const count = cw * ch;
                    const ptr = api._malloc(count * 2);
                    api.tiled_getLayerChunkTiles(handle, i, c, ptr, count);
                    const chunkTiles = new Uint16Array(count);
                    chunkTiles.set(new Uint16Array(api.HEAPU8.buffer, ptr, count));
                    api._free(ptr);
                    chunks.push({ x: cx, y: cy, width: cw, height: ch, tiles: chunkTiles });
                }
            } else {
                const tileCount = w * h;
                const tilePtr = api._malloc(tileCount * 2);
                api.tiled_getLayerTiles(handle, i, tilePtr, tileCount);
                tiles = new Uint16Array(tileCount);
                tiles.set(new Uint16Array(api.HEAPU8.buffer, tilePtr, tileCount));
                api._free(tilePtr);
            }

            result.layers.push({
                name: api.tiled_getLayerName(handle, i),
                width: w,
                height: h,
                visible: api.tiled_getLayerVisible(handle, i),
                tiles,
                chunks,
                infinite: layerInfinite,
                opacity: api.tiled_getLayerOpacity(handle, i),
                tintColor: api.tiled_getLayerTintColor
                    ? parseTintColorU32(api.tiled_getLayerTintColor(handle, i))
                    : { r: 1, g: 1, b: 1, a: 1 },
                parallaxX: api.tiled_getLayerParallaxX(handle, i),
                parallaxY: api.tiled_getLayerParallaxY(handle, i),
            });
        }

        const tilesetCount = api.tiled_getTilesetCount(handle);
        for (let i = 0; i < tilesetCount; i++) {
            result.tilesets.push({
                name: api.tiled_getTilesetName(handle, i),
                image: api.tiled_getTilesetImage(handle, i),
                tileWidth: api.tiled_getTilesetTileWidth(handle, i),
                tileHeight: api.tiled_getTilesetTileHeight(handle, i),
                columns: api.tiled_getTilesetColumns(handle, i),
                tileCount: api.tiled_getTilesetTileCount(handle, i),
            });
        }

        api.tiled_freeMap(handle);
        return result;
    } catch (e) {
        log.warn('tilemap', 'Failed to parse tilemap', e);
        api.tiled_freeMap(handle);
        return null;
    }
}

export interface TilemapLoadOptions {
    generateObjectCollision?: boolean;
    collisionTileIds?: number[];
}

const DEG_TO_RAD = Math.PI / 180;

export function loadTiledCollisionObjects(
    world: World,
    mapData: TiledMapData,
    mapOriginX: number,
    mapOriginY: number,
): Entity[] {
    const entities: Entity[] = [];
    const mapPixelH = mapData.height * mapData.tileHeight;

    for (const group of mapData.objectGroups) {
        for (const obj of group.objects) {
            if (obj.shape === 'point') continue;

            const entity = world.spawn();
            const tiledX = obj.x;
            const tiledY = obj.y;
            const worldX = mapOriginX + tiledX + obj.width * 0.5;
            const worldY = mapOriginY + (mapPixelH - tiledY) - obj.height * 0.5;
            const angle = -obj.rotation * DEG_TO_RAD;

            world.insert(entity, Transform, {
                position: { x: worldX, y: worldY, z: 0 },
            });
            world.insert(entity, RigidBody, { bodyType: BodyType.Static });

            if (obj.shape === 'ellipse') {
                const radius = Math.max(obj.width, obj.height) * 0.5;
                world.insert(entity, CircleCollider, { radius });
            } else if (obj.shape === 'polygon' && obj.vertices) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < obj.vertices.length; i += 2) {
                    const vx = obj.vertices[i];
                    const vy = obj.vertices[i + 1];
                    if (vx < minX) minX = vx;
                    if (vx > maxX) maxX = vx;
                    if (vy < minY) minY = vy;
                    if (vy > maxY) maxY = vy;
                }
                const polyW = maxX - minX;
                const polyH = maxY - minY;
                const polyCX = (minX + maxX) * 0.5;
                const polyCY = (minY + maxY) * 0.5;
                world.insert(entity, BoxCollider, {
                    halfExtents: { x: polyW * 0.5, y: polyH * 0.5 },
                    offset: { x: polyCX, y: -polyCY },
                });
            } else {
                world.insert(entity, BoxCollider, {
                    halfExtents: { x: obj.width * 0.5, y: obj.height * 0.5 },
                });
            }

            if (angle !== 0) {
                const half = angle * 0.5;
                world.insert(entity, Transform, {
                    position: { x: worldX, y: worldY, z: 0 },
                    rotation: { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) },
                });
            }

            entities.push(entity);
        }
    }
    return entities;
}

export function generateTileCollision(
    world: World,
    layer: TiledLayerData,
    mapData: TiledMapData,
    collisionIds: Set<number>,
    originX: number,
    originY: number,
): Entity[] {
    const merged = mergeCollisionTiles(
        layer.tiles, layer.width, layer.height, collisionIds,
    );
    const entities: Entity[] = [];
    const tileW = mapData.tileWidth;
    const tileH = mapData.tileHeight;
    const mapPixelH = mapData.height * tileH;

    for (const rect of merged) {
        const mergedW = rect.width * tileW;
        const mergedH = rect.height * tileH;
        const worldX = originX + rect.col * tileW + mergedW * 0.5;
        const worldY = originY + (mapPixelH - rect.row * tileH) - mergedH * 0.5;

        const entity = world.spawn();
        world.insert(entity, Transform, {
            position: { x: worldX, y: worldY, z: 0 },
        });
        world.insert(entity, RigidBody, { bodyType: BodyType.Static });
        world.insert(entity, BoxCollider, {
            halfExtents: { x: mergedW * 0.5, y: mergedH * 0.5 },
        });
        entities.push(entity);
    }
    return entities;
}

export function loadTiledMap(
    world: World,
    mapData: TiledMapData,
    textureHandles: Map<string, number>,
    options: TilemapLoadOptions = {},
): Entity[] {
    const entities: Entity[] = [];
    const firstTileset = mapData.tilesets[0];

    let layerIndex = 0;
    for (const layer of mapData.layers) {
        if (!layer.visible) continue;

        const entity = world.spawn();
        world.insert(entity, Transform, {});

        const textureHandle = firstTileset
            ? (textureHandles.get(firstTileset.image) ?? 0)
            : 0;
        const columns = firstTileset?.columns ?? 1;

        world.insert(entity, TilemapLayer, {
            width: layer.width,
            height: layer.height,
            tileWidth: mapData.tileWidth,
            tileHeight: mapData.tileHeight,
            texture: textureHandle,
            tilesetColumns: columns,
            layer: layerIndex,
            tiles: Array.from(layer.tiles),
            tint: { ...layer.tintColor },
            opacity: layer.opacity,
            visible: layer.visible,
            parallaxFactor: { x: layer.parallaxX, y: layer.parallaxY },
        });

        entities.push(entity);
        layerIndex++;
    }

    const generateCollision = options.generateObjectCollision !== false;
    if (generateCollision && mapData.objectGroups.length > 0) {
        const collisionEntities = loadTiledCollisionObjects(world, mapData, 0, 0);
        entities.push(...collisionEntities);
    }

    const tileCollisionIds = new Set<number>(
        options.collisionTileIds ?? mapData.collisionTileIds,
    );
    if (tileCollisionIds.size > 0) {
        for (const layer of mapData.layers) {
            if (!layer.visible) continue;
            const tileEntities = generateTileCollision(
                world, layer, mapData, tileCollisionIds, 0, 0,
            );
            entities.push(...tileEntities);
        }
    }

    return entities;
}
