// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getTiledAPI, TilemapAPI } from './tilemapAPI';
import type { World } from '../world';
import type { Entity } from '../types';
import { TilemapLayer } from './components';
import { Transform } from '../component';

// Matches TilemapSystem::CHUNK_SIZE on the C++ side.
const TILEMAP_CHUNK_SIZE = 16;

function uploadTiledLayerTiles(entity: Entity, layer: TiledLayerData): void {
    if (layer.infinite) {
        for (const chunk of layer.chunks) {
            TilemapAPI.setChunkTiles(entity, chunk.x, chunk.y, chunk.tiles, chunk.width, chunk.height);
        }
        return;
    }
    const { width, height, tiles } = layer;
    if (width <= 0 || height <= 0 || tiles.length === 0) return;
    const chunksX = Math.ceil(width / TILEMAP_CHUNK_SIZE);
    const chunksY = Math.ceil(height / TILEMAP_CHUNK_SIZE);
    const buf = new Uint16Array(TILEMAP_CHUNK_SIZE * TILEMAP_CHUNK_SIZE);
    for (let cy = 0; cy < chunksY; cy++) {
        for (let cx = 0; cx < chunksX; cx++) {
            buf.fill(0);
            const regionW = Math.min(TILEMAP_CHUNK_SIZE, width - cx * TILEMAP_CHUNK_SIZE);
            const regionH = Math.min(TILEMAP_CHUNK_SIZE, height - cy * TILEMAP_CHUNK_SIZE);
            for (let ly = 0; ly < regionH; ly++) {
                const gy = cy * TILEMAP_CHUNK_SIZE + ly;
                for (let lx = 0; lx < regionW; lx++) {
                    const gx = cx * TILEMAP_CHUNK_SIZE + lx;
                    buf[ly * TILEMAP_CHUNK_SIZE + lx] = tiles[gy * width + gx];
                }
            }
            TilemapAPI.setChunkTiles(entity, cx, cy, buf, regionW, regionH);
        }
    }
}
import { RigidBody, BoxCollider, CircleCollider, BodyType } from '../physics/PhysicsComponents';
import { mergeCollisionTiles } from './collisionMerge';
import { CHUNK_SIZE } from './chunkCodec';
import { log } from '../logger';
import { withMalloc } from '../wasmScratch';

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
    firstGid: number;   // global tile-id at which this tileset begins
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

// Keep the global GID as the engine tile-id (Tiled GIDs are contiguous across
// tilesets); the runtime tileset table resolves it to (tileset, local). For a
// single-tileset map (firstgid 1) this equals the old local id + 1.
function convertGid(gid: number): number {
    if (gid === 0) return 0;
    let flags = 0;
    if (gid & TILED_FLIP_H) flags |= ENGINE_FLIP_H;
    if (gid & TILED_FLIP_V) flags |= ENGINE_FLIP_V;
    if (gid & TILED_FLIP_D) flags |= ENGINE_FLIP_D;
    const globalId = (gid & TILED_GID_MASK) & 0x1FFF;
    return globalId | flags;
}

export function parseTmjJson(json: Record<string, unknown>): TiledMapData | null {
    const width = json.width as number;
    const height = json.height as number;
    const tileWidth = (json.tilewidth as number) ?? 0;
    const tileHeight = (json.tileheight as number) ?? 0;
    if (!width || !height || !tileWidth || !tileHeight) return null;

    const rawTilesets = json.tilesets as Array<Record<string, unknown>> | undefined;
    const tilesets: TiledTilesetData[] = [];

    if (rawTilesets) {
        for (const ts of rawTilesets) {
            tilesets.push({
                name: (ts.name as string) ?? '',
                image: (ts.image as string) ?? '',
                firstGid: (ts.firstgid as number) ?? 1,
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
                for (let i = 0; i < rawData.length && i < tiles.length; i++) {
                    tiles[i] = convertGid(rawData[i]);
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
                    // Global engine id = tileset-local id + firstGid (matches the
                    // global GIDs stored in the layer). firstgid 1 -> localId + 1.
                    const engineId = localId + firstGid;

                    const rawAnim = tile.animation as Array<Record<string, unknown>> | undefined;
                    if (rawAnim && rawAnim.length > 0) {
                        const frames: TiledAnimFrame[] = rawAnim.map(f => ({
                            tileId: ((f.tileid as number) ?? 0) + firstGid,
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
    const handle = withMalloc(api, encoded.byteLength, ptr => {
        api.HEAPU8.set(encoded, ptr);
        return api.tiled_loadMap(ptr, encoded.byteLength);
    });

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
            const ok = withMalloc(api, tsjEncoded.byteLength, tsjPtr => {
                api.HEAPU8.set(tsjEncoded, tsjPtr);
                return api.tiled_loadExternalTileset(handle, i, tsjPtr, tsjEncoded.byteLength);
            });
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
                    const chunkTiles = withMalloc(api, count * 2, ptr => {
                        api.tiled_getLayerChunkTiles(handle, i, c, ptr, count);
                        const out = new Uint16Array(count);
                        out.set(new Uint16Array(api.HEAPU8.buffer, ptr, count));
                        return out;
                    });
                    chunks.push({ x: cx, y: cy, width: cw, height: ch, tiles: chunkTiles });
                }
            } else {
                const tileCount = w * h;
                tiles = new Uint16Array(tileCount);
                withMalloc(api, tileCount * 2, tilePtr => {
                    api.tiled_getLayerTiles(handle, i, tilePtr, tileCount);
                    tiles.set(new Uint16Array(api.HEAPU8.buffer, tilePtr, tileCount));
                });
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
                firstGid: api.tiled_getTilesetFirstGid ? api.tiled_getTilesetFirstGid(handle, i) : 1,
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

/**
 * @brief Greedy-merge a tile grid's collidable cells into static box colliders.
 *
 * Grid-agnostic core shared by the Tiled-import (`generateTileCollision`) and the runtime
 * asset (`TilemapSyncSystem`) paths. Tiles are stored top-down (row 0 = top) while the
 * world is y-up, so rows flip within `flipHeight` tile-rows of pixel height; each merged
 * rect becomes one static `BoxCollider` body placed relative to (originX, originY) — the
 * tilemap entity's world origin.
 *
 * @param flipHeight Tile-rows used for the y-flip (defaults to the grid height; the Tiled
 *        path passes the MAP height so a sub-sized layer flips against the map box).
 */
export function generateLayerCollision(
    world: World,
    tiles: ArrayLike<number>,
    gridWidth: number,
    gridHeight: number,
    tileW: number,
    tileH: number,
    collisionIds: Set<number>,
    originX: number,
    originY: number,
    flipHeight: number = gridHeight,
): Entity[] {
    const merged = mergeCollisionTiles(tiles, gridWidth, gridHeight, collisionIds);
    const entities: Entity[] = [];
    const pixelH = flipHeight * tileH;

    for (const rect of merged) {
        const mergedW = rect.width * tileW;
        const mergedH = rect.height * tileH;
        const worldX = originX + rect.col * tileW + mergedW * 0.5;
        const worldY = originY + (pixelH - rect.row * tileH) - mergedH * 0.5;

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

export function generateTileCollision(
    world: World,
    layer: TiledLayerData,
    mapData: TiledMapData,
    collisionIds: Set<number>,
    originX: number,
    originY: number,
): Entity[] {
    return generateLayerCollision(
        world, layer.tiles, layer.width, layer.height,
        mapData.tileWidth, mapData.tileHeight, collisionIds,
        originX, originY, mapData.height,
    );
}

/**
 * @brief Build static box colliders for an INFINITE (chunked) tilemap layer from its
 *        collidable tiles — the native scene-`TilemapLayer` path.
 *
 * Each chunk's collidable tiles are greedy-merged independently (no cross-chunk merge); a
 * merged rect (x0,y0)-(x1,y1) maps to a world AABB by the SAME orthogonal convention
 * `worldToTile` uses (tile tx covers world-x [origin.x+tx·tw, origin.x+(tx+1)·tw); world-y
 * grows downward as ty rises), so colliders line up exactly with what the painter placed.
 * (Isometric/staggered collision is not derived here.)
 */
export function generateChunkCollision(
    world: World,
    chunks: { x: number; y: number; tiles: Uint16Array }[],
    collisionIds: Set<number>,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
): Entity[] {
    const entities: Entity[] = [];
    for (const chunk of chunks) {
        const merged = mergeCollisionTiles(chunk.tiles, CHUNK_SIZE, CHUNK_SIZE, collisionIds);
        const baseX = chunk.x * CHUNK_SIZE;
        const baseY = chunk.y * CHUNK_SIZE;
        for (const rect of merged) {
            const x0 = baseX + rect.col;
            const y0 = baseY + rect.row;
            const x1 = x0 + rect.width - 1;
            const y1 = y0 + rect.height - 1;
            const entity = world.spawn();
            world.insert(entity, Transform, {
                position: {
                    x: originX + ((x0 + x1 + 1) / 2) * tileW,
                    y: originY - ((y0 + y1 + 1) / 2) * tileH,
                    z: 0,
                },
            });
            world.insert(entity, RigidBody, { bodyType: BodyType.Static });
            world.insert(entity, BoxCollider, {
                halfExtents: { x: rect.width * tileW * 0.5, y: rect.height * tileH * 0.5 },
            });
            entities.push(entity);
        }
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
            cellSize: { x: mapData.tileWidth, y: mapData.tileHeight },
            tileset: textureHandle,
            tilesetColumns: columns,
            tilesetRows: firstTileset
                ? Math.max(1, Math.ceil(firstTileset.tileCount / Math.max(1, columns)))
                : 1,
            renderLayer: layerIndex,
            tintColor: { ...layer.tintColor },
            opacity: layer.opacity,
            visible: layer.visible,
            parallaxFactor: { x: layer.parallaxX, y: layer.parallaxY },
        });

        TilemapAPI.initInfiniteLayer(entity, mapData.tileWidth, mapData.tileHeight);
        TilemapAPI.setOriginEntity(entity, entity);
        uploadTiledLayerTiles(entity, layer);

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
