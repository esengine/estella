import type { ESEngineModule } from '../wasm';

interface TilemapModule {
    tilemap_initLayer(entity: number, width: number, height: number,
                      tileWidth: number, tileHeight: number): void;
    tilemap_destroyLayer(entity: number): void;
    tilemap_setTile(entity: number, x: number, y: number, tileId: number): void;
    tilemap_getTile(entity: number, x: number, y: number): number;
    tilemap_fillRect(entity: number, x: number, y: number,
                     w: number, h: number, tileId: number): void;
    tilemap_setTiles(entity: number, tilesPtr: number, count: number): void;
    tilemap_hasLayer(entity: number): boolean;
    tilemap_setRenderProps(entity: number, textureHandle: number, tilesetColumns: number,
                           uvTileW: number, uvTileH: number,
                           sortLayer: number, depth: number,
                           parallaxX: number, parallaxY: number): void;
    tilemap_setTint(entity: number, r: number, g: number, b: number, a: number,
                    opacity: number): void;
    tilemap_setVisible(entity: number, visible: boolean): void;
    tilemap_setOriginEntity(layerKey: number, originEntity: number): void;
    tilemap_submitLayer(entity: number, textureId: number,
                        sortLayer: number, depth: number,
                        tilesetColumns: number,
                        uvTileWidth: number, uvTileHeight: number,
                        originX: number, originY: number,
                        camLeft: number, camBottom: number,
                        camRight: number, camTop: number,
                        tintR: number, tintG: number, tintB: number, tintA: number,
                        opacity: number,
                        parallaxX: number, parallaxY: number): void;

    tiled_loadMap(dataPtr: number, dataSize: number): number;
    tiled_freeMap(handle: number): void;
    tiled_getExternalTilesetCount(handle: number): number;
    tiled_getExternalTilesetSource(handle: number, index: number): string;
    tiled_loadExternalTileset(handle: number, index: number,
                               dataPtr: number, dataSize: number): boolean;
    tiled_finalize(handle: number): boolean;
    tiled_getMapWidth(handle: number): number;
    tiled_getMapHeight(handle: number): number;
    tiled_getMapTileWidth(handle: number): number;
    tiled_getMapTileHeight(handle: number): number;
    tiled_getLayerCount(handle: number): number;
    tiled_getLayerName(handle: number, index: number): string;
    tiled_getLayerWidth(handle: number, index: number): number;
    tiled_getLayerHeight(handle: number, index: number): number;
    tiled_getLayerVisible(handle: number, index: number): boolean;
    tiled_getLayerTiles(handle: number, index: number,
                         outPtr: number, maxCount: number): number;
    tiled_getTilesetCount(handle: number): number;
    tiled_getTilesetName(handle: number, index: number): string;
    tiled_getTilesetImage(handle: number, index: number): string;
    tiled_getTilesetTileWidth(handle: number, index: number): number;
    tiled_getTilesetTileHeight(handle: number, index: number): number;
    tiled_getTilesetColumns(handle: number, index: number): number;
    tiled_getTilesetTileCount(handle: number, index: number): number;

    tiled_getLayerOpacity(handle: number, index: number): number;
    tiled_getLayerTintColor(handle: number, index: number): number;
    tiled_getLayerParallaxX(handle: number, index: number): number;
    tiled_getLayerParallaxY(handle: number, index: number): number;

    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

let module_: TilemapModule | null = null;

export function initTilemapAPI(m: ESEngineModule): void {
    module_ = m as unknown as TilemapModule;
}

export function shutdownTilemapAPI(): void {
    module_ = null;
}

export function getTiledAPI(): TilemapModule | null {
    return module_;
}

export const TilemapAPI = {
    initLayer(entity: number, width: number, height: number,
              tileWidth: number, tileHeight: number): void {
        module_?.tilemap_initLayer(entity, width, height, tileWidth, tileHeight);
    },

    destroyLayer(entity: number): void {
        module_?.tilemap_destroyLayer(entity);
    },

    setTile(entity: number, x: number, y: number, tileId: number): void {
        module_?.tilemap_setTile(entity, x, y, tileId);
    },

    getTile(entity: number, x: number, y: number): number {
        if (!module_) return 0;
        return module_.tilemap_getTile(entity, x, y);
    },

    fillRect(entity: number, x: number, y: number,
             w: number, h: number, tileId: number): void {
        module_?.tilemap_fillRect(entity, x, y, w, h, tileId);
    },

    setTiles(entity: number, tiles: Uint16Array): void {
        if (!module_) return;
        const bytes = tiles.byteLength;
        const ptr = module_._malloc(bytes);
        new Uint16Array(module_.HEAPU8.buffer, ptr, tiles.length).set(tiles);
        module_.tilemap_setTiles(entity, ptr, tiles.length);
        module_._free(ptr);
    },

    hasLayer(entity: number): boolean {
        if (!module_) return false;
        return module_.tilemap_hasLayer(entity);
    },

    setRenderProps(entity: number, textureHandle: number, tilesetColumns: number,
                   uvTileW: number, uvTileH: number,
                   sortLayer: number, depth: number,
                   parallaxX: number, parallaxY: number): void {
        module_?.tilemap_setRenderProps(entity, textureHandle, tilesetColumns,
            uvTileW, uvTileH, sortLayer, depth, parallaxX, parallaxY);
    },

    setTint(entity: number, r: number, g: number, b: number, a: number,
            opacity: number): void {
        module_?.tilemap_setTint(entity, r, g, b, a, opacity);
    },

    setVisible(entity: number, visible: boolean): void {
        module_?.tilemap_setVisible(entity, visible);
    },

    setOriginEntity(layerKey: number, originEntity: number): void {
        module_?.tilemap_setOriginEntity(layerKey, originEntity);
    },

    submitLayer(entity: number, textureId: number,
                sortLayer: number, depth: number,
                tilesetColumns: number,
                uvTileWidth: number, uvTileHeight: number,
                originX: number, originY: number,
                camLeft: number, camBottom: number,
                camRight: number, camTop: number,
                tintR: number, tintG: number, tintB: number, tintA: number,
                opacity: number,
                parallaxX: number, parallaxY: number): void {
        module_?.tilemap_submitLayer(
            entity, textureId, sortLayer, depth,
            tilesetColumns, uvTileWidth, uvTileHeight,
            originX, originY, camLeft, camBottom, camRight, camTop,
            tintR, tintG, tintB, tintA, opacity, parallaxX, parallaxY
        );
    },
};
