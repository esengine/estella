import type { App, Plugin } from '../app';
import type { ESEngineModule } from '../wasm';
import { Transform, type TransformData } from '../component';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import { initTilemapAPI, shutdownTilemapAPI, TilemapAPI } from './tilemapAPI';
import { Tilemap, TilemapLayer, type TilemapLayerData } from './components';
import { getTextureDimensions, clearTextureDimensionsCache, getTilemapSource } from './tilesetCache';

const SYNTHETIC_KEY_BASE = 0x40000000;
const MAX_LAYERS_PER_ENTITY = 256;

export class TilemapPlugin implements Plugin {
    name = 'TilemapPlugin';

    private initializedLayers_ = new Set<number>();
    private sourceEntityKeys_ = new Map<number, number[]>();
    private layerState_ = new Map<number, {
        texture: number;
        tilesetColumns: number;
        layer: number;
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
                for (const entity of layerEntities) {
                    const layerData = world.tryGet(entity, TilemapLayer) as TilemapLayerData | null;
                    if (!layerData) continue;

                    const textureHandle = layerData.texture;
                    if (!textureHandle) continue;

                    const dims = getTextureDimensions(textureHandle);
                    if (!dims) continue;

                    if (!initializedLayers.has(entity)) {
                        TilemapAPI.initLayer(
                            entity, layerData.width, layerData.height,
                            layerData.tileWidth, layerData.tileHeight,
                        );
                        TilemapAPI.setOriginEntity(entity, entity);
                        if (layerData.tiles.length > 0) {
                            const u16 = new Uint16Array(layerData.tiles.length);
                            for (let i = 0; i < layerData.tiles.length; i++) {
                                u16[i] = layerData.tiles[i];
                            }
                            TilemapAPI.setTiles(entity, u16);
                        }
                        initializedLayers.add(entity);
                    }

                    const uvTileWidth = layerData.tileWidth / dims.width;
                    const uvTileHeight = layerData.tileHeight / dims.height;
                    const tint = layerData.tint;
                    const pf = layerData.parallaxFactor;

                    const prev = layerState.get(entity);
                    const needsUpdate = !prev
                        || prev.texture !== textureHandle
                        || prev.tilesetColumns !== layerData.tilesetColumns
                        || prev.layer !== layerData.layer
                        || prev.parallaxX !== pf.x || prev.parallaxY !== pf.y
                        || prev.tintR !== tint.r || prev.tintG !== tint.g
                        || prev.tintB !== tint.b || prev.tintA !== tint.a
                        || prev.opacity !== layerData.opacity
                        || prev.visible !== layerData.visible;

                    if (needsUpdate) {
                        TilemapAPI.setRenderProps(
                            entity, textureHandle, layerData.tilesetColumns,
                            uvTileWidth, uvTileHeight,
                            layerData.layer, 0,
                            pf.x, pf.y,
                        );
                        TilemapAPI.setTint(entity, tint.r, tint.g, tint.b, tint.a, layerData.opacity);
                        TilemapAPI.setVisible(entity, layerData.visible);

                        layerState.set(entity, {
                            texture: textureHandle,
                            tilesetColumns: layerData.tilesetColumns,
                            layer: layerData.layer,
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
                        for (let i = 0; i < cached.layers.length; i++) {
                            const key = SYNTHETIC_KEY_BASE + entity * MAX_LAYERS_PER_ENTITY + i;
                            const layer = cached.layers[i];
                            TilemapAPI.initLayer(
                                key, layer.width, layer.height,
                                cached.tileWidth, cached.tileHeight,
                            );
                            TilemapAPI.setOriginEntity(key, entity);
                            if (layer.tiles.length > 0) {
                                TilemapAPI.setTiles(key, layer.tiles);
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
            },
        };

        app.addSystemToSchedule(Schedule.PreUpdate, tilemapSyncSystem);
    }

    cleanup(): void {
        for (const entity of this.initializedLayers_) {
            TilemapAPI.destroyLayer(entity);
        }
        this.initializedLayers_.clear();
        this.sourceEntityKeys_.clear();
        this.layerState_.clear();
        clearTextureDimensionsCache();
        shutdownTilemapAPI();
    }
}

export const tilemapPlugin = new TilemapPlugin();
