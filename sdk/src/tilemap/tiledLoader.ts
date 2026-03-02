import { getTiledAPI } from './tilemapAPI';
import type { World } from '../world';
import type { Entity } from '../types';
import { TilemapLayer } from './components';
import { Transform } from '../component';

export interface TiledLayerData {
    name: string;
    width: number;
    height: number;
    visible: boolean;
    tiles: Uint16Array;
}

export interface TiledTilesetData {
    name: string;
    image: string;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    tileCount: number;
}

export interface TiledMapData {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    layers: TiledLayerData[];
    tilesets: TiledTilesetData[];
}

const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;
const TILED_GID_MASK = 0x1FFFFFFF;
const ENGINE_FLIP_H = 0x2000;
const ENGINE_FLIP_V = 0x4000;
const ENGINE_FLIP_D = 0x8000;

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

            layers.push({
                name: (layer.name as string) ?? '',
                width: lw,
                height: lh,
                visible,
                tiles,
            });
        }
    }

    return { width, height, tileWidth, tileHeight, layers, tilesets };
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
            layers: [],
            tilesets: [],
        };

        const layerCount = api.tiled_getLayerCount(handle);
        for (let i = 0; i < layerCount; i++) {
            const w = api.tiled_getLayerWidth(handle, i);
            const h = api.tiled_getLayerHeight(handle, i);
            const tileCount = w * h;
            const tileBytes = tileCount * 2;
            const tilePtr = api._malloc(tileBytes);
            api.tiled_getLayerTiles(handle, i, tilePtr, tileCount);
            const tiles = new Uint16Array(tileCount);
            tiles.set(new Uint16Array(api.HEAPU8.buffer, tilePtr, tileCount));
            api._free(tilePtr);

            result.layers.push({
                name: api.tiled_getLayerName(handle, i),
                width: w,
                height: h,
                visible: api.tiled_getLayerVisible(handle, i),
                tiles,
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
    } catch {
        api.tiled_freeMap(handle);
        return null;
    }
}

export function loadTiledMap(
    world: World,
    mapData: TiledMapData,
    textureHandles: Map<string, number>,
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
        });

        entities.push(entity);
        layerIndex++;
    }

    return entities;
}
