// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { engineApi, worldEngineApi } from '../ecs/bridge/engineApi';
import { Transform, TilemapLayer, Sprite, Canvas, RuntimeOnly, Marker, type TilemapLayerData } from '../ecs/component';
import { Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import type { SystemDef } from '../ecs/system';
import { initTilemapAPI, shutdownTilemapAPI, createTilemapAPI, Tilemaps } from './tilemapAPI';
import { Tilemap } from './components';
import { registerWorldSceneComponentCodec } from '../scene/scene';
import { tilemapSource, resolvedTileset, type LoadedTilemapSource } from './tilesetCache';
import { resolveTilesetModel } from './tilesetResolve';
import { isCollisionPaletteRef, buildCollisionPaletteModel, parseCollisionMaterial } from './collisionPalette';
import { _bindTileCollisionLookup, type LayerCollisionTable } from './tileQuery';
import type { ResolvedTileCollision } from './tilesetResolve';
import {
    generateChunkCollision, generateChunkTileShapes,
    spawnObjectRegion, isCollisionObjectGroup, decodeTiledGid, tiledLayerComponent, tiledGridLayout,
} from './tiledLoader';
import { decodeTilemapChunks, type DecodedChunk } from './chunkCodec';
import { readCollisionChunks, type CollisionChunkSnapshot } from './nativeCollisionChunks';
import { Assets, type AssetsData } from '../asset/AssetPlugin';
import { resolveAssetKey } from '../asset/resolveAssetKey';
import { LazyTilesetLoads } from './lazyTilesetLoads';
import { Time } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { log } from '../util/logger';
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { usesStagger } from './tileGeometry';


interface CollisionInputs {
    gridKey: string;
    originX: number;
    originY: number;
    generation: number | undefined;
    revision: number | undefined;
    native: Map<string, CollisionChunkSnapshot> | null;
    width: number;
    height: number;
    pixelsPerUnit: number;
    ids: number[] | undefined;
    shapes: Map<number, ResolvedTileCollision> | undefined;
}

/**
 * One app's tilemap runtime: every derived layer, collider, animation and
 * resolved tileset it is holding.
 *
 * All of it is entity-keyed, so it belongs to one World. Two apps count their
 * entities from 1, and a shared instance cannot tell them apart.
 */
export class TilemapRuntime {
    private toolkit_: ReturnType<typeof createTilemapAPI> | null = null;
    private unregisterCodec_: (() => void) | null = null;
    private collisionInputs_ = new Map<number, CollisionInputs>();
    private applyTilesetRefs_: ((entity: number, refs: readonly string[]) => void) | null = null;
    private initializedLayers_ = new Set<number>();
    /** Last applied dimensions, compared separately so fractional sizes cannot alias. */
    private appliedCellSize_ = new Map<number, { x: number; y: number }>();
    /** TilemapLayer entity → the grid params last pushed (orientation|side|axis|index).
     *  Grid type + stagger/hex params live in the C++ LayerData; the component is the
     *  authority, so an orientation edit (or a cellSize re-init, which resets LayerData)
     *  must re-push — otherwise the drawn/hit grid diverges from the authored one. */
    private appliedGrid_ = new Map<number, string>();
    private animatedLayers_ = new Set<number>();
    /** Tilemap(source) entity → the RuntimeOnly child layer entities derived from its `.tmj`. */
    private sourceLayerEntities_ = new Map<number, Entity[]>();
    private derivedLayers_ = new Set<number>();
    /** Tilemap(source) entity → the cached source OBJECT its children were derived
     *  from. Identity is the change detector: a `source` field edit resolves to a
     *  different object, a hot reload re-registers a fresh one, an invalidation
     *  leaves none — all must tear down + re-derive (the old sync derived once
     *  and rendered the stale parse forever). */
    private sourceDerivedFrom_ = new Map<number, LoadedTilemapSource>();
    /** tilemap entity → the static collider entities derived from its collidable tiles (play-mode only). */
    private collisionEntities_ = new Map<number, Set<Entity>>();
    private collisionChunks_ = new Map<number, Map<string, { chunk: DecodedChunk; entities: Entity[] }>>();
    /** TilemapLayer entity → its baked collidable tile ids (out-of-band scene data; drives native collision). */
    private nativeCollisionIds_ = new Map<number, number[]>();
    /** TilemapLayer entity → per-tile rich collision shapes (global id → resolved
     *  polygon/circle/box-with-modifier), spawned one collider each. */
    private nativeTileShapes_ = new Map<number, Map<number, ResolvedTileCollision>>();
    /** TilemapLayer entity → its `.estileset` refs, in firstId order (out-of-band; the
     *  whole list resolves live → multi-slot table/collision/anim). One entry = the
     *  common single-tileset layer. */
    private tilesetRefs_ = new Map<number, string[]>();
    /** Entities whose `.estileset` has been resolved+applied (so we do it once per load). */
    private liveResolved_ = new Set<number>();
    private lazyTilesetLoads_ = new LazyTilesetLoads();
    /** Tiled DERIVED child layer → its collision query table (see tileQuery). */
    private derivedQueryTables_ = new Map<number, LayerCollisionTable>();
    /** Painted-layer query-table cache, invalidated by source-map identity. */
    private queryTableCache_ = new Map<number, {
        ids: number[] | undefined;
        shapes: Map<number, ResolvedTileCollision> | undefined;
        table: LayerCollisionTable;
    }>();

    install(app: App): void {
        // Whichever core is present (the wasm module on the web, the native host's
        // bindings on a device). A core built without ES_ENABLE_TILEMAP answers
        // none of these, and says so once instead of throwing on the first tile.
        const engine = engineApi(app);
        if (!engine || typeof engine.tilemap_initLayer !== 'function') {
            log.warn('tilemap', 'this engine core has no tilemap support — layers will not render');
            return;
        }
        initTilemapAPI(engine, this);
        // And this app's own toolkit over its own core: `Res(Tilemaps)` must not
        // answer with whichever engine initialised the module seam last.
        const TilemapAPI = createTilemapAPI(engine);
        this.toolkit_ = TilemapAPI;
        app.insertResource(Tilemaps, TilemapAPI);

        // Tile chunks live in a C++ blob, not the component's field record, so
        // teach the scene (de)serializer to carry them out-of-band instead of
        // hardcoding TilemapLayer knowledge in scene.ts.
        const nativeCollisionIds = this.nativeCollisionIds_;
        const nativeTileShapes = this.nativeTileShapes_;
        const tilesetRefs = this.tilesetRefs_;
        const liveResolved = this.liveResolved_;
        const lazyTilesetLoads = this.lazyTilesetLoads_;
        let tilesetRefsChanged = true;
        let observedAssets: AssetsData | null | undefined;
        let tilesetVersion = -1;

        // The single writer of a layer's `.estileset` ref list: point the render table
        // at `refs` and mark it for re-resolve next sync. Shared by the scene codec
        // (full load) AND the editor's live push (TilemapLiveSync) so both routes carry
        // the SAME meaning — no second source of truth for what tilesets a layer uses.
        const applyTilesetRefs = (entity: number, refs: readonly string[]): void => {
            tilesetRefsChanged = true;
            const clean = refs.filter((r): r is string => typeof r === 'string' && r !== '');
            if (clean.length > 0) tilesetRefs.set(entity, clean.slice());
            else {
                if (tilesetRefs.has(entity)) {
                    nativeCollisionIds.delete(entity);
                    nativeTileShapes.delete(entity);
                }
                tilesetRefs.delete(entity);
            }
            liveResolved.delete(entity);
        };
        this.applyTilesetRefs_ = applyTilesetRefs;

        // Tile-collision queries (tileCollisionAt / isTileSolid): resolve a layer to
        // its collision vocabulary — a derived Tiled child's table, or a painted
        // layer's live-resolved/baked sets (cached per source identity).
        _bindTileCollisionLookup((layer) => {
            const derived = this.derivedQueryTables_.get(layer);
            if (derived) return derived;
            const ids = this.nativeCollisionIds_.get(layer);
            const shapes = this.nativeTileShapes_.get(layer);
            if (!ids && !shapes) return null;
            const cached = this.queryTableCache_.get(layer);
            if (cached && cached.ids === ids && cached.shapes === shapes) return cached.table;
            const table: LayerCollisionTable = { boxIds: new Set(ids ?? []), shapes: shapes ?? new Map() };
            this.queryTableCache_.set(layer, { ids, shapes, table });
            return table;
        }, this);

        this.unregisterCodec_ = registerWorldSceneComponentCodec(app.world, 'TilemapLayer', {
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
                    // The engine refuses a map written under another cell
                    // encoding rather than decoding it into other tiles, and
                    // the only way that refusal is heard is here.
                    if (!TilemapAPI.importChunks(entity, blob)) {
                        log.error('tilemap', 'the saved map was refused — it is damaged, or was'
                            + ' painted under a different cell encoding. The layer loads empty.');
                    }
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
                const refs = Array.isArray(list)
                    ? list.filter((r): r is string => typeof r === 'string' && r !== '')
                    : (typeof single === 'string' && single !== '' ? [single] : []);
                applyTilesetRefs(entity, refs);
            },
        });

        const world = app.world;
        const initializedLayers = this.initializedLayers_;
        const appliedCellSize = this.appliedCellSize_;
        const appliedGrid = this.appliedGrid_;
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
                const version = assets?.registryAssetVersion?.('tileset') ?? 0;
                if (assets !== observedAssets || version !== tilesetVersion) {
                    liveResolved.clear();
                    observedAssets = assets;
                    tilesetVersion = version;
                }
                // Physics half-extents are metres; tile sizes are pixels. Divide by the
                // scene's pixelsPerUnit (Canvas, default 100) when spawning tile colliders.
                let pixelsPerUnit = 100;
                for (const ce of world.getEntitiesWithComponents([Canvas])) {
                    const c = world.tryGet(ce, Canvas) as { pixelsPerUnit?: number } | null;
                    if (c?.pixelsPerUnit) { pixelsPerUnit = c.pixelsPerUnit; break; }
                }
                if (!playMode && collisionEntities.size > 0) {
                    for (const entity of collisionEntities.keys()) this.clearLayerCollision_(world, entity);
                }

                const layerEntities = world.getEntitiesWithComponents(
                    [TilemapLayer, Transform],
                );

                for (const entity of initializedLayers) {
                    if (!world.valid(entity as Entity) || !world.has(entity as Entity, TilemapLayer)
                        || !world.has(entity as Entity, Transform)) {
                        TilemapAPI.destroyLayer(entity);
                        initializedLayers.delete(entity);
                        this.clearLayerCollision_(world, entity);
                        appliedCellSize.delete(entity);
                        appliedGrid.delete(entity);
                        nativeCollisionIds.delete(entity);
                        nativeTileShapes.delete(entity);
                        tilesetRefs.delete(entity);
                        tilesetRefsChanged = true;
                        liveResolved.delete(entity);
                        // Without these, a destroyed animated layer stays in the
                        // per-frame tick set (advanceAnimations on a dead layer,
                        // and a wrong one after id reuse) and leaks its query table.
                        animatedLayers.delete(entity);
                        this.queryTableCache_.delete(entity);
                        this.derivedLayers_.delete(entity);
                    }
                }

                if (lazyTilesetLoads.size > 0 && tilesetRefsChanged) {
                    const active = new Set<string>();
                    for (const entity of layerEntities) {
                        for (const ref of tilesetRefs.get(entity) ?? []) active.add(resolveAssetKey(assets, ref));
                    }
                    lazyTilesetLoads.prune(active);
                    tilesetRefsChanged = false;
                }

                for (const entity of layerEntities) {
                    const layerData = world.tryGet(entity, TilemapLayer) as TilemapLayerData | null;
                    if (!layerData) continue;

                    const refs = tilesetRefs.get(entity);
                    // A layer needs either a copied texture (legacy) or .estileset ref(s).
                    if (!this.derivedLayers_.has(entity) && !layerData.tileset && (!refs || refs.length === 0)) {
                        this.clearLayerCollision_(world, entity);
                        continue;
                    }

                    // RC2a: the TilemapLayer component is the single source of visual
                    // metadata; the C++ renderer reads tint/opacity/tileset/columns/
                    // renderLayer/parallax/visible straight off the component each frame.
                    // No per-frame push into LayerData anymore — we only init the layer's
                    // chunk store (the heavy data) and let the renderer pull the rest.
                    // Keep the C++ layer's tile size equal to the component `cellSize`
                    // (the authority). The scene loader's importChunks pre-creates the
                    // layer at a placeholder size, and a user can edit cellSize after
                    // init; initInfiniteLayer is idempotent (keeps chunks), so re-push
                    // whenever the applied size drifts. Stale dims misplace every tile
                    // relative to the paint grid (renderer + worldToTile read tile_width).
                    const cellSize = layerData.cellSize;
                    const appliedSize = appliedCellSize.get(entity);
                    let reinit = false;
                    if (!initializedLayers.has(entity)) {
                        TilemapAPI.initInfiniteLayer(
                            entity, layerData.cellSize.x, layerData.cellSize.y,
                        );
                        TilemapAPI.setOriginEntity(entity, entity);
                        initializedLayers.add(entity);
                        appliedCellSize.set(entity, { x: cellSize.x, y: cellSize.y });
                        reinit = true;
                    } else if (appliedSize?.x !== cellSize.x || appliedSize.y !== cellSize.y) {
                        TilemapAPI.initInfiniteLayer(
                            entity, layerData.cellSize.x, layerData.cellSize.y,
                        );
                        appliedCellSize.set(entity, { x: cellSize.x, y: cellSize.y });
                        reinit = true;
                    }

                    // Grid orientation + stagger/hex params from the component (the
                    // authority): push on an orientation edit, or after a (re)init that
                    // reset the C++ LayerData grid state. Staggered (2) and hexagonal (3)
                    // both read the stagger axis/index; orthogonal/isometric ignore them.
                    // Same worldToTile/renderer path the imported .tmj layers use, so a
                    // painted iso/hex map places tiles exactly like an imported one.
                    const gridKey = `${layerData.orientation ?? 0}|${layerData.hexSideLength ?? 0}`
                        + `|${layerData.staggerAxis ?? 0}|${layerData.staggerIndex ?? 0}`;
                    if (reinit || appliedGrid.get(entity) !== gridKey) {
                        TilemapAPI.setGridType(entity, layerData.orientation ?? 0);
                        TilemapAPI.setHexParams(
                            entity, layerData.hexSideLength ?? 0,
                            (layerData.staggerAxis ?? 0) === 1, (layerData.staggerIndex ?? 0) === 1,
                        );
                        appliedGrid.set(entity, gridKey);
                    }

                    // Collision (obstacle) layer: the sentinel `builtin:collision` ref means
                    // this layer paints from the fixed collision palette, not an `.estileset`.
                    // Install its collision model directly — NO render slots (nothing draws)
                    // and no atlas load — so the same spawn + overlay path handles it as any
                    // painted collision. The gate above passed because refs is non-empty.
                    if (refs && refs.length > 0 && isCollisionPaletteRef(refs) && !liveResolved.has(entity)) {
                        const model = buildCollisionPaletteModel(parseCollisionMaterial(refs));
                        if (model.collidableTileIds.length > 0) nativeCollisionIds.set(entity, model.collidableTileIds);
                        else nativeCollisionIds.delete(entity);
                        if (model.tileShapes.size > 0) nativeTileShapes.set(entity, model.tileShapes);
                        else nativeTileShapes.delete(entity);
                        liveResolved.add(entity);
                    }

                    // Live tileset(s): when ALL the layer's `.estileset` refs have loaded,
                    // derive its multi-slot render table + animations + collision LIVE (once
                    // per load) — replacing copied columns + the baked collidableTileIds. The
                    // whole list must resolve together so firstId ranges are contiguous.
                    else if (refs && refs.length > 0 && !liveResolved.has(entity)) {
                        const resolvedList = [];
                        for (const ref of refs) {
                            const key = resolveAssetKey(assets, ref);
                            const r = resolvedTileset(assets, ref);
                            if (r) {
                                resolvedList.push(r);
                            } else if (assets) {
                                lazyTilesetLoads.request(assets, ref, key);
                            }
                        }
                        if (resolvedList.length === refs.length) {
                            const model = resolveTilesetModel(resolvedList);
                            TilemapAPI.setTilesets(entity, model.slots);
                            // A re-resolve (tileset swap) replaces the whole table —
                            // clear the old animations/collision first, then set the
                            // new ones unconditionally, or stale ids from the previous
                            // tileset keep animating / generating colliders.
                            TilemapAPI.clearTileAnimations(entity);
                            for (const [tileId, frames] of model.animations) {
                                TilemapAPI.setTileAnimation(entity, tileId, frames);
                                animatedLayers.add(entity);
                            }
                            if (model.animations.size === 0) animatedLayers.delete(entity);
                            if (model.collidableTileIds.length > 0) {
                                nativeCollisionIds.set(entity, model.collidableTileIds);
                            } else {
                                nativeCollisionIds.delete(entity);
                            }
                            if (model.tileShapes.size > 0) {
                                nativeTileShapes.set(entity, model.tileShapes);
                            } else {
                                nativeTileShapes.delete(entity);
                            }
                            liveResolved.add(entity);
                        }
                    }

                    this.syncLayerCollision_(world, entity, layerData, pixelsPerUnit, playMode);
                }

                const tilemapEntities = world.getEntitiesWithComponents(
                    [Tilemap, Transform],
                );
                for (const entity of tilemapEntities) {
                    if (world.tryGet(entity, TilemapLayer)) continue;

                    const tilemap = world.tryGet(entity, Tilemap) as { source: string } | null;

                    // This app's realm, by the ref the component carries: the slot
                    // answers to that spelling and to the path it resolved to.
                    const cached = tilemap?.source ? tilemapSource(assets, tilemap.source) : undefined;

                    // Derived children must mirror the CURRENT source. A cleared field,
                    // an invalidated cache entry (hot reload), or different source data
                    // (live `source` edit / fresh registration) all tear down here; the
                    // derive below rebuilds from whatever is cached now.
                    if (sourceLayerEntities.has(entity) && this.sourceDerivedFrom_.get(entity) !== cached) {
                        this.teardownDerived_(world, entity);
                    }
                    if (!cached) continue;

                    if (!sourceLayerEntities.has(entity)) {
                        const children: Entity[] = [];
                        const layout = tiledGridLayout(cached), gridType = layout.orientation;

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
                            world.insert(child, TilemapLayer,
                                tiledLayerComponent(layer, cached.tileWidth, cached.tileHeight, i, layout));
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
                            // Staggered + hexagonal both read the stagger axis/index (the
                            // half-cell shift). Staggered iso ignores the side length.
                            if (usesStagger(gridType)) {
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
                                .map(t => ({
                                    firstId: t.firstId, textureHandle: t.textureHandle, columns: t.columns,
                                    margin: t.margin, spacing: t.spacing,
                                }));
                            if (slots.length > 0) {
                                TilemapAPI.setTilesets(child, slots);
                            } else if (cached.tilesets.length > 0) {
                                // Every tileset texture is dead (handle 0): the map parsed
                                // and its collision generates, but nothing will draw. Say
                                // so ONCE, loudly — silently-invisible-but-solid levels
                                // cost a real debugging session to diagnose from pixels.
                                log.error('tilemap',
                                    `Tiled map on entity ${entity}: none of its ${cached.tilesets.length} `
                                    + 'tileset texture(s) loaded — tiles will NOT render (collision still '
                                    + 'works). See earlier [tilemap] load errors for the failing image path(s).');
                            }

                            // The child answers tile-collision queries with the
                            // source map's vocabulary (same table as the spawn path).
                            if ((cached.collisionTileIds?.length ?? 0) > 0 || (cached.tileShapes?.size ?? 0) > 0) {
                                this.derivedQueryTables_.set(child, {
                                    boxIds: new Set(cached.collisionTileIds ?? []),
                                    shapes: cached.tileShapes ?? new Map(),
                                });
                            }

                            children.push(child);
                            initializedLayers.add(child);
                            this.derivedLayers_.add(child);
                            appliedCellSize.set(child, { x: cached.tileWidth, y: cached.tileHeight });
                            if (cached.collisionTileIds?.length) nativeCollisionIds.set(child, cached.collisionTileIds);
                            if (cached.tileShapes?.size) nativeTileShapes.set(child, cached.tileShapes);
                            this.syncLayerCollision_(world, child, world.get(child, TilemapLayer), pixelsPerUnit, playMode);
                        }

                        // Tile (GID) objects — a positioned tile rendered as a Sprite,
                        // in edit + play mode like the tile layers. Parented to the
                        // tilemap entity, so the sprite's local position is the object's
                        // offset within the map (pixels). H/V flip → flipX/flipY;
                        // diagonal (D) flip = transpose, decomposed as an extra 90° CW
                        // quad rotation with the flip axes exchanged (source H → display
                        // Y with the rotation's inversion baked in, source V → display X)
                        // and the sprite size swapped so the rotated quad fills the
                        // object's authored width×height box (whose centre is
                        // rotation-invariant). Pixel-verified against Tiled's rendering.
                        for (const group of cached.objectGroups ?? []) {
                            if (group.visible === false) continue;
                            // A `collision` group's shapes are SOLID geometry (walls/floors);
                            // every other group's shapes are trigger REGIONS (sensors). Both
                            // derive through the SAME region path below — edit+play visible.
                            const isCollision = isCollisionObjectGroup(group);
                            for (const obj of group.objects) {
                                if (obj.visible === false) continue;
                                // Non-tile objects converge to real, parented, RuntimeOnly
                                // entities (re-derived from the .tmj each load, like the
                                // tile-object sprites), so imported and hand-authored objects
                                // share ONE `Query(Marker)` surface + collider gizmo: a POINT →
                                // a Marker (spawn point / waypoint); a rect/ellipse/polygon/
                                // polyline → a Region (Marker + collider, sensor unless the
                                // group is `collision`, in which case solid geometry).
                                if (obj.gid === undefined) {
                                    if (obj.shape === 'point') {
                                        // Carry the Tiled object's custom properties (stringified) so
                                        // imported markers hold the same per-object data as hand-authored.
                                        const props: Record<string, string> = {};
                                        for (const [k, v] of obj.properties) props[k] = String(v);
                                        const markerChild = world.spawn(obj.name || `Marker_${obj.id}`);
                                        world.insert(markerChild, Transform, { position: { x: obj.x, y: -obj.y, z: 0 } });
                                        world.insert(markerChild, Marker, { type: obj.type || '', properties: props });
                                        world.insert(markerChild, RuntimeOnly, {});
                                        world.setParent(markerChild, entity);
                                        children.push(markerChild);
                                    } else {
                                        const region = spawnObjectRegion(world, obj, entity, pixelsPerUnit, !isCollision);
                                        if (region != null) children.push(region);
                                    }
                                    continue;
                                }
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
                                // The box centre above uses the authored rotation only;
                                // D adds content rotation on top of it.
                                const quadRad = dec.flipD ? rad + Math.PI / 2 : rad;
                                const tileChild = world.spawn(obj.name || `TileObject_${obj.id}`);
                                world.insert(tileChild, Transform, quadRad !== 0
                                    ? { position: { x: px, y: py, z: 0 }, rotation: { w: Math.cos(-quadRad / 2), x: 0, y: 0, z: Math.sin(-quadRad / 2) } }
                                    : { position: { x: px, y: py, z: 0 } });
                                world.insert(tileChild, Sprite, {
                                    texture: ts.textureHandle,
                                    size: dec.flipD ? { x: h, y: w } : { x: w, y: h },
                                    uvOffset: { x: col * uvW, y: 1 - (row + 1) * uvH },
                                    uvScale: { x: uvW, y: uvH },
                                    flipX: dec.flipD ? dec.flipV : dec.flipH,
                                    flipY: dec.flipD ? !dec.flipH : dec.flipV,
                                    layer: cached.layers.length,
                                });
                                world.insert(tileChild, RuntimeOnly, {});
                                world.setParent(tileChild, entity);
                                children.push(tileChild);
                            }
                        }
                        sourceLayerEntities.set(entity, children);
                        this.sourceDerivedFrom_.set(entity, cached);
                    }


                }

                for (const entity of [...sourceLayerEntities.keys()]) {
                    if (!world.valid(entity as Entity) || !world.has(entity as Entity, Tilemap)
                        || world.has(entity as Entity, TilemapLayer)) this.teardownDerived_(world, entity);
                }

            },
        };

        // Frame edits and fixed-step edits derive before physics. Animation
        // advances once per rendered frame, independently of catch-up steps.
        app.addSystemToSchedule(Schedule.First, tilemapSyncSystem);
        app.addSystemToSchedule(Schedule.FixedUpdate, {
            ...tilemapSyncSystem, _id: Symbol('TilemapPhysicsSyncSystem'), _name: 'TilemapPhysicsSyncSystem',
        }, { runBefore: ['CharacterController2DSystem', 'PhysicsStepSystem'], runIf: playModeOnly });
        app.addSystemToSchedule(Schedule.PreUpdate, {
            _id: Symbol('TilemapAnimationSystem'), _name: 'TilemapAnimationSystem', _params: [],
            _fn: () => {
                const dtMs = app.getResource(Time).delta * 1000;
                for (const key of animatedLayers) {
                    if (world.isEntityActive(key as Entity)) TilemapAPI.advanceAnimations(key, dtMs);
                }
            },
        });
    }

    private attachCollision_(world: World, owner: Entity, colliders: Entity[]): void {
        for (const collider of colliders) {
            if (!world.has(collider, RuntimeOnly)) world.insert(collider, RuntimeOnly, {});
            world.setParent(collider, owner);
        }
    }

    private syncLayerCollision_(world: World, entity: Entity, layer: TilemapLayerData, ppu: number, playMode: boolean): void {
        if (!playMode || !this.toolkit_) return;
        const ids = this.nativeCollisionIds_.get(entity), shapes = this.nativeTileShapes_.get(entity);
        const hasBoxes = !!ids?.length, hasShapes = !!shapes?.size;
        const current = this.collisionEntities_.get(entity);
        if (!hasBoxes && !hasShapes) {
            this.clearLayerCollision_(world, entity);
            return;
        }
        const engine = worldEngineApi(world), tiles = this.toolkit_;
        if (!engine) return;
        const generation = engine.tilemap_getGeneration?.(entity);
        const revision = engine.tilemap_getEditRevision?.(entity);
        const gridKey = `${layer.orientation ?? 0}|${layer.hexSideLength ?? 0}|${layer.staggerAxis ?? 0}|${layer.staggerIndex ?? 0}`;
        const originX = layer.originOffset?.x ?? 0, originY = layer.originOffset?.y ?? 0;
        const previous = this.collisionInputs_.get(entity);
        const rebuild = !previous || previous.generation !== generation
            || previous.gridKey !== gridKey || previous.width !== layer.cellSize.x || previous.height !== layer.cellSize.y
            || previous.pixelsPerUnit !== ppu || previous.ids !== ids || previous.shapes !== shapes;
        const sameContent = previous && generation !== undefined && revision !== undefined
            && previous.generation === generation && previous.revision === revision;
        const moved = !!previous && (previous.originX !== originX || previous.originY !== originY);
        if (!rebuild && sameContent && !moved) return;
        const retained = previous && generation !== undefined && previous.generation === generation
            && revision !== undefined && previous.revision !== undefined && revision >= previous.revision ? previous.native : null;
        const native = sameContent ? previous.native : readCollisionChunks(engine, entity, retained);
        const oldChunks = this.collisionChunks_.get(entity);
        const chunks = sameContent && oldChunks ? [...oldChunks.values()].map(value => value.chunk)
            : native ? [...native.values()].filter(chunk => chunk.tiles.length > 0) : decodeTilemapChunks(tiles.exportChunks(entity));
        if (rebuild) this.clearLayerCollision_(world, entity);
        else if (current && moved) {
            const dx = originX - previous.originX, dy = originY - previous.originY;
            for (const collider of current) world.update(collider, Transform, value => {
                value.position.x += dx; value.position.y += dy;
            });
        }
        const layout = { orientation: layer.orientation ?? 0, hexSideLength: layer.hexSideLength ?? 0,
            staggerAxisX: layer.staggerAxis === 1, staggerIndexEven: layer.staggerIndex === 1 };
        const groups = this.collisionChunks_.get(entity) ?? new Map<string, { chunk: DecodedChunk; entities: Entity[] }>();
        const all = this.collisionEntities_.get(entity) ?? new Set<Entity>(), keys = new Set<string>();
        const remove = (group: { entities: Entity[] }) => {
            for (const collider of group.entities) { all.delete(collider); if (world.valid(collider)) world.despawn(collider); }
        };
        const boxIds = new Set(ids);
        for (const chunk of chunks) {
            const key = `${chunk.x},${chunk.y}`; keys.add(key);
            const old = groups.get(key);
            if (old && (old.chunk.tiles === chunk.tiles || old.chunk.tiles.length === chunk.tiles.length
                && old.chunk.tiles.every((value, index) => value === chunk.tiles[index]))) continue;
            if (old) remove(old);
            const spawned: Entity[] = [];
            if (hasBoxes) for (const collider of generateChunkCollision(world, [chunk], boxIds, layer.cellSize.x, layer.cellSize.y,
                originX, originY, ppu, layout)) spawned.push(collider);
            if (hasShapes) for (const collider of generateChunkTileShapes(world, [chunk], shapes!, layer.cellSize.x, layer.cellSize.y,
                originX, originY, ppu, layout)) spawned.push(collider);
            this.attachCollision_(world, entity, spawned);
            for (const collider of spawned) all.add(collider);
            groups.set(key, { chunk, entities: spawned });
        }
        for (const [key, old] of groups) if (!keys.has(key)) { remove(old); groups.delete(key); }
        this.collisionChunks_.set(entity, groups);
        this.collisionEntities_.set(entity, all);
        this.collisionInputs_.set(entity, { generation, revision, gridKey, originX, originY,
            width: layer.cellSize.x, height: layer.cellSize.y, pixelsPerUnit: ppu, ids, shapes, native });
    }

    private clearLayerCollision_(world: { valid(e: Entity): boolean; despawn(e: Entity): void }, entity: number): void {
        for (const collider of this.collisionEntities_.get(entity) ?? []) if (world.valid(collider)) world.despawn(collider);
        this.collisionEntities_.delete(entity); this.collisionInputs_.delete(entity); this.collisionChunks_.delete(entity);
    }

    /** Drop ONE tilemap entity's derived artifacts (child layer entities +
     *  play-mode colliders + bookkeeping) so the sync can re-derive — or not,
     *  if its source is gone. Fires when the Tilemap component disappears AND
     *  when the source it derived from stops being current. */
    private teardownDerived_(
        world: { valid(e: Entity): boolean; despawn(e: Entity): void },
        entity: number,
    ): void {
        for (const child of this.sourceLayerEntities_.get(entity) ?? []) {
            if (this.initializedLayers_.has(child)) {
                this.toolkit_?.destroyLayer(child);
                this.initializedLayers_.delete(child);
            }
            this.animatedLayers_.delete(child);
            this.derivedQueryTables_.delete(child);
            this.derivedLayers_.delete(child);
            this.nativeCollisionIds_.delete(child); this.nativeTileShapes_.delete(child);
            this.collisionEntities_.delete(child); this.collisionInputs_.delete(child);
            this.collisionChunks_.delete(child);
            this.appliedCellSize_.delete(child); this.appliedGrid_.delete(child);
            // An owner despawn cascades to its children; only a component
            // removal leaves them alive to clean up here.
            if (world.valid(child)) world.despawn(child);
        }
        this.sourceLayerEntities_.delete(entity);
        this.sourceDerivedFrom_.delete(entity);
    }

    /**
     * The editor's out-of-band push: a layer's `.estileset` ref list changed.
     * Reached through THIS app's runtime, so an editor world and a play world
     * cannot answer for each other — which a module-level "active plugin"
     * pointer decided by whoever built last.
     */
    setLayerTilesets(entity: number, refs: readonly string[]): void {
        this.applyTilesetRefs_?.(entity, refs);
    }

    resetLayers(): void {
        for (const entity of this.initializedLayers_) {
            this.toolkit_?.destroyLayer(entity);
        }
        this.initializedLayers_.clear();
        this.appliedCellSize_.clear();
        this.appliedGrid_.clear();
        this.animatedLayers_.clear();
        this.sourceLayerEntities_.clear();
        this.derivedLayers_.clear();
        this.sourceDerivedFrom_.clear();
        // Collider entities die with the world on reset/teardown; just drop our bookkeeping.
        this.collisionEntities_.clear();
        this.collisionInputs_.clear();
        this.collisionChunks_.clear();
        this.nativeCollisionIds_.clear();
        this.nativeTileShapes_.clear();
        this.tilesetRefs_.clear();
        this.liveResolved_.clear();
        this.lazyTilesetLoads_.reset();
        this.derivedQueryTables_.clear();
        this.queryTableCache_.clear();
    }

    dispose(): void {
        this.resetLayers();
        this.toolkit_ = null;
        this.unregisterCodec_?.();
        this.unregisterCodec_ = null;
        this.applyTilesetRefs_ = null;
        _bindTileCollisionLookup(null, this);
        shutdownTilemapAPI(this);
    }
}

/** @internal One per App, created by the plugin's build. */
export const TilemapRuntimeState = defineResource<TilemapRuntime>(null!, 'TilemapRuntime');

/**
 * Installs the tilemap runtime into an app. Stateless on purpose: what it
 * installs is per app, and this object is a singleton that several apps share.
 */
export class TilemapPlugin implements Plugin {
    name = 'tilemap';
    /** Layers to sync, animate and give colliders; the frame after the last one goes still tears them down. */
    readonly activeWhen = [TilemapLayer, Tilemap];

    build(app: App): void {
        const runtime = new TilemapRuntime();
        app.insertResource(TilemapRuntimeState, runtime);
        runtime.install(app);
    }

    cleanup(app?: App): void {
        if (app?.hasResource(TilemapRuntimeState)) app.getResource(TilemapRuntimeState).dispose();
    }
}

export const tilemapPlugin = new TilemapPlugin();
