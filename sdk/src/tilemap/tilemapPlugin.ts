// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import type { ESEngineModule } from '../wasm';
import { Transform, TilemapLayer, Sprite, Canvas, RuntimeOnly, type TilemapLayerData } from '../component';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import { initTilemapAPI, shutdownTilemapAPI, TilemapAPI } from './tilemapAPI';
import { Tilemap } from './components';
import { registerSceneComponentCodec } from '../scene';
import { getTilemapSource, getResolvedTileset } from './tilesetCache';
import { resolveTilesetModel } from './tilesetResolve';
import {
    generateLayerCollision, generateChunkCollision, generateChunkPolygonCollision,
    generateObjectCollision, isCollisionObjectGroup, decodeTiledGid,
} from './tiledLoader';
import { decodeTilemapChunks } from './chunkCodec';
import { Assets } from '../asset/AssetPlugin';
import { resolveAssetKey } from '../asset/resolveAssetKey';
import { Time } from '../resource';
import { playModeOnly } from '../env';
import { log } from '../logger';
import type { Entity } from '../types';

const GRID_TYPE_MAP: Record<string, number> = {
    orthogonal: 0,
    isometric: 1,
    staggered: 2,
    hexagonal: 3,
};
const GRID_HEXAGONAL = 3;

export class TilemapPlugin implements Plugin {
    name = 'tilemap';

    private initializedLayers_ = new Set<number>();
    private animatedLayers_ = new Set<number>();
    /** Tilemap(source) entity → the RuntimeOnly child layer entities derived from its `.tmj`. */
    private sourceLayerEntities_ = new Map<number, Entity[]>();
    /** tilemap entity → the static collider entities derived from its collidable tiles (play-mode only). */
    private collisionEntities_ = new Map<number, Entity[]>();
    /** TilemapLayer entity → its baked collidable tile ids (out-of-band scene data; drives native collision). */
    private nativeCollisionIds_ = new Map<number, number[]>();
    /** TilemapLayer entity → per-tile polygon collision outlines (global id → normalized points). */
    private nativePolygonShapes_ = new Map<number, Map<number, [number, number][]>>();
    /** TilemapLayer entity → its `.estileset` refs, in firstId order (out-of-band; the
     *  whole list resolves live → multi-slot table/collision/anim). One entry = the
     *  common single-tileset layer. */
    private tilesetRefs_ = new Map<number, string[]>();
    /** Entities whose `.estileset` has been resolved+applied (so we do it once per load). */
    private liveResolved_ = new Set<number>();
    /** Resolved `.estileset` paths a load has already been kicked off for (de-dupes the lazy load). */
    private requestedTilesetLoads_ = new Set<string>();

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        initTilemapAPI(module);

        // Tile chunks live in a C++ blob, not the component's field record, so
        // teach the scene (de)serializer to carry them out-of-band instead of
        // hardcoding TilemapLayer knowledge in scene.ts.
        const nativeCollisionIds = this.nativeCollisionIds_;
        const nativePolygonShapes = this.nativePolygonShapes_;
        const tilesetRefs = this.tilesetRefs_;
        const liveResolved = this.liveResolved_;
        const requestedTilesetLoads = this.requestedTilesetLoads_;
        registerSceneComponentCodec('TilemapLayer', {
            exportData: (entity, data) => {
                const blob = TilemapAPI.exportChunks(entity);
                if (blob) data.chunks = blob;
                // Carry the baked collidable tile-id set out-of-band (like chunks) so the
                // runtime can derive collision; it isn't a C++ component field.
                const ids = nativeCollisionIds.get(entity);
                if (ids && ids.length > 0) data.collidableTileIds = ids.slice();
                const refs = tilesetRefs.get(entity);
                if (refs && refs.length > 0) {
                    data.tilesetAssets = refs.slice();
                    // Back-compat: keep the singular field (first tileset) so an older
                    // runtime still renders the primary tileset.
                    data.tilesetAsset = refs[0];
                }
            },
            outOfBandFields: ['chunks', 'collidableTileIds', 'tilesetAsset', 'tilesetAssets'],
            importData: (entity, outOfBand) => {
                const blob = outOfBand.chunks;
                if (typeof blob === 'string' && blob !== '') {
                    TilemapAPI.importChunks(entity, blob);
                }
                const ids = outOfBand.collidableTileIds;
                if (Array.isArray(ids) && ids.length > 0) {
                    nativeCollisionIds.set(entity, ids.map(Number).filter((n) => Number.isInteger(n)));
                } else {
                    nativeCollisionIds.delete(entity);
                }
                // The `.estileset` reference(s): resolved live in the sync (multi-slot
                // table + collision + animations). Accept the new `tilesetAssets` list;
                // fall back to the singular `tilesetAsset` (old scenes).
                const list = outOfBand.tilesetAssets;
                const single = outOfBand.tilesetAsset;
                let refs: string[] | undefined;
                if (Array.isArray(list)) {
                    refs = list.filter((r): r is string => typeof r === 'string' && r !== '');
                } else if (typeof single === 'string' && single !== '') {
                    refs = [single];
                }
                if (refs && refs.length > 0) {
                    tilesetRefs.set(entity, refs);
                } else {
                    tilesetRefs.delete(entity);
                }
                liveResolved.delete(entity);
            },
        });

        const world = app.world;
        const initializedLayers = this.initializedLayers_;
        const animatedLayers = this.animatedLayers_;
        const sourceLayerEntities = this.sourceLayerEntities_;
        const collisionEntities = this.collisionEntities_;

        const tilemapSyncSystem: SystemDef = {
            _id: Symbol('TilemapSyncSystem'),
            _name: 'TilemapSyncSystem',
            _params: [],
            _fn: () => {
                // Tile colliders are runtime-only artifacts (never in the edit world,
                // never serialized): generate them in play mode, drop them on stop so the
                // next Play regenerates from the current tiles.
                const playMode = playModeOnly();
                const assets = app.getResource(Assets);
                // Physics half-extents are metres; tile sizes are pixels. Divide by the
                // scene's pixelsPerUnit (Canvas, default 100) when spawning tile colliders.
                let pixelsPerUnit = 100;
                for (const ce of world.getEntitiesWithComponents([Canvas])) {
                    const c = world.tryGet(ce, Canvas) as { pixelsPerUnit?: number } | null;
                    if (c?.pixelsPerUnit) { pixelsPerUnit = c.pixelsPerUnit; break; }
                }
                if (!playMode && collisionEntities.size > 0) {
                    for (const [, ents] of collisionEntities) {
                        for (const e of ents) world.despawn(e);
                    }
                    collisionEntities.clear();
                }

                const layerEntities = world.getEntitiesWithComponents(
                    [TilemapLayer, Transform],
                );

                const currentLayerSet = new Set(layerEntities);
                for (const entity of initializedLayers) {
                    if (!currentLayerSet.has(entity)) {
                        TilemapAPI.destroyLayer(entity);
                        initializedLayers.delete(entity);
                        nativeCollisionIds.delete(entity);
                        nativePolygonShapes.delete(entity);
                        tilesetRefs.delete(entity);
                        liveResolved.delete(entity);
                        const colliders = collisionEntities.get(entity);
                        if (colliders) {
                            for (const e of colliders) world.despawn(e);
                            collisionEntities.delete(entity);
                        }
                    }
                }

                for (const entity of layerEntities) {
                    const layerData = world.tryGet(entity, TilemapLayer) as TilemapLayerData | null;
                    if (!layerData) continue;

                    const refs = tilesetRefs.get(entity);
                    // A layer needs either a copied texture (legacy) or .estileset ref(s).
                    if (!layerData.tileset && (!refs || refs.length === 0)) continue;

                    // RC2a: the TilemapLayer component is the single source of visual
                    // metadata; the C++ renderer reads tint/opacity/tileset/columns/
                    // renderLayer/parallax/visible straight off the component each frame.
                    // No per-frame push into LayerData anymore — we only init the layer's
                    // chunk store (the heavy data) and let the renderer pull the rest.
                    if (!initializedLayers.has(entity)) {
                        TilemapAPI.initInfiniteLayer(
                            entity, layerData.cellSize.x, layerData.cellSize.y,
                        );
                        TilemapAPI.setOriginEntity(entity, entity);
                        initializedLayers.add(entity);
                    }

                    // Live tileset(s): when ALL the layer's `.estileset` refs have loaded,
                    // derive its multi-slot render table + animations + collision LIVE (once
                    // per load) — replacing copied columns + the baked collidableTileIds. The
                    // whole list must resolve together so firstId ranges are contiguous.
                    if (refs && refs.length > 0 && !liveResolved.has(entity)) {
                        const resolvedList = [];
                        for (const ref of refs) {
                            const key = resolveAssetKey(assets, ref);
                            const r = getResolvedTileset(key) ?? getResolvedTileset(ref);
                            if (r) {
                                resolvedList.push(r);
                            } else if (assets && !requestedTilesetLoads.has(key)) {
                                // Out-of-band ref (invisible to scene asset discovery) — kick
                                // the load; once it lands we resolve live next frame.
                                requestedTilesetLoads.add(key);
                                assets.load('tileset', ref).catch((e) => {
                                    log.warn('tilemap', `failed to load tileset asset '${ref}'`, e);
                                });
                            }
                        }
                        if (resolvedList.length === refs.length) {
                            const model = resolveTilesetModel(resolvedList);
                            TilemapAPI.setTilesets(entity, model.slots);
                            for (const [tileId, frames] of model.animations) {
                                TilemapAPI.setTileAnimation(entity, tileId, frames);
                                animatedLayers.add(entity);
                            }
                            if (model.collidableTileIds.length > 0) {
                                nativeCollisionIds.set(entity, model.collidableTileIds);
                            }
                            if (model.polygonShapes.size > 0) {
                                nativePolygonShapes.set(entity, model.polygonShapes);
                            }
                            liveResolved.add(entity);
                        }
                    }

                    // Native path: collidable tiles spawn static colliders once in play mode
                    // — box tiles greedy-merged, polygon tiles one collider each — using the
                    // live `.estileset` shapes when resolved, else the baked id set.
                    const collIds = nativeCollisionIds.get(entity);
                    const polyShapes = nativePolygonShapes.get(entity);
                    const hasBox = collIds != null && collIds.length > 0;
                    const hasPoly = polyShapes != null && polyShapes.size > 0;
                    if (playMode && (hasBox || hasPoly) && !collisionEntities.has(entity)) {
                        const chunks = decodeTilemapChunks(TilemapAPI.exportChunks(entity));
                        const tf = world.tryGet(entity, Transform) as { position: { x: number; y: number } } | null;
                        const ox = tf?.position.x ?? 0;
                        const oy = tf?.position.y ?? 0;
                        const spawned: Entity[] = [];
                        if (hasBox) {
                            spawned.push(...generateChunkCollision(
                                world, chunks, new Set(collIds),
                                layerData.cellSize.x, layerData.cellSize.y, ox, oy, pixelsPerUnit,
                            ));
                        }
                        if (hasPoly) {
                            spawned.push(...generateChunkPolygonCollision(
                                world, chunks, polyShapes,
                                layerData.cellSize.x, layerData.cellSize.y, ox, oy, pixelsPerUnit,
                            ));
                        }
                        collisionEntities.set(entity, spawned);
                    }
                }

                const tilemapEntities = world.getEntitiesWithComponents(
                    [Tilemap, Transform],
                );
                for (const entity of tilemapEntities) {
                    if (world.tryGet(entity, TilemapLayer)) continue;

                    const tilemap = world.tryGet(entity, Tilemap) as { source: string } | null;
                    if (!tilemap?.source) continue;

                    // The loader keys the source cache by the RESOLVED path and
                    // `resolveSceneAssetPaths` leaves `source` as the authored ref, so
                    // resolve at lookup (see resolveAssetKey), falling back to the raw ref.
                    const cached = getTilemapSource(resolveAssetKey(assets, tilemap.source)) ?? getTilemapSource(tilemap.source);
                    if (!cached) continue;

                    if (!sourceLayerEntities.has(entity)) {
                        const children: Entity[] = [];
                        const gridType = GRID_TYPE_MAP[cached.orientation ?? 'orthogonal'] ?? 0;

                        for (let i = 0; i < cached.layers.length; i++) {
                            const layer = cached.layers[i];
                            // Each Tiled layer is a REAL child entity carrying a
                            // TilemapLayer component, so the renderer reads its
                            // metadata exactly like a painted layer's — one metadata
                            // model, no synthetic-key shadow layers. The children are
                            // world-only projections of the .tmj, re-derived from the
                            // source on every load and never serialized (RuntimeOnly).
                            const child = world.spawn(layer.name || `TiledLayer_${i}`);
                            world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
                            world.insert(child, TilemapLayer, {
                                cellSize: { x: cached.tileWidth, y: cached.tileHeight },
                                renderLayer: i,
                            });
                            world.insert(child, RuntimeOnly, {});
                            world.setParent(child, entity);

                            if (layer.infinite) {
                                TilemapAPI.initInfiniteLayer(
                                    child, cached.tileWidth, cached.tileHeight,
                                );
                                for (const chunk of layer.chunks) {
                                    TilemapAPI.setChunkTiles(
                                        child, chunk.x, chunk.y,
                                        chunk.tiles, chunk.width, chunk.height,
                                    );
                                }
                            } else {
                                TilemapAPI.initLayer(
                                    child, layer.width, layer.height,
                                    cached.tileWidth, cached.tileHeight,
                                );
                                if (layer.tiles.length > 0) {
                                    TilemapAPI.setTiles(child, layer.tiles);
                                }
                            }
                            TilemapAPI.setOriginEntity(child, child);
                            if (gridType !== 0) {
                                TilemapAPI.setGridType(child, gridType);
                            }
                            if (gridType === GRID_HEXAGONAL) {
                                TilemapAPI.setHexParams(
                                    child, cached.hexSideLength ?? 0,
                                    cached.staggerAxis === 'x', cached.staggerIndex === 'even',
                                );
                            }

                            if (cached.tileAnimations) {
                                for (const [tileId, frames] of cached.tileAnimations) {
                                    TilemapAPI.setTileAnimation(child, tileId, frames);
                                }
                                if (cached.tileAnimations.size > 0) {
                                    animatedLayers.add(child);
                                }
                            }

                            if (cached.tileProperties) {
                                for (const [tileId, props] of cached.tileProperties) {
                                    for (const [k, v] of props) {
                                        TilemapAPI.setTileProperty(child, tileId, k, v);
                                    }
                                }
                            }

                            // Multi-tileset: push the full tileset table (firstId +
                            // texture + columns). The renderer batches per texture and
                            // derives UVs from texture size; the remaining visual
                            // metadata (tint/opacity/renderLayer/...) is read off the
                            // child's TilemapLayer component like any painted layer.
                            const slots = cached.tilesets
                                .filter(t => t.textureHandle)
                                .map(t => ({ firstId: t.firstId, textureHandle: t.textureHandle, columns: t.columns }));
                            if (slots.length > 0) {
                                TilemapAPI.setTilesets(child, slots);
                            }

                            children.push(child);
                            initializedLayers.add(child);
                        }

                        // Tile (GID) objects — a positioned tile rendered as a Sprite,
                        // in edit + play mode like the tile layers. Parented to the
                        // tilemap entity, so the sprite's local position is the object's
                        // offset within the map (pixels). H/V flip → flipX/flipY;
                        // diagonal flip + rotation are follow-ups.
                        for (const group of cached.objectGroups ?? []) {
                            if (group.visible === false) continue;
                            for (const obj of group.objects) {
                                if (obj.gid === undefined || obj.visible === false) continue;
                                const dec = decodeTiledGid(obj.gid);
                                // Resolve the tileset by global id (largest firstId <= id).
                                let ts: (typeof cached.tilesets)[number] | undefined;
                                for (const cand of cached.tilesets) {
                                    if (cand.textureHandle && cand.firstId <= dec.globalId &&
                                        (!ts || cand.firstId > ts.firstId)) ts = cand;
                                }
                                if (!ts) continue;
                                const localId = dec.globalId - ts.firstId;
                                const cols = ts.columns || 1;
                                const rows = ts.rows || 1;
                                const uvW = 1 / cols, uvH = 1 / rows;
                                const col = localId % cols;
                                const row = Math.floor(localId / cols);
                                const w = obj.width || cached.tileWidth;
                                const h = obj.height || cached.tileHeight;
                                // Tiled tile-objects anchor BOTTOM-LEFT, y-down, and rotate
                                // CW about that anchor. Rotate the centre offset (w/2,-h/2)
                                // about the anchor and set the sprite's rotation to match
                                // (mirrors generateObjectCollision); world Y is up.
                                const rad = (obj.rotation || 0) * (Math.PI / 180);
                                const rc = Math.cos(rad), rs = Math.sin(rad);
                                const px = obj.x + (w / 2) * rc - (-h / 2) * rs;
                                const py = -(obj.y + (w / 2) * rs + (-h / 2) * rc);
                                const tileChild = world.spawn(obj.name || `TileObject_${obj.id}`);
                                world.insert(tileChild, Transform, rad !== 0
                                    ? { position: { x: px, y: py, z: 0 }, rotation: { w: Math.cos(-rad / 2), x: 0, y: 0, z: Math.sin(-rad / 2) } }
                                    : { position: { x: px, y: py, z: 0 } });
                                world.insert(tileChild, Sprite, {
                                    texture: ts.textureHandle,
                                    size: { x: w, y: h },
                                    uvOffset: { x: col * uvW, y: 1 - (row + 1) * uvH },
                                    uvScale: { x: uvW, y: uvH },
                                    flipX: dec.flipH,
                                    flipY: dec.flipV,
                                    layer: cached.layers.length,
                                });
                                world.insert(tileChild, RuntimeOnly, {});
                                world.setParent(tileChild, entity);
                                children.push(tileChild);
                            }
                        }
                        sourceLayerEntities.set(entity, children);
                    }

                    const hasTileCollision = !!(cached.collisionTileIds && cached.collisionTileIds.length > 0);
                    const collisionGroups = cached.objectGroups
                        ? cached.objectGroups.filter(isCollisionObjectGroup)
                        : [];
                    if (
                        playMode
                        && !collisionEntities.has(entity)
                        && (hasTileCollision || collisionGroups.length > 0)
                    ) {
                        const tf = world.tryGet(entity, Transform) as
                            { position: { x: number; y: number } } | null;
                        const ox = tf?.position.x ?? 0;
                        const oy = tf?.position.y ?? 0;
                        const spawned: Entity[] = [];
                        if (hasTileCollision) {
                            const ids = new Set(cached.collisionTileIds);
                            for (const layer of cached.layers) {
                                // Collision covers finite layers (flat tile arrays);
                                // infinite/chunk collision is deferred.
                                if (layer.infinite || layer.tiles.length === 0) continue;
                                spawned.push(...generateLayerCollision(
                                    world, layer.tiles, layer.width, layer.height,
                                    cached.tileWidth, cached.tileHeight, ids, ox, oy, pixelsPerUnit,
                                ));
                            }
                        }
                        // Tiled OBJECT layers marked as collision spawn static colliders
                        // alongside the tile-derived ones — same origin, same play-mode
                        // lifecycle (dropped on stop, regenerated next Play).
                        if (collisionGroups.length > 0) {
                            spawned.push(...generateObjectCollision(
                                world, collisionGroups, ox, oy, pixelsPerUnit,
                            ));
                        }
                        collisionEntities.set(entity, spawned);
                    }
                }

                const currentTilemapSet = new Set(tilemapEntities);
                for (const [entity, children] of sourceLayerEntities) {
                    if (!currentTilemapSet.has(entity)) {
                        for (const child of children) {
                            if (initializedLayers.has(child)) {
                                TilemapAPI.destroyLayer(child);
                                initializedLayers.delete(child);
                            }
                            animatedLayers.delete(child);
                            // An owner despawn cascades to its children; only a
                            // component removal leaves them alive to clean up here.
                            if (world.valid(child)) world.despawn(child);
                        }
                        sourceLayerEntities.delete(entity);

                        const colliders = collisionEntities.get(entity);
                        if (colliders) {
                            for (const e of colliders) world.despawn(e);
                            collisionEntities.delete(entity);
                        }
                    }
                }

                if (animatedLayers.size > 0) {
                    const dtMs = app.getResource(Time).delta * 1000;
                    for (const key of animatedLayers) {
                        TilemapAPI.advanceAnimations(key, dtMs);
                    }
                }
            },
        };

        app.addSystemToSchedule(Schedule.PreUpdate, tilemapSyncSystem);
    }

    resetLayers(): void {
        for (const entity of this.initializedLayers_) {
            TilemapAPI.destroyLayer(entity);
        }
        this.initializedLayers_.clear();
        this.animatedLayers_.clear();
        this.sourceLayerEntities_.clear();
        // Collider entities die with the world on reset/teardown; just drop our bookkeeping.
        this.collisionEntities_.clear();
        this.nativeCollisionIds_.clear();
        this.nativePolygonShapes_.clear();
        this.tilesetRefs_.clear();
        this.liveResolved_.clear();
        this.requestedTilesetLoads_.clear();
    }

    cleanup(): void {
        this.resetLayers();
        shutdownTilemapAPI();
    }
}

export const tilemapPlugin = new TilemapPlugin();
