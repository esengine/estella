import type { App, Plugin } from '../app';
import type { ESEngineModule } from '../wasm';
import { Transform, type TransformData } from '../component';
import { UICameraInfo, type UICameraData } from '../ui/UICameraInfo';
import { initTilemapAPI, shutdownTilemapAPI, TilemapAPI } from './tilemapAPI';
import { Tilemap, TilemapLayer } from './components';
import { getTextureDimensions, clearTextureDimensionsCache, getTilemapSource } from './tilesetCache';

const MAX_CAMERA_EXTENT = 1e6;
const SYNTHETIC_KEY_BASE = 0x40000000;
const MAX_LAYERS_PER_ENTITY = 256;

export class TilemapPlugin implements Plugin {
    name = 'TilemapPlugin';

    private initializedLayers_ = new Set<number>();
    private sourceEntityKeys_ = new Map<number, number[]>();

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        initTilemapAPI(module);

        const world = app.world;
        const initializedLayers = this.initializedLayers_;
        const sourceEntityKeys = this.sourceEntityKeys_;

        app.pipeline?.setTilemapRenderer(() => {
            const cam = app.getResource<UICameraData>(UICameraInfo);
            const camLeft = cam?.valid ? cam.worldLeft : -MAX_CAMERA_EXTENT;
            const camBottom = cam?.valid ? cam.worldBottom : -MAX_CAMERA_EXTENT;
            const camRight = cam?.valid ? cam.worldRight : MAX_CAMERA_EXTENT;
            const camTop = cam?.valid ? cam.worldTop : MAX_CAMERA_EXTENT;

            const layerEntities = world.getEntitiesWithComponents(
                [TilemapLayer, Transform],
            );
            for (const entity of layerEntities) {
                const layerData = world.tryGet(entity, TilemapLayer) as {
                    width: number;
                    height: number;
                    tileWidth: number;
                    tileHeight: number;
                    texture: number;
                    tilesetColumns: number;
                    layer: number;
                    tiles: number[];
                } | null;
                const transform = world.tryGet(entity, Transform) as TransformData | null;
                if (!layerData || !transform) continue;

                const textureHandle = layerData.texture;
                if (!textureHandle) continue;

                const dims = getTextureDimensions(textureHandle);
                if (!dims) continue;

                if (!initializedLayers.has(entity)) {
                    TilemapAPI.initLayer(
                        entity, layerData.width, layerData.height,
                        layerData.tileWidth, layerData.tileHeight,
                    );
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

                TilemapAPI.submitLayer(
                    entity,
                    textureHandle,
                    layerData.layer,
                    0,
                    layerData.tilesetColumns,
                    uvTileWidth,
                    uvTileHeight,
                    transform.worldPosition.x,
                    transform.worldPosition.y,
                    camLeft, camBottom, camRight, camTop,
                );
            }

            const tilemapEntities = world.getEntitiesWithComponents(
                [Tilemap, Transform],
            );
            for (const entity of tilemapEntities) {
                if (world.tryGet(entity, TilemapLayer)) continue;

                const tilemap = world.tryGet(entity, Tilemap) as { source: string } | null;
                const transform = world.tryGet(entity, Transform) as TransformData | null;
                if (!tilemap?.source || !transform) continue;

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
                        if (layer.tiles.length > 0) {
                            TilemapAPI.setTiles(key, layer.tiles);
                        }
                        keys.push(key);
                        initializedLayers.add(key);
                    }
                    sourceEntityKeys.set(entity, keys);
                }

                const keys = sourceEntityKeys.get(entity)!;
                for (let i = 0; i < cached.layers.length && i < keys.length; i++) {
                    const key = keys[i];
                    const tileset = cached.tilesets[0];
                    if (!tileset) continue;

                    const dims = getTextureDimensions(tileset.textureHandle);
                    if (!dims) continue;

                    const uvTileWidth = cached.tileWidth / dims.width;
                    const uvTileHeight = cached.tileHeight / dims.height;

                    TilemapAPI.submitLayer(
                        key,
                        tileset.textureHandle,
                        i,
                        0,
                        tileset.columns,
                        uvTileWidth,
                        uvTileHeight,
                        transform.worldPosition.x,
                        transform.worldPosition.y,
                        camLeft, camBottom, camRight, camTop,
                    );
                }
            }
        });
    }

    cleanup(): void {
        for (const entity of this.initializedLayers_) {
            TilemapAPI.destroyLayer(entity);
        }
        this.initializedLayers_.clear();
        this.sourceEntityKeys_.clear();
        clearTextureDimensionsCache();
        shutdownTilemapAPI();
    }
}

export const tilemapPlugin = new TilemapPlugin();
