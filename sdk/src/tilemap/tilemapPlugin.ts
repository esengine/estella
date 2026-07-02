// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import type { ESEngineModule } from '../wasm';
import { Transform, TilemapLayer, Canvas, type TilemapLayerData } from '../component';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import { initTilemapAPI, shutdownTilemapAPI, TilemapAPI } from './tilemapAPI';
import { Tilemap } from './components';
import { registerSceneComponentCodec } from '../scene';
import { getTilemapSource, getResolvedTileset } from './tilesetCache';
import { resolveTilesetModel } from './tilesetResolve';
import { generateLayerCollision, generateChunkCollision, generateChunkPolygonCollision } from './tiledLoader';
import { decodeTilemapChunks } from './chunkCodec';
import { Assets, type AssetsData } from '../asset/AssetPlugin';
import { Time } from '../resource';
import { playModeOnly } from '../env';
import { log } from '../logger';
import type { Entity } from '../types';

const SYNTHETIC_KEY_BASE = 0x40000000;
const MAX_LAYERS_PER_ENTITY = 256;

const GRID_TYPE_MAP: Record<string, number> = {
    orthogonal: 0,
    isometric: 1,
    staggered: 2,
};

/** A `.estileset` ref → the resolved-tileset cache key (its project path). A `@uuid:`
 *  ref needs the Assets registry; an already-resolved path is used as-is. */
function resolveTilesetPath(assets: AssetsData | undefined, ref: string): string | null {
    if (ref.startsWith('@uuid:')) return assets ? assets.resolveRef(ref) : null;
    return ref;
}

export class TilemapPlugin implements Plugin {
    name = 'tilemap';

    private initializedLayers_ = new Set<number>();
    private animatedLayers_ = new Set<number>();
    private sourceEntityKeys_ = new Map<number, number[]>();
    /** tilemap entity → the static collider entities derived from its collidable tiles (play-mode only). */
    private collisionEntities_ = new Map<number, Entity[]>();
    /** TilemapLayer entity → its baked collidable tile ids (out-of-band scene data; drives native collision). */
    private nativeCollisionIds_ = new Map<number, number[]>();
    /** TilemapLayer entity → per-tile polygon collision outlines (global id → normalized points). */
    private nativePolygonShapes_ = new Map<number, Map<number, [number, number][]>>();
    /** TilemapLayer entity → its `.estileset` ref (out-of-band; resolved live → table/collision/anim). */
    private tilesetRefs_ = new Map<number, string>();
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
                const ref = tilesetRefs.get(entity);
                if (ref) data.tilesetAsset = ref;
            },
            outOfBandFields: ['chunks', 'collidableTileIds', 'tilesetAsset'],
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
                // The `.estileset` reference: resolved live in the sync (table + collision
                // + animations) instead of trusting the baked collidableTileIds snapshot.
                const ref = outOfBand.tilesetAsset;
                if (typeof ref === 'string' && ref !== '') {
                    tilesetRefs.set(entity, ref);
                } else {
                    tilesetRefs.delete(entity);
                }
                liveResolved.delete(entity);
            },
        });

        const world = app.world;
        const initializedLayers = this.initializedLayers_;
        const animatedLayers = this.animatedLayers_;
        const sourceEntityKeys = this.sourceEntityKeys_;
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
                    if (entity >= SYNTHETIC_KEY_BASE) continue;
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

                    const tilesetRef = tilesetRefs.get(entity);
                    // A layer needs either a copied texture (legacy) or a .estileset ref.
                    if (!layerData.tileset && !tilesetRef) continue;

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

                    // Live tileset: when the layer references a `.estileset` that has loaded,
                    // derive its render table + animations + collision LIVE (once per load) —
                    // replacing the copied columns and the baked collidableTileIds snapshot.
                    if (tilesetRef && !liveResolved.has(entity)) {
                        const path = resolveTilesetPath(assets, tilesetRef);
                        const resolved = path ? getResolvedTileset(path) : undefined;
                        if (resolved) {
                            const model = resolveTilesetModel([resolved]);
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
                        } else if (path && assets && !requestedTilesetLoads.has(path)) {
                            // The `.estileset` is referenced but not loaded. It's an
                            // out-of-band ref (invisible to scene asset discovery), so
                            // nothing preloads it — kick the load off here. Once it lands
                            // getResolvedTileset() hits next frame and we resolve live.
                            requestedTilesetLoads.add(path);
                            assets.load('tileset', path).catch((e) => {
                                log.warn('tilemap', `failed to load tileset asset '${path}'`, e);
                            });
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
                                layerData.cellSize.x, layerData.cellSize.y, ox, oy,
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

                    // `source` may be a `@uuid:` ref (how the editor serializes asset
                    // fields) or a plain path. The loader keys the source cache by the
                    // RESOLVED path (Assets.resolveRef → path), and `resolveSceneAssetPaths`
                    // does NOT rewrite tilemap fields, so resolve here too or a `@uuid:`
                    // scene would never find its cached source.
                    const sourcePath = resolveTilesetPath(assets, tilemap.source);
                    const cached = sourcePath ? getTilemapSource(sourcePath) : undefined;
                    if (!cached) continue;

                    if (!sourceEntityKeys.has(entity)) {
                        const keys: number[] = [];
                        const gridType = GRID_TYPE_MAP[cached.orientation ?? 'orthogonal'] ?? 0;

                        for (let i = 0; i < cached.layers.length; i++) {
                            const key = SYNTHETIC_KEY_BASE + entity * MAX_LAYERS_PER_ENTITY + i;
                            const layer = cached.layers[i];
                            if (layer.infinite) {
                                TilemapAPI.initInfiniteLayer(
                                    key, cached.tileWidth, cached.tileHeight,
                                );
                                for (const chunk of layer.chunks) {
                                    TilemapAPI.setChunkTiles(
                                        key, chunk.x, chunk.y,
                                        chunk.tiles, chunk.width, chunk.height,
                                    );
                                }
                            } else {
                                TilemapAPI.initLayer(
                                    key, layer.width, layer.height,
                                    cached.tileWidth, cached.tileHeight,
                                );
                                if (layer.tiles.length > 0) {
                                    TilemapAPI.setTiles(key, layer.tiles);
                                }
                            }
                            TilemapAPI.setOriginEntity(key, entity);
                            if (gridType !== 0) {
                                TilemapAPI.setGridType(key, gridType);
                            }

                            if (cached.tileAnimations) {
                                for (const [tileId, frames] of cached.tileAnimations) {
                                    TilemapAPI.setTileAnimation(key, tileId, frames);
                                }
                                if (cached.tileAnimations.size > 0) {
                                    animatedLayers.add(key);
                                }
                            }

                            if (cached.tileProperties) {
                                for (const [tileId, props] of cached.tileProperties) {
                                    for (const [k, v] of props) {
                                        TilemapAPI.setTileProperty(key, tileId, k, v);
                                    }
                                }
                            }

                            // Multi-tileset: push the full tileset table (firstId +
                            // texture + columns). The renderer batches per texture and
                            // derives UVs from texture size; setRenderProps still carries
                            // the non-tileset metadata (render layer, parallax).
                            const slots = cached.tilesets
                                .filter(t => t.textureHandle)
                                .map(t => ({ firstId: t.firstId, textureHandle: t.textureHandle, columns: t.columns }));
                            if (slots.length > 0) {
                                TilemapAPI.setTilesets(key, slots);
                                TilemapAPI.setRenderProps(
                                    key, slots[0].textureHandle, slots[0].columns,
                                    0, 0, i, 0, 1, 1,
                                );
                                TilemapAPI.setTint(key, 1, 1, 1, 1, 1);
                                TilemapAPI.setVisible(key, true);
                            }

                            keys.push(key);
                            initializedLayers.add(key);
                        }
                        sourceEntityKeys.set(entity, keys);
                    }

                    if (
                        playMode
                        && !collisionEntities.has(entity)
                        && cached.collisionTileIds && cached.collisionTileIds.length > 0
                    ) {
                        const ids = new Set(cached.collisionTileIds);
                        const tf = world.tryGet(entity, Transform) as
                            { position: { x: number; y: number } } | null;
                        const ox = tf?.position.x ?? 0;
                        const oy = tf?.position.y ?? 0;
                        const spawned: Entity[] = [];
                        for (const layer of cached.layers) {
                            // Collision covers finite layers (flat tile arrays);
                            // infinite/chunk collision is deferred.
                            if (layer.infinite || layer.tiles.length === 0) continue;
                            spawned.push(...generateLayerCollision(
                                world, layer.tiles, layer.width, layer.height,
                                cached.tileWidth, cached.tileHeight, ids, ox, oy, pixelsPerUnit,
                            ));
                        }
                        collisionEntities.set(entity, spawned);
                    }
                }

                const currentTilemapSet = new Set(tilemapEntities);
                for (const [entity, keys] of sourceEntityKeys) {
                    if (!currentTilemapSet.has(entity)) {
                        for (const key of keys) {
                            TilemapAPI.destroyLayer(key);
                            initializedLayers.delete(key);
                            animatedLayers.delete(key);
                        }
                        sourceEntityKeys.delete(entity);

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
        this.sourceEntityKeys_.clear();
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
