import type { App, Plugin } from '../app';
import type { ESEngineModule } from '../wasm';
import { Transform, TilemapLayer, type TilemapLayerData } from '../component';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import { initTilemapAPI, shutdownTilemapAPI, TilemapAPI } from './tilemapAPI';
import { Tilemap } from './components';
import { getTilemapSource } from './tilesetCache';
import { getTextureDimensions } from '../resourceManager';
import { Time } from '../resource';

const SYNTHETIC_KEY_BASE = 0x40000000;
const MAX_LAYERS_PER_ENTITY = 256;

const GRID_TYPE_MAP: Record<string, number> = {
    orthogonal: 0,
    isometric: 1,
    staggered: 2,
};

export class TilemapPlugin implements Plugin {
    name = 'tilemap';

    private initializedLayers_ = new Set<number>();
    private animatedLayers_ = new Set<number>();
    private sourceEntityKeys_ = new Map<number, number[]>();
    private layerState_ = new Map<number, {
        texture: number;
        tilesetColumns: number;
        renderLayer: number;
        tintR: number; tintG: number; tintB: number; tintA: number;
        opacity: number;
        parallaxX: number; parallaxY: number;
        visible: boolean;
    }>();

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        initTilemapAPI(module);

        const world = app.world;
        const initializedLayers = this.initializedLayers_;
        const animatedLayers = this.animatedLayers_;
        const sourceEntityKeys = this.sourceEntityKeys_;
        const layerState = this.layerState_;

        const tilemapSyncSystem: SystemDef = {
            _id: Symbol('TilemapSyncSystem'),
            _name: 'TilemapSyncSystem',
            _params: [],
            _fn: () => {
                const layerEntities = world.getEntitiesWithComponents(
                    [TilemapLayer, Transform],
                );

                const currentLayerSet = new Set(layerEntities);
                for (const entity of initializedLayers) {
                    if (entity >= SYNTHETIC_KEY_BASE) continue;
                    if (!currentLayerSet.has(entity)) {
                        TilemapAPI.destroyLayer(entity);
                        initializedLayers.delete(entity);
                        layerState.delete(entity);
                    }
                }

                for (const entity of layerEntities) {
                    const layerData = world.tryGet(entity, TilemapLayer) as TilemapLayerData | null;
                    if (!layerData) continue;

                    const textureHandle = layerData.tileset;
                    if (!textureHandle) continue;

                    const dims = getTextureDimensions(textureHandle);
                    if (!dims) continue;

                    if (!initializedLayers.has(entity)) {
                        TilemapAPI.initInfiniteLayer(
                            entity, layerData.cellSize.x, layerData.cellSize.y,
                        );
                        TilemapAPI.setOriginEntity(entity, entity);
                        initializedLayers.add(entity);
                    }

                    const uvTileWidth = layerData.cellSize.x / dims.width;
                    const uvTileHeight = layerData.cellSize.y / dims.height;
                    const tint = layerData.tintColor;
                    const pf = layerData.parallaxFactor;

                    const prev = layerState.get(entity);
                    const needsUpdate = !prev
                        || prev.texture !== textureHandle
                        || prev.tilesetColumns !== layerData.tilesetColumns
                        || prev.renderLayer !== layerData.renderLayer
                        || prev.parallaxX !== pf.x || prev.parallaxY !== pf.y
                        || prev.tintR !== tint.r || prev.tintG !== tint.g
                        || prev.tintB !== tint.b || prev.tintA !== tint.a
                        || prev.opacity !== layerData.opacity
                        || prev.visible !== layerData.visible;

                    if (needsUpdate) {
                        TilemapAPI.setRenderProps(
                            entity, textureHandle, layerData.tilesetColumns,
                            uvTileWidth, uvTileHeight,
                            layerData.renderLayer, 0,
                            pf.x, pf.y,
                        );
                        TilemapAPI.setTint(entity, tint.r, tint.g, tint.b, tint.a, layerData.opacity ?? 1);
                        TilemapAPI.setVisible(entity, layerData.visible ?? true);

                        layerState.set(entity, {
                            texture: textureHandle,
                            tilesetColumns: layerData.tilesetColumns,
                            renderLayer: layerData.renderLayer,
                            tintR: tint.r, tintG: tint.g, tintB: tint.b, tintA: tint.a,
                            opacity: layerData.opacity,
                            parallaxX: pf.x, parallaxY: pf.y,
                            visible: layerData.visible,
                        });
                    }
                }

                const tilemapEntities = world.getEntitiesWithComponents(
                    [Tilemap, Transform],
                );
                for (const entity of tilemapEntities) {
                    if (world.tryGet(entity, TilemapLayer)) continue;

                    const tilemap = world.tryGet(entity, Tilemap) as { source: string } | null;
                    if (!tilemap?.source) continue;

                    const cached = getTilemapSource(tilemap.source);
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

                            const tileset = cached.tilesets[0];
                            if (tileset) {
                                const dims = getTextureDimensions(tileset.textureHandle);
                                if (dims) {
                                    TilemapAPI.setRenderProps(
                                        key, tileset.textureHandle, tileset.columns,
                                        cached.tileWidth / dims.width,
                                        cached.tileHeight / dims.height,
                                        i, 0, 1, 1,
                                    );
                                    TilemapAPI.setTint(key, 1, 1, 1, 1, 1);
                                    TilemapAPI.setVisible(key, true);
                                }
                            }

                            keys.push(key);
                            initializedLayers.add(key);
                        }
                        sourceEntityKeys.set(entity, keys);
                    }
                }

                const currentTilemapSet = new Set(tilemapEntities);
                for (const [entity, keys] of sourceEntityKeys) {
                    if (!currentTilemapSet.has(entity)) {
                        for (const key of keys) {
                            TilemapAPI.destroyLayer(key);
                            initializedLayers.delete(key);
                            animatedLayers.delete(key);
                            layerState.delete(key);
                        }
                        sourceEntityKeys.delete(entity);
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
        this.layerState_.clear();
    }

    cleanup(): void {
        this.resetLayers();
        shutdownTilemapAPI();
    }
}

export const tilemapPlugin = new TilemapPlugin();
