// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { engineApi } from '../ecs/bridge/engineApi';
import { Transform, TilemapLayer, Sprite, Canvas, RuntimeOnly, Marker, type TilemapLayerData } from '../ecs/component';
import { Schedule } from '../ecs/system';
import type { SystemDef } from '../ecs/system';
import { initTilemapAPI, shutdownTilemapAPI, TilemapAPI } from './tilemapAPI';
import { TilemapLiveSync } from './tilemapLiveSync';
import { Tilemap } from './components';
import { registerSceneComponentCodec } from '../scene';
import { getTilemapSource, getResolvedTileset, type LoadedTilemapSource } from './tilesetCache';
import { resolveTilesetModel } from './tilesetResolve';
import { isCollisionPaletteRef, buildCollisionPaletteModel, parseCollisionMaterial } from './collisionPalette';
import { _bindTileCollisionLookup, type LayerCollisionTable } from './tileQuery';
import type { ResolvedTileCollision } from './tilesetResolve';
import {
    generateLayerCollision, generateLayerTileShapes, generateChunkCollision, generateChunkTileShapes,
    spawnObjectRegion, isCollisionObjectGroup, decodeTiledGid,
} from './tiledLoader';
import { decodeTilemapChunks } from './chunkCodec';
import { Assets } from '../asset/AssetPlugin';
import { resolveAssetKey } from '../asset/resolveAssetKey';
import { Time } from '../ecs/resource';
import { playModeOnly } from '../env';
import { log } from '../logger';
import type { Entity } from '../types';

const GRID_TYPE_MAP: Record<string, number> = {
    orthogonal: 0,
    isometric: 1,
    staggered: 2,
    hexagonal: 3,
};
const GRID_STAGGERED = 2;
const GRID_HEXAGONAL = 3;

export class TilemapPlugin implements Plugin {
    name = 'tilemap';

    private initializedLayers_ = new Set<number>();
    /** TilemapLayer entity → the tile size last pushed to its C++ layer (`w*K+h`).
     *  The renderer + worldToTile read the C++ `tile_width`; the component `cellSize`
     *  is the authority, so an edit must re-push — otherwise the paint grid (cellSize)
     *  and the drawn/hit grid (stale tile_width) diverge and tiles land off-cursor. */
    private appliedCellSize_ = new Map<number, number>();
    /** TilemapLayer entity → the grid params last pushed (orientation|side|axis|index).
     *  Grid type + stagger/hex params live in the C++ LayerData; the component is the
     *  authority, so an orientation edit (or a cellSize re-init, which resets LayerData)
     *  must re-push — otherwise the drawn/hit grid diverges from the authored one. */
    private appliedGrid_ = new Map<number, string>();
    private animatedLayers_ = new Set<number>();
    /** Tilemap(source) entity → the RuntimeOnly child layer entities derived from its `.tmj`. */
    private sourceLayerEntities_ = new Map<number, Entity[]>();
    /** Tilemap(source) entity → the cached source OBJECT its children were derived
     *  from. Identity is the change detector: a `source` field edit resolves to a
     *  different object, a hot reload re-registers a fresh one, an invalidation
     *  leaves none — all must tear down + re-derive (the old sync derived once
     *  and rendered the stale parse forever). */
    private sourceDerivedFrom_ = new Map<number, LoadedTilemapSource>();
    /** tilemap entity → the static collider entities derived from its collidable tiles (play-mode only). */
    private collisionEntities_ = new Map<number, Entity[]>();
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
    /** Resolved `.estileset` paths a load has already been kicked off for (de-dupes the lazy load). */
    private requestedTilesetLoads_ = new Set<string>();
    /** Tiled DERIVED child layer → its collision query table (see tileQuery). */
    private derivedQueryTables_ = new Map<number, LayerCollisionTable>();
    /** Painted-layer query-table cache, invalidated by source-map identity. */
    private queryTableCache_ = new Map<number, {
        ids: number[] | undefined;
        shapes: Map<number, ResolvedTileCollision> | undefined;
        table: LayerCollisionTable;
    }>();

    build(app: App): void {
        // Whichever core is present (the wasm module on the web, the native host's
        // bindings on a device). A core built without ES_ENABLE_TILEMAP answers
        // none of these, and says so once instead of throwing on the first tile.
        const engine = engineApi(app);
        if (!engine || typeof engine.tilemap_initLayer !== 'function') {
            log.warn('tilemap', 'this engine core has no tilemap support — layers will not render');
            return;
        }
        initTilemapAPI(engine);

        // Tile chunks live in a C++ blob, not the component's field record, so
        // teach the scene (de)serializer to carry them out-of-band instead of
        // hardcoding TilemapLayer knowledge in scene.ts.
        const nativeCollisionIds = this.nativeCollisionIds_;
        const nativeTileShapes = this.nativeTileShapes_;
        const tilesetRefs = this.tilesetRefs_;
        const liveResolved = this.liveResolved_;
        const requestedTilesetLoads = this.requestedTilesetLoads_;

        // The single writer of a layer's `.estileset` ref list: point the render table
        // at `refs` and mark it for re-resolve next sync. Shared by the scene codec
        // (full load) AND the editor's live push (TilemapLiveSync) so both routes carry
        // the SAME meaning — no second source of truth for what tilesets a layer uses.
        const applyTilesetRefs = (entity: number, refs: readonly string[]): void => {
            const clean = refs.filter((r): r is string => typeof r === 'string' && r !== '');
            if (clean.length > 0) tilesetRefs.set(entity, clean.slice());
            else tilesetRefs.delete(entity);
            liveResolved.delete(entity);
        };
        TilemapLiveSync._bind(applyTilesetRefs);

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
        });

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
                        appliedCellSize.delete(entity);
                        appliedGrid.delete(entity);
                        nativeCollisionIds.delete(entity);
                        nativeTileShapes.delete(entity);
                        tilesetRefs.delete(entity);
                        liveResolved.delete(entity);
                        // Without these, a destroyed animated layer stays in the
                        // per-frame tick set (advanceAnimations on a dead layer,
                        // and a wrong one after id reuse) and leaks its query table.
                        animatedLayers.delete(entity);
                        this.queryTableCache_.delete(entity);
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
                    // Keep the C++ layer's tile size equal to the component `cellSize`
                    // (the authority). The scene loader's importChunks pre-creates the
                    // layer at a placeholder size, and a user can edit cellSize after
                    // init; initInfiniteLayer is idempotent (keeps chunks), so re-push
                    // whenever the applied size drifts. Stale dims misplace every tile
                    // relative to the paint grid (renderer + worldToTile read tile_width).
                    const csKey = layerData.cellSize.x * 65536 + layerData.cellSize.y;
                    let reinit = false;
                    if (!initializedLayers.has(entity)) {
                        TilemapAPI.initInfiniteLayer(
                            entity, layerData.cellSize.x, layerData.cellSize.y,
                        );
                        TilemapAPI.setOriginEntity(entity, entity);
                        initializedLayers.add(entity);
                        appliedCellSize.set(entity, csKey);
                        reinit = true;
                    } else if (appliedCellSize.get(entity) !== csKey) {
                        TilemapAPI.initInfiniteLayer(
                            entity, layerData.cellSize.x, layerData.cellSize.y,
                        );
                        appliedCellSize.set(entity, csKey);
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

                    // Native path: collidable tiles spawn static colliders once in play mode
                    // — plain solid boxes greedy-merged, rich shapes (polygon/circle/one-way/
                    // material) one collider each — using the live `.estileset` shapes when
                    // resolved, else the baked id set.
                    const collIds = nativeCollisionIds.get(entity);
                    const tileShapes = nativeTileShapes.get(entity);
                    const hasBox = collIds != null && collIds.length > 0;
                    const hasShapes = tileShapes != null && tileShapes.size > 0;
                    if (playMode && (hasBox || hasShapes) && !collisionEntities.has(entity)) {
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
                        if (hasShapes) {
                            spawned.push(...generateChunkTileShapes(
                                world, chunks, tileShapes,
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

                    // The loader keys the source cache by the RESOLVED path and
                    // `resolveSceneAssetPaths` leaves `source` as the authored ref, so
                    // resolve at lookup (see resolveAssetKey), falling back to the raw ref.
                    const cached = tilemap?.source
                        ? getTilemapSource(resolveAssetKey(assets, tilemap.source)) ?? getTilemapSource(tilemap.source)
                        : undefined;

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
                            // Staggered + hexagonal both read the stagger axis/index (the
                            // half-cell shift). Staggered iso ignores the side length.
                            if (gridType === GRID_STAGGERED || gridType === GRID_HEXAGONAL) {
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

                    // Object-group colliders (solid + sensor) are derived as RuntimeOnly region
                    // entities above (edit+play, gizmo-visible); only TILE collision spawns
                    // here, play-mode only.
                    const hasTileCollision = !!(cached.collisionTileIds && cached.collisionTileIds.length > 0);
                    const hasTileShapes = !!(cached.tileShapes && cached.tileShapes.size > 0);
                    if (
                        playMode
                        && !collisionEntities.has(entity)
                        && (hasTileCollision || hasTileShapes)
                    ) {
                        const tf = world.tryGet(entity, Transform) as
                            { position: { x: number; y: number } } | null;
                        const ox = tf?.position.x ?? 0;
                        const oy = tf?.position.y ?? 0;
                        const spawned: Entity[] = [];
                        if (hasTileCollision || hasTileShapes) {
                            const ids = new Set(cached.collisionTileIds);
                            for (const layer of cached.layers) {
                                if (layer.infinite) {
                                    // Infinite Tiled layers are re-chunked to CHUNK_SIZE at
                                    // parse, so they ride the SAME chunk generators the
                                    // painted path uses.
                                    if (layer.chunks.length === 0) continue;
                                    if (hasTileCollision) {
                                        spawned.push(...generateChunkCollision(
                                            world, layer.chunks, ids,
                                            cached.tileWidth, cached.tileHeight, ox, oy, pixelsPerUnit,
                                        ));
                                    }
                                    if (hasTileShapes) {
                                        spawned.push(...generateChunkTileShapes(
                                            world, layer.chunks, cached.tileShapes!,
                                            cached.tileWidth, cached.tileHeight, ox, oy, pixelsPerUnit,
                                        ));
                                    }
                                    continue;
                                }
                                if (layer.tiles.length === 0) continue;
                                if (hasTileCollision) {
                                    spawned.push(...generateLayerCollision(
                                        world, layer.tiles, layer.width, layer.height,
                                        cached.tileWidth, cached.tileHeight, ids, ox, oy, pixelsPerUnit,
                                    ));
                                }
                                // Rich Tiled tile-collision (shapes / one-way / sensor /
                                // material) spawns through the same per-tile core as the
                                // painted `.estileset` path.
                                if (hasTileShapes) {
                                    spawned.push(...generateLayerTileShapes(
                                        world, layer.tiles, layer.width, layer.height,
                                        cached.tileShapes!, cached.tileWidth, cached.tileHeight,
                                        ox, oy, pixelsPerUnit,
                                    ));
                                }
                            }
                        }
                        collisionEntities.set(entity, spawned);
                    }
                }

                const currentTilemapSet = new Set(tilemapEntities);
                for (const entity of [...sourceLayerEntities.keys()]) {
                    if (!currentTilemapSet.has(entity)) this.teardownDerived_(world, entity);
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
                TilemapAPI.destroyLayer(child);
                this.initializedLayers_.delete(child);
            }
            this.animatedLayers_.delete(child);
            this.derivedQueryTables_.delete(child);
            // An owner despawn cascades to its children; only a component
            // removal leaves them alive to clean up here.
            if (world.valid(child)) world.despawn(child);
        }
        this.sourceLayerEntities_.delete(entity);
        this.sourceDerivedFrom_.delete(entity);

        const colliders = this.collisionEntities_.get(entity);
        if (colliders) {
            for (const e of colliders) if (world.valid(e)) world.despawn(e);
            this.collisionEntities_.delete(entity);
        }
    }

    resetLayers(): void {
        for (const entity of this.initializedLayers_) {
            TilemapAPI.destroyLayer(entity);
        }
        this.initializedLayers_.clear();
        this.appliedCellSize_.clear();
        this.animatedLayers_.clear();
        this.sourceLayerEntities_.clear();
        this.sourceDerivedFrom_.clear();
        // Collider entities die with the world on reset/teardown; just drop our bookkeeping.
        this.collisionEntities_.clear();
        this.nativeCollisionIds_.clear();
        this.nativeTileShapes_.clear();
        this.tilesetRefs_.clear();
        this.liveResolved_.clear();
        this.requestedTilesetLoads_.clear();
        this.derivedQueryTables_.clear();
        this.queryTableCache_.clear();
    }

    cleanup(): void {
        this.resetLayers();
        TilemapLiveSync._bind(null);
        _bindTileCollisionLookup(null);
        shutdownTilemapAPI();
    }
}

export const tilemapPlugin = new TilemapPlugin();
