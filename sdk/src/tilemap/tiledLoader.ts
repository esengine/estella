// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { TilemapAPI } from './tilemapAPI';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { TilemapLayer } from './components';
import { Transform, Marker, RuntimeOnly } from '../ecs/component';

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
import { RigidBody, BoxCollider, CircleCollider, PolygonCollider, ChainCollider, OneWayPlatform, BodyType } from '../physics/PhysicsComponents';
import type { ColliderShape } from '../physics/ColliderShape';
import type { ResolvedTileCollision } from './tilesetResolve';
import { mergeCollisionTiles } from './collisionMerge';
import { CHUNK_SIZE } from './chunkCodec';
import { tileIdOf, tileFlagsOf } from './tileBits';
import { log } from '../util/logger';
import { resolveRelativePath, resolveTiledRef, isLogicalAssetRef } from './tiledPath';

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
    /** Atlas border before the first tile, and gap between tiles (px, Tiled). */
    margin?: number;
    spacing?: number;
    /** Image-collection tileset (Tiled "collection of images"): one image per
     *  tile, no top-level `image`. The loader folds these into ONE grid atlas
     *  at load time, so the renderer never sees the difference. Local ids may
     *  be sparse (deleted tiles leave holes). */
    collectionTiles?: TiledCollectionTile[];
}

export interface TiledCollectionTile {
    /** Local tile id (gid = firstGid + id). */
    id: number;
    /** Image ref, document-relative like a grid tileset's `image`. */
    image: string;
    /** Declared size (0 when the document omits it — the decode is the truth). */
    width: number;
    height: number;
}

export type TiledObjectShape = 'rect' | 'ellipse' | 'polygon' | 'polyline' | 'point';

export interface TiledObjectData {
    /** Tiled's per-map unique object id. */
    id: number;
    name: string;
    /** The object's class (the field Tiled called `type` before 1.9). */
    type: string;
    visible: boolean;
    shape: TiledObjectShape;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    vertices: number[] | null;
    properties: Map<string, unknown>;
    /** A tile (GID) object: the raw Tiled global tile id + flip flags. When set, the
     *  object is a positioned tile rendered as a sprite (see decodeTiledGid); absent
     *  for the shape objects (rect/ellipse/polygon/polyline/point). */
    gid?: number;
}

export interface TiledObjectGroupData {
    name: string;
    visible: boolean;
    properties: Map<string, unknown>;
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
    /** Hexagonal maps: Tiled's hexsidelength / staggeraxis / staggerindex. */
    hexSideLength: number;
    staggerAxis: string;
    staggerIndex: string;
    layers: TiledLayerData[];
    tilesets: TiledTilesetData[];
    objectGroups: TiledObjectGroupData[];
    collisionTileIds: number[];
    /**
     * Rich per-tile collision (global id → normalized shape + modifiers), read from
     * Tiled's tile collision editor (`tiles[].objectgroup`) and tile properties —
     * the same {@link ResolvedTileCollision} model `.estileset` tiles resolve to,
     * so both asset paths spawn identical colliders.
     */
    tileShapes: Map<number, ResolvedTileCollision>;
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

/** Split a Tiled tile-object GID into its global tile id + H/V/D flip flags. Unlike
 *  convertGid (which truncates to the engine's 13-bit tile-layer id), this keeps the
 *  full 29-bit global id so the object's tileset can be resolved by firstgid. */
export function decodeTiledGid(gid: number): { globalId: number; flipH: boolean; flipV: boolean; flipD: boolean } {
    return {
        globalId: gid & TILED_GID_MASK,
        flipH: (gid & TILED_FLIP_H) !== 0,
        flipV: (gid & TILED_FLIP_V) !== 0,
        flipD: (gid & TILED_FLIP_D) !== 0,
    };
}

/**
 * Flatten Tiled `group` layers (which nest child layers) into one list, in
 * document order — matching how tile/object layers are consumed.
 */
function flattenTmjLayers(rawLayers: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const layer of rawLayers) {
        if (layer.type === 'group') {
            const children = layer.layers as Array<Record<string, unknown>> | undefined;
            if (children) out.push(...flattenTmjLayers(children));
        } else {
            out.push(layer);
        }
    }
    return out;
}

/**
 * Re-chunk a Tiled infinite-layer chunk (tile-coordinate anchored, arbitrary
 * size) into the engine's CHUNK_SIZE grid, keyed by CHUNK INDICES — the
 * coordinate space `TilemapAPI.setChunkTiles` expects. Handles negative tile
 * coordinates (infinite maps grow in all directions) via floor division.
 */
function rechunkTiledLayer(rawChunks: Array<Record<string, unknown>>): TiledChunkData[] {
    const engine = new Map<string, TiledChunkData>();
    for (const chunk of rawChunks) {
        const baseX = (chunk.x as number) ?? 0;
        const baseY = (chunk.y as number) ?? 0;
        const w = (chunk.width as number) ?? 0;
        const h = (chunk.height as number) ?? 0;
        const data = chunk.data as number[] | undefined;
        if (!data) continue;
        for (let ty = 0; ty < h; ty++) {
            for (let tx = 0; tx < w; tx++) {
                const gid = data[ty * w + tx];
                if (!gid) continue;
                const gx = baseX + tx;
                const gy = baseY + ty;
                const cx = Math.floor(gx / CHUNK_SIZE);
                const cy = Math.floor(gy / CHUNK_SIZE);
                const key = `${cx},${cy}`;
                let target = engine.get(key);
                if (!target) {
                    target = {
                        x: cx, y: cy, width: CHUNK_SIZE, height: CHUNK_SIZE,
                        tiles: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE),
                    };
                    engine.set(key, target);
                }
                target.tiles[(gy - cy * CHUNK_SIZE) * CHUNK_SIZE + (gx - cx * CHUNK_SIZE)] = convertGid(gid);
            }
        }
    }
    return [...engine.values()];
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
            // Image-collection tileset: no top-level image, per-tile images.
            const rawTiles = ts.tiles as Array<Record<string, unknown>> | undefined;
            const collectionTiles = !ts.image && rawTiles?.some((t) => typeof t.image === 'string')
                ? rawTiles
                    .filter((t) => typeof t.image === 'string' && t.image)
                    .map((t) => ({
                        id: (t.id as number) ?? 0,
                        image: t.image as string,
                        width: (t.imagewidth as number) ?? 0,
                        height: (t.imageheight as number) ?? 0,
                    }))
                : undefined;
            tilesets.push({
                name: (ts.name as string) ?? '',
                image: (ts.image as string) ?? '',
                firstGid: (ts.firstgid as number) ?? 1,
                tileWidth: (ts.tilewidth as number) ?? tileWidth,
                tileHeight: (ts.tileheight as number) ?? tileHeight,
                columns: (ts.columns as number) ?? 1,
                tileCount: (ts.tilecount as number) ?? 0,
                margin: (ts.margin as number) ?? 0,
                spacing: (ts.spacing as number) ?? 0,
                ...(collectionTiles?.length ? { collectionTiles } : {}),
            });
        }
    }

    const topLayers = json.layers as Array<Record<string, unknown>> | undefined;
    const rawLayers = topLayers ? flattenTmjLayers(topLayers) : undefined;
    const layers: TiledLayerData[] = [];

    if (rawLayers) {
        for (const layer of rawLayers) {
            if (layer.type !== 'tilelayer') continue;
            const lw = (layer.width as number) ?? width;
            const lh = (layer.height as number) ?? height;
            const visible = layer.visible !== false;
            const rawData = layer.data as number[] | undefined;
            const rawChunks = layer.chunks as Array<Record<string, unknown>> | undefined;

            const infinite = !!rawChunks && rawChunks.length > 0;
            const chunks = infinite ? rechunkTiledLayer(rawChunks!) : [];
            const tiles = new Uint16Array(infinite ? 0 : lw * lh);
            if (!infinite && rawData) {
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
                chunks,
                infinite,
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
                    shape = 'polyline';
                    const linePts = obj.polyline as Array<{ x: number; y: number }>;
                    vertices = [];
                    for (const pt of linePts) {
                        vertices.push(pt.x, pt.y);
                    }
                }
                parsed.push({
                    id: (obj.id as number) ?? 0,
                    name: (obj.name as string) ?? '',
                    type: (obj.type as string) ?? (obj.class as string) ?? '',
                    visible: obj.visible !== false,
                    shape,
                    x: (obj.x as number) ?? 0,
                    y: (obj.y as number) ?? 0,
                    width: (obj.width as number) ?? 0,
                    height: (obj.height as number) ?? 0,
                    rotation: (obj.rotation as number) ?? 0,
                    vertices,
                    properties: props,
                    gid: typeof obj.gid === 'number' ? obj.gid : undefined,
                });
            }
            const groupProps = new Map<string, unknown>();
            const rawGroupProps = layer.properties as Array<Record<string, unknown>> | undefined;
            if (rawGroupProps) {
                for (const p of rawGroupProps) {
                    groupProps.set(p.name as string, p.value);
                }
            }
            objectGroups.push({
                name: (layer.name as string) ?? '',
                visible: layer.visible !== false,
                properties: groupProps,
                objects: parsed,
            });
        }
    }

    const tileAnimations = new Map<number, TiledAnimFrame[]>();
    const tileProperties = new Map<number, Map<string, string>>();
    const tileShapes = new Map<number, ResolvedTileCollision>();

    if (rawTilesets) {
        for (const ts of rawTilesets) {
            const firstGid = (ts.firstgid as number) ?? 1;
            const tsTw = (ts.tilewidth as number) || tileWidth || 1;
            const tsTh = (ts.tileheight as number) || tileHeight || 1;
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
                    let legacyCollision = false;
                    if (tileProps) {
                        const propMap = new Map<string, string>();
                        for (const p of tileProps) {
                            const name = p.name as string;
                            if (name === 'collision' && p.value === true) legacyCollision = true;
                            propMap.set(name, String(p.value));
                        }
                        if (propMap.size > 0) {
                            tileProperties.set(engineId, propMap);
                        }
                    }

                    // Tiled's tile collision editor (objectgroup) or the legacy
                    // `collision=true` property, folded into the SAME resolved model
                    // `.estileset` tiles use — plain solid boxes stay merge-eligible
                    // (collisionTileIds), everything richer spawns one collider each.
                    const og = tile.objectgroup as Record<string, unknown> | undefined;
                    const shape = tiledObjectgroupShape(
                        og?.objects as Array<Record<string, unknown>> | undefined, tsTw, tsTh)
                        ?? (legacyCollision ? { type: 'box' as const } : null);
                    if (shape) {
                        const rc: ResolvedTileCollision = { shape, ...tiledCollisionMods(tileProps) };
                        if (shape.type === 'box' && !rc.oneWay && !rc.sensor
                            && rc.density === undefined && rc.friction === undefined && rc.restitution === undefined) {
                            collisionTileIds.push(engineId);
                        } else {
                            tileShapes.set(engineId, rc);
                        }
                    }
                }
            }
        }
    }

    const orientation = (json.orientation as string) ?? 'orthogonal';
    const hexSideLength = (json.hexsidelength as number) ?? 0;
    const staggerAxis = (json.staggeraxis as string) ?? 'y';
    const staggerIndex = (json.staggerindex as string) ?? 'odd';

    return {
        width, height, tileWidth, tileHeight, orientation,
        hexSideLength, staggerAxis, staggerIndex,
        layers, tilesets, objectGroups, collisionTileIds, tileShapes,
        tileAnimations, tileProperties,
    };
}

/**
 * The first collision-editor object of a Tiled tile's `objectgroup`, as a
 * normalized {@link ResolvedTileCollision} shape (tile-fraction coordinates, the
 * same space `.estileset` collision resolves into). A full-cell rectangle folds
 * to `box` (merge-eligible); a partial rectangle becomes its 4-corner polygon;
 * an ellipse becomes the inscribed-average circle. Polylines/points are skipped.
 */
export function tiledObjectgroupShape(
    objects: Array<Record<string, unknown>> | undefined,
    tw: number,
    th: number,
): ResolvedTileCollision['shape'] | null {
    if (!objects) return null;
    for (const o of objects) {
        if (o.point === true || o.polyline) continue;
        const x = (o.x as number) ?? 0;
        const y = (o.y as number) ?? 0;
        const w = (o.width as number) ?? 0;
        const h = (o.height as number) ?? 0;
        if (o.ellipse === true) {
            if (w <= 0 || h <= 0) continue;
            return { type: 'circle', cx: (x + w / 2) / tw, cy: (y + h / 2) / th, r: (w + h) / 4 / tw };
        }
        const poly = o.polygon as Array<{ x: number; y: number }> | undefined;
        if (poly && poly.length >= 3) {
            return { type: 'polygon', points: poly.map((p) => [(x + p.x) / tw, (y + p.y) / th]) };
        }
        if (w > 0 && h > 0) {
            const eps = 0.5; // px — Tiled UI drags land on fractional coords
            if (Math.abs(x) <= eps && Math.abs(y) <= eps && Math.abs(w - tw) <= eps && Math.abs(h - th) <= eps) {
                return { type: 'box' };
            }
            return {
                type: 'polygon',
                points: [[x / tw, y / th], [(x + w) / tw, y / th], [(x + w) / tw, (y + h) / th], [x / tw, (y + h) / th]],
            };
        }
    }
    return null;
}

/**
 * Collision modifiers from a Tiled tile's typed properties — the same vocabulary
 * the `.estileset` modifier bar writes: `oneway` (bool, solid-top), `sensor`
 * (bool), `friction` / `restitution` / `density` (float).
 */
export function tiledCollisionMods(
    props: Array<Record<string, unknown>> | undefined,
): Partial<Pick<ResolvedTileCollision, 'oneWay' | 'sensor' | 'density' | 'friction' | 'restitution'>> {
    const out: Partial<Pick<ResolvedTileCollision, 'oneWay' | 'sensor' | 'density' | 'friction' | 'restitution'>> = {};
    if (!props) return out;
    for (const p of props) {
        const name = (p.name as string ?? '').toLowerCase();
        const v = p.value;
        if (name === 'oneway' && v === true) out.oneWay = { nx: 0, ny: 1 };
        else if (name === 'sensor' && v === true) out.sensor = true;
        else if ((name === 'friction' || name === 'restitution' || name === 'density') && typeof v === 'number') {
            out[name] = v;
        }
    }
    return out;
}

/**
 * Parse a .tmj whose tilesets may be EXTERNAL references (`{firstgid, source}`
 * pointing at a .tsj): fetch each source through `resolveExternal`, merge it
 * inline (a .tsj carries the same tileset fields, minus firstgid) with its
 * image path rewritten from tsj-relative to map-relative, then run the
 * standard parse. Maps with only inline tilesets never invoke the resolver.
 */
export async function parseTmjWithExternals(
    json: Record<string, unknown>,
    resolveExternal: (source: string) => Promise<string>,
): Promise<TiledMapData | null> {
    const rawTilesets = json.tilesets as Array<Record<string, unknown>> | undefined;
    if (rawTilesets?.some((ts) => typeof ts.source === 'string')) {
        const merged = await Promise.all(rawTilesets.map(async (ts) => {
            if (typeof ts.source !== 'string') return ts;
            let external = JSON.parse(await resolveExternal(ts.source)) as Record<string, unknown>;
            if (typeof external.image === 'string' && external.image) {
                external = { ...external, image: resolveTiledRef(ts.source, external.image) };
            }
            // Collection tilesets carry per-tile images — rewrite those too.
            if (Array.isArray(external.tiles)) {
                external = {
                    ...external,
                    tiles: (external.tiles as Array<Record<string, unknown>>).map((t) =>
                        typeof t?.image === 'string' && t.image
                            ? { ...t, image: resolveTiledRef(ts.source as string, t.image) }
                            : t),
                };
            }
            return { ...external, firstgid: ts.firstgid };
        }));
        json = { ...json, tilesets: merged };
    }
    return parseTmjJson(json);
}

// resolveRelativePath now lives in ./tiledPath (a dependency-free leaf) so the editor's
// asset-dependency scan / cook can share the exact resolution the runtime loads with,
// without pulling the loader's engine deps. Re-exported here for existing importers.
export { resolveRelativePath, resolveTiledRef, isLogicalAssetRef };

export interface CollectionGridTile {
    /** Local tile id — also the grid slot, so gid → cell stays the identity
     *  even when ids are sparse (deleted tiles leave transparent holes). */
    id: number;
    /** Top-first RGBA, exactly tileWidth × tileHeight. */
    pixels: Uint8Array;
}

/**
 * Fold an image-collection tileset's decoded tiles into ONE grid-atlas pixel
 * buffer (near-square, one slot per local id, transparent holes for sparse
 * ids). The result is indistinguishable from a hand-authored grid tileset, so
 * the renderer's uv math needs no collection special case. Pure — unit-tested
 * apart from the decode/upload plumbing.
 */
export function packCollectionGrid(
    tiles: CollectionGridTile[], tileWidth: number, tileHeight: number,
): { pixels: Uint8Array; columns: number; rows: number; width: number; height: number } {
    const slots = tiles.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    const columns = Math.max(1, Math.ceil(Math.sqrt(slots)));
    const rows = Math.max(1, Math.ceil(slots / columns));
    const width = columns * tileWidth;
    const height = rows * tileHeight;
    const pixels = new Uint8Array(width * height * 4);
    const rowBytes = tileWidth * 4;
    for (const t of tiles) {
        const cellX = (t.id % columns) * tileWidth;
        const cellY = Math.floor(t.id / columns) * tileHeight;
        for (let y = 0; y < tileHeight; y++) {
            pixels.set(
                t.pixels.subarray(y * rowBytes, (y + 1) * rowBytes),
                ((cellY + y) * width + cellX) * 4,
            );
        }
    }
    return { pixels, columns, rows, width, height };
}

export interface TilemapLoadOptions {
    generateObjectCollision?: boolean;
    collisionTileIds?: number[];
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * True when a Tiled object group is authored as collision geometry: a
 * `collision=true` group property (mirroring the tile-property convention) or
 * the group being named `collision` (case-insensitive).
 */
export function isCollisionObjectGroup(group: TiledObjectGroupData): boolean {
    return group.properties?.get('collision') === true
        || group.name.toLowerCase() === 'collision';
}

/**
 * @brief Spawn static colliders for Tiled OBJECT layers (rect / ellipse / polygon / polyline).
 *
 * Same world convention as the tile-collision generators: the map's top-left corner sits at
 * (originX, originY) and Tiled's y-down pixel coordinates descend from it
 * (`world = (originX + px, originY - py)`). Rotation is Tiled's clockwise degrees about the
 * object anchor (top-left for rects/ellipses, the vertex origin for polygons) — realized as
 * the equivalent negative z-rotation on the collider entity, positioned at the true shape
 * centre. Collider GEOMETRY is physics units (metres): pixel sizes divide by pixelsPerUnit,
 * matching `BoxCollider.halfExtents` semantics (positions stay pixels; physics scales those).
 *
 * Shapes: rect → BoxCollider; ellipse → CircleCollider on the mean semi-axis (exact for
 * circles); polygon ≤ 8 vertices → PolygonCollider (Box2D's vertex cap); polygon > 8 →
 * bounding-box BoxCollider with a warning (predictably solid, never silently truncated);
 * polyline → open ChainCollider (the physics layer requires ≥ 4 points); point → skipped
 * (spawn/marker data, queryable from the parsed map).
 */
/**
 * World transform of a Tiled object's shape centre at object-LOCAL offset (lx, ly).
 * Tiled rotates clockwise about the object anchor in y-down pixel space, realized as
 * a negative z-rotation with y flipped; `(ox, oy)` is the map origin (0 for the
 * parented/local path). The single source of the object position/rotation math for
 * both {@link generateObjectCollision} and {@link spawnObjectRegion}.
 */
function objectShapeTransform(
    obj: TiledObjectData, ox: number, oy: number, lx: number, ly: number,
): { position: { x: number; y: number; z: number }; rotation?: { w: number; x: number; y: number; z: number } } {
    const rad = obj.rotation * DEG_TO_RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const position = { x: ox + obj.x + lx * cos - ly * sin, y: oy - (obj.y + lx * sin + ly * cos), z: 0 };
    if (rad === 0) return { position };
    const half = -rad * 0.5;
    return { position, rotation: { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) } };
}

/**
 * The shape → collider decision shared by both Tiled object paths: rect → BoxCollider,
 * ellipse → CircleCollider on the mean semi-axis, polygon ≤ 8 verts → PolygonCollider
 * (> 8 → bounding-box Box, never silently truncated), polyline → open ChainCollider.
 * `spawn(lx, ly)` positions AND assembles the entity at the shape centre in the caller's
 * space — world-placed bare collider vs parented Marker region — so only the collider
 * geometry (metres = pixels ÷ ppu) lives here. Returns the entity, or null when the shape
 * yields no collider: too few vertices, or a sensor polyline (an open chain has no sensor
 * mode). Point / gid objects are pre-filtered by the caller.
 */
function attachObjectShape(
    world: World, obj: TiledObjectData, pixelsPerUnit: number, sensor: boolean, groupName: string,
    spawn: (lx: number, ly: number) => Entity,
): Entity | null {
    if (obj.shape === 'rect') {
        const e = spawn(obj.width * 0.5, obj.height * 0.5);
        world.insert(e, BoxCollider, {
            halfExtents: { x: obj.width * 0.5 / pixelsPerUnit, y: obj.height * 0.5 / pixelsPerUnit },
            isSensor: sensor,
        });
        return e;
    }
    if (obj.shape === 'ellipse') {
        const e = spawn(obj.width * 0.5, obj.height * 0.5);
        world.insert(e, CircleCollider, { radius: (obj.width + obj.height) * 0.25 / pixelsPerUnit, isSensor: sensor });
        return e;
    }
    if (!obj.vertices || obj.vertices.length < 4) return null;
    // Local vertices flip Tiled's y-down into the body's y-up space; the entity's
    // rotation carries the object angle. (binary subtraction: -v yields -0 for zeros)
    const local: { x: number; y: number }[] = [];
    for (let i = 0; i < obj.vertices.length; i += 2) {
        local.push({ x: obj.vertices[i] / pixelsPerUnit, y: (0 - obj.vertices[i + 1]) / pixelsPerUnit });
    }
    if (obj.shape === 'polyline') {
        if (sensor) return null;
        const e = spawn(0, 0);
        world.insert(e, ChainCollider, { points: local, isLoop: false });
        return e;
    }
    if (local.length < 3) return null; // a polygon needs at least a triangle
    if (local.length <= 8) {
        const e = spawn(0, 0);
        world.insert(e, PolygonCollider, { vertices: local, isSensor: sensor });
        return e;
    }
    log.warn('tilemap', `object polygon in group '${groupName}' has ${local.length} vertices (Box2D max 8); using its bounding box`);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < obj.vertices.length; i += 2) {
        const vx = obj.vertices[i], vy = obj.vertices[i + 1];
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
    }
    const e = spawn((minX + maxX) * 0.5, (minY + maxY) * 0.5);
    world.insert(e, BoxCollider, {
        halfExtents: { x: (maxX - minX) * 0.5 / pixelsPerUnit, y: (maxY - minY) * 0.5 / pixelsPerUnit },
        isSensor: sensor,
    });
    return e;
}

export function generateObjectCollision(
    world: World,
    groups: TiledObjectGroupData[],
    originX: number,
    originY: number,
    pixelsPerUnit: number = 1,
): Entity[] {
    const entities: Entity[] = [];
    for (const group of groups) {
        for (const obj of group.objects) {
            if (obj.shape === 'point') continue;
            const e = attachObjectShape(world, obj, pixelsPerUnit, false, group.name, (lx, ly) => {
                const entity = world.spawn();
                const { position, rotation } = objectShapeTransform(obj, originX, originY, lx, ly);
                world.insert(entity, Transform, rotation ? { position, rotation } : { position });
                world.insert(entity, RigidBody, { bodyType: BodyType.Static });
                return entity;
            });
            if (e) entities.push(e);
        }
    }
    return entities;
}

/** A Tiled object's custom properties as a plain string→string record (Marker.properties). */
function objectPropsRecord(obj: TiledObjectData): Record<string, string> {
    const props: Record<string, string> = {};
    for (const [k, v] of obj.properties) props[k] = String(v);
    return props;
}

/**
 * @brief Project ONE Tiled SHAPE object (rect / ellipse / polygon / polyline) into a real
 *        REGION entity — the same shape a hand-authored Trigger Area preset builds:
 *        Transform + Marker{type,properties} + static RigidBody + a collider matching the
 *        shape. `sensor` picks the flavour: a non-collision group's regions are SENSORS
 *        (trigger zones), a `collision` group's regions are SOLID geometry (walls/floors) —
 *        one derivation for both, so every shape object becomes a queryable, gizmo-visible
 *        entity instead of an invisible play-only collider or unqueried `objectGroups` data.
 *
 * LOCAL coords (the tilemap parent carries the origin), mirroring the tile-object sprites;
 * geometry is metres (÷ ppu) like {@link generateObjectCollision}. rect → Box, ellipse →
 * Circle, polygon ≤8 verts → Polygon (>8 → bounding-box Box), polyline → open Chain.
 * Point / gid objects project elsewhere (Marker / Sprite) → null.
 */
export function spawnObjectRegion(
    world: World,
    obj: TiledObjectData,
    parent: Entity,
    pixelsPerUnit: number,
    sensor: boolean,
): Entity | null {
    if (obj.gid !== undefined || obj.shape === 'point') return null;
    // Local shape centre (parent carries the tilemap origin) → origin 0 in the shared
    // transform; assemble the queryable, gizmo-visible region entity around each collider.
    return attachObjectShape(world, obj, pixelsPerUnit, sensor, obj.name || `object ${obj.id}`, (lx, ly) => {
        const e = world.spawn(obj.name || `Region_${obj.id}`);
        const { position, rotation } = objectShapeTransform(obj, 0, 0, lx, ly);
        world.insert(e, Transform, rotation ? { position, rotation } : { position });
        world.insert(e, Marker, { type: obj.type || '', properties: objectPropsRecord(obj) });
        world.insert(e, RigidBody, { bodyType: BodyType.Static });
        world.insert(e, RuntimeOnly, {});
        world.setParent(e, parent);
        return e;
    });
}

/**
 * @brief Spawn static colliders for EVERY object group of a parsed map (the code-driven
 *        `loadTiledMap` path; the scene path filters by {@link isCollisionObjectGroup}).
 *
 * NOTE: behaviour fixed to the shared convention — origin at the map's TOP-left with world-y
 * descending (was bottom-left/y-up, a full map-height off the tiles, the same latent bug the
 * tile path had fixed) and metre-unit collider geometry via `pixelsPerUnit` (was raw pixels).
 */
export function loadTiledCollisionObjects(
    world: World,
    mapData: TiledMapData,
    mapOriginX: number,
    mapOriginY: number,
    pixelsPerUnit: number = 1,
): Entity[] {
    return generateObjectCollision(world, mapData.objectGroups, mapOriginX, mapOriginY, pixelsPerUnit);
}

/**
 * @brief Greedy-merge a tile grid's collidable cells into static box colliders.
 *
 * Grid-agnostic core shared by the Tiled-import (`generateTileCollision`) and the runtime
 * asset (`TilemapSyncSystem`) paths. Row 0 (top of the grid) maps to the highest world-Y
 * and rows descend (y-down), matching the renderer; each merged rect becomes one static
 * `BoxCollider` body placed relative to (originX, originY) — the tilemap entity's origin.
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
    pixelsPerUnit: number = 1,
): Entity[] {
    const merged = mergeCollisionTiles(tiles, gridWidth, gridHeight, collisionIds);
    const entities: Entity[] = [];

    for (const rect of merged) {
        const mergedW = rect.width * tileW;
        const mergedH = rect.height * tileH;
        // y-DOWN, matching the renderer (`worldY = origin - row*tileH - hh`,
        // TilemapRenderPlugin.cpp) and generateChunkCollision — so colliders land
        // exactly on the visible tiles. (Was y-up/flipped, which put them a full
        // map-height off; never caught because no example ran tilemap physics in play.)
        const worldX = originX + rect.col * tileW + mergedW * 0.5;
        const worldY = originY - rect.row * tileH - mergedH * 0.5;

        const entity = world.spawn();
        world.insert(entity, Transform, {
            position: { x: worldX, y: worldY, z: 0 },
        });
        world.insert(entity, RigidBody, { bodyType: BodyType.Static });
        // Position is in pixels (physics scales it by pixelsPerUnit); halfExtents are
        // PHYSICS units (metres), so divide the pixel size — otherwise a tile collider
        // is pixelsPerUnit× too big (the default 100 → 100× oversized).
        world.insert(entity, BoxCollider, {
            halfExtents: { x: mergedW * 0.5 / pixelsPerUnit, y: mergedH * 0.5 / pixelsPerUnit },
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
        originX, originY,
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
    pixelsPerUnit: number = 1,
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
            // halfExtents in physics units (metres); divide the pixel size by ppu.
            world.insert(entity, BoxCollider, {
                halfExtents: { x: rect.width * tileW * 0.5 / pixelsPerUnit, y: rect.height * tileH * 0.5 / pixelsPerUnit },
            });
            entities.push(entity);
        }
    }
    return entities;
}

/**
 * Convert a tile's normalized polygon outline ([0,1], x right / y down) to entity-local
 * vertices (origin = cell center, y up), applying the cell's flip flags so the collider
 * matches the rendered tile. The flip is the inverse of the renderer's `applyTileFlip`
 * (texture→quad): undo V, then H, then the diagonal swap.
 */
export function polygonLocalVerts(
    norm: ReadonlyArray<readonly [number, number]>,
    tileW: number,
    tileH: number,
    flipH: boolean,
    flipV: boolean,
    flipD: boolean,
): { x: number; y: number }[] {
    return norm.map(([sx, syDown]) => {
        let s = sx;
        let t = 1 - syDown; // to texture-up normalized
        if (flipV) t = 1 - t;
        if (flipH) s = 1 - s;
        if (flipD) { const tmp = s; s = t; t = tmp; }
        return { x: (s - 0.5) * tileW, y: (t - 0.5) * tileH };
    });
}

/**
 * The pixel-space {@link ColliderShape} for a resolved tile collision, the cell's flip
 * flags applied (origin = cell center, y up). The SINGLE tile→geometry definition shared
 * by the runtime spawn ({@link generateChunkTileShapes}, which divides by ppu into a
 * collider component) and the editor's tile-collision overlay (which feeds it to
 * `colliderShapeOutline`). A box is flip-symmetric so its geometry ignores the flags; a
 * polygon and a circle's centre go through {@link polygonLocalVerts}, matching the render.
 */
export function tileColliderShape(
    rc: ResolvedTileCollision,
    tileW: number,
    tileH: number,
    flipH: boolean,
    flipV: boolean,
    flipD: boolean,
): ColliderShape {
    const s = rc.shape;
    if (s.type === 'polygon') {
        return { kind: 'polygon', vertices: polygonLocalVerts(s.points, tileW, tileH, flipH, flipV, flipD) };
    }
    if (s.type === 'circle') {
        // Reuse the polygon transform on the single centre point to apply flips; the
        // radius is a tile-width fraction (assumes square-ish cells).
        const c = polygonLocalVerts([[s.cx, s.cy]], tileW, tileH, flipH, flipV, flipD)[0];
        return { kind: 'circle', radius: s.r * tileW, offset: c };
    }
    return { kind: 'box', halfExtents: { x: tileW * 0.5, y: tileH * 0.5 }, offset: { x: 0, y: 0 } };
}

/**
 * Spawn one static PolygonCollider per placed tile whose global id has a polygon shape
 * (slopes / partial tiles). Box-shaped tiles are handled by {@link generateChunkCollision};
 * the two run together. Flip flags on a cell flip its polygon to match the render.
 */
export function generateChunkPolygonCollision(
    world: World,
    chunks: { x: number; y: number; tiles: Uint16Array }[],
    polygonShapes: Map<number, readonly [number, number][]>,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
    pixelsPerUnit: number = 1,
): Entity[] {
    const entities: Entity[] = [];
    if (polygonShapes.size === 0) return entities;
    for (const chunk of chunks) {
        const baseX = chunk.x * CHUNK_SIZE;
        const baseY = chunk.y * CHUNK_SIZE;
        for (let i = 0; i < chunk.tiles.length; i++) {
            const raw = chunk.tiles[i];
            const id = tileIdOf(raw);
            const shape = polygonShapes.get(id);
            if (!shape) continue;
            const gx = baseX + (i % CHUNK_SIZE);
            const gy = baseY + Math.floor(i / CHUNK_SIZE);
            const f = tileFlagsOf(raw);
            const entity = world.spawn();
            world.insert(entity, Transform, {
                position: { x: originX + (gx + 0.5) * tileW, y: originY - (gy + 0.5) * tileH, z: 0 },
            });
            world.insert(entity, RigidBody, { bodyType: BodyType.Static });
            // PolygonCollider vertices are physics units (uploaded unscaled, like
            // BoxCollider.halfExtents) — divide the pixel-space outline by ppu.
            world.insert(entity, PolygonCollider, {
                vertices: polygonLocalVerts(shape, tileW, tileH, f.flipH, f.flipV, f.flipD)
                    .map((v) => ({ x: v.x / pixelsPerUnit, y: v.y / pixelsPerUnit })),
            });
            entities.push(entity);
        }
    }
    return entities;
}

/** A one-way solid-side normal (world y-up; {0,1} = solid-top), reoriented by cell flips
 *  so a flipped platform's solid side follows the render. Shared with the editor overlay,
 *  so a flipped one-way tile's arrow matches the side a body actually lands on at Play. */
export function oneWayNormalWorld(nx: number, ny: number, fH: boolean, fV: boolean, fD: boolean): { x: number; y: number } {
    let x = nx;
    let y = ny;
    if (fH) x = -x;
    if (fV) y = -y;
    if (fD) { const tmp = x; x = y; y = tmp; }
    return { x, y };
}

/**
 * Spawn ONE static collider for a rich-shaped tile at grid cell (gx, gy) — the
 * per-cell core shared by the chunked (painted-layer) and finite (Tiled-layer)
 * drivers, so both asset paths produce byte-identical collision entities.
 */
function spawnTileShape(
    world: World,
    rc: ResolvedTileCollision,
    raw: number,
    gx: number,
    gy: number,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
    ppu: number,
): Entity {
    const f = tileFlagsOf(raw);
    const entity = world.spawn();
    world.insert(entity, Transform, {
        position: { x: originX + (gx + 0.5) * tileW, y: originY - (gy + 0.5) * tileH, z: 0 },
    });
    world.insert(entity, RigidBody, { bodyType: BodyType.Static });

    // Only the material/sensor fields the tile overrode; the rest keep component defaults.
    const mat: { density?: number; friction?: number; restitution?: number; isSensor?: boolean } = {};
    if (rc.density !== undefined) mat.density = rc.density;
    if (rc.friction !== undefined) mat.friction = rc.friction;
    if (rc.restitution !== undefined) mat.restitution = rc.restitution;
    if (rc.sensor) mat.isSensor = true;

    // One pixel-space shape definition (flip-applied), scaled to physics units
    // (÷ppu) into the matching collider component — the same geometry the editor
    // overlay draws, so what you see out of Play is what spawns.
    const shape = tileColliderShape(rc, tileW, tileH, f.flipH, f.flipV, f.flipD);
    if (shape.kind === 'polygon') {
        world.insert(entity, PolygonCollider, {
            vertices: shape.vertices.map((v) => ({ x: v.x / ppu, y: v.y / ppu })),
            ...mat,
        });
    } else if (shape.kind === 'circle') {
        world.insert(entity, CircleCollider, {
            radius: shape.radius / ppu,
            offset: { x: shape.offset.x / ppu, y: shape.offset.y / ppu },
            ...mat,
        });
    } else if (shape.kind === 'box') {
        world.insert(entity, BoxCollider, {
            halfExtents: { x: shape.halfExtents.x / ppu, y: shape.halfExtents.y / ppu },
            ...mat,
        });
    }

    if (rc.oneWay) {
        world.insert(entity, OneWayPlatform, {
            normal: oneWayNormalWorld(rc.oneWay.nx, rc.oneWay.ny, f.flipH, f.flipV, f.flipD),
        });
    }
    return entity;
}

/**
 * Spawn one static collider per placed tile whose global id resolves to a RICH shape —
 * polygon / circle, or a box carrying a one-way / sensor / material modifier — i.e. the
 * tiles the plain-box greedy merge ({@link generateChunkCollision}) deliberately skips.
 * Both run together over the same chunks. Flip flags reorient the shape (and the one-way
 * normal) to match the rendered tile. Geometry is in physics units (÷ pixelsPerUnit).
 */
export function generateChunkTileShapes(
    world: World,
    chunks: { x: number; y: number; tiles: Uint16Array }[],
    tileShapes: Map<number, ResolvedTileCollision>,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
    pixelsPerUnit: number = 1,
): Entity[] {
    const entities: Entity[] = [];
    if (tileShapes.size === 0) return entities;
    const ppu = pixelsPerUnit || 1;
    for (const chunk of chunks) {
        const baseX = chunk.x * CHUNK_SIZE;
        const baseY = chunk.y * CHUNK_SIZE;
        for (let i = 0; i < chunk.tiles.length; i++) {
            const raw = chunk.tiles[i];
            const rc = tileShapes.get(tileIdOf(raw));
            if (!rc) continue;
            const gx = baseX + (i % CHUNK_SIZE);
            const gy = baseY + Math.floor(i / CHUNK_SIZE);
            entities.push(spawnTileShape(world, rc, raw, gx, gy, tileW, tileH, originX, originY, ppu));
        }
    }
    return entities;
}

/**
 * Finite-layer sibling of {@link generateChunkTileShapes} — rich shapes for a flat
 * Tiled layer array. Runs alongside {@link generateLayerCollision} the same way
 * the chunk pair runs together on the painted path.
 */
export function generateLayerTileShapes(
    world: World,
    tiles: ArrayLike<number>,
    gridWidth: number,
    gridHeight: number,
    tileShapes: Map<number, ResolvedTileCollision>,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
    pixelsPerUnit: number = 1,
): Entity[] {
    const entities: Entity[] = [];
    if (tileShapes.size === 0) return entities;
    const ppu = pixelsPerUnit || 1;
    const count = Math.min(tiles.length, gridWidth * gridHeight);
    for (let i = 0; i < count; i++) {
        const raw = tiles[i];
        const rc = tileShapes.get(tileIdOf(raw));
        if (!rc) continue;
        entities.push(spawnTileShape(
            world, rc, raw, i % gridWidth, Math.floor(i / gridWidth),
            tileW, tileH, originX, originY, ppu,
        ));
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
            // Infinite layers are re-chunked to CHUNK_SIZE at parse — same generators
            // as the painted path.
            entities.push(...(layer.infinite
                ? generateChunkCollision(
                    world, layer.chunks, tileCollisionIds,
                    mapData.tileWidth, mapData.tileHeight, 0, 0)
                : generateTileCollision(world, layer, mapData, tileCollisionIds, 0, 0)));
        }
    }
    if (mapData.tileShapes && mapData.tileShapes.size > 0) {
        for (const layer of mapData.layers) {
            if (!layer.visible) continue;
            entities.push(...(layer.infinite
                ? generateChunkTileShapes(
                    world, layer.chunks, mapData.tileShapes,
                    mapData.tileWidth, mapData.tileHeight, 0, 0)
                : generateLayerTileShapes(
                    world, layer.tiles, layer.width, layer.height, mapData.tileShapes,
                    mapData.tileWidth, mapData.tileHeight, 0, 0)));
        }
    }

    return entities;
}
