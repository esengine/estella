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

    tilemap_setTileAnimation(entity: number, tileId: number,
                              framesPtr: number, frameCount: number): void;
    tilemap_advanceAnimations(entity: number, dtMs: number): void;
    tilemap_setTileProperty(entity: number, tileId: number,
                             key: string, value: string): void;
    tilemap_getTileProperty(entity: number, x: number, y: number,
                             key: string): string;
    tilemap_flipTile(entity: number, x: number, y: number,
                      flipH: boolean, flipV: boolean, flipD: boolean): void;
    tilemap_rotateTile(entity: number, x: number, y: number, degrees: number): void;
    tilemap_setGridType(entity: number, type: number): void;
    tilemap_initInfiniteLayer(entity: number, tileWidth: number, tileHeight: number): void;
    tilemap_initInfinite?(entity: number, tileWidth: number, tileHeight: number): void;
    tilemap_exportChunks?(entity: number): string;
    tilemap_importChunks?(entity: number, encoded: string): boolean;
    tilemap_setChunkTiles(entity: number, chunkX: number, chunkY: number,
                           tilesPtr: number, width: number, height: number): void;
    tilemap_tileToWorld(entity: number, tx: number, ty: number,
                         originX: number, originY: number): number;
    tilemap_worldToTile(entity: number, wx: number, wy: number,
                         originX: number, originY: number): number;

    HEAPF32: Float32Array;

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
    tiled_isMapInfinite(handle: number): boolean;
    tiled_isLayerInfinite(handle: number, index: number): boolean;
    tiled_getLayerChunkCount(handle: number, index: number): number;
    tiled_getLayerChunkX(handle: number, layerIndex: number, chunkIndex: number): number;
    tiled_getLayerChunkY(handle: number, layerIndex: number, chunkIndex: number): number;
    tiled_getLayerChunkWidth(handle: number, layerIndex: number, chunkIndex: number): number;
    tiled_getLayerChunkHeight(handle: number, layerIndex: number, chunkIndex: number): number;
    tiled_getLayerChunkTiles(handle: number, layerIndex: number, chunkIndex: number,
                              outPtr: number, maxCount: number): number;

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

    setTileAnimation(entity: number, tileId: number,
                     frames: { tileId: number; duration: number }[]): void {
        if (!module_ || frames.length === 0) return;
        const buf = new Uint32Array(frames.length * 2);
        for (let i = 0; i < frames.length; i++) {
            buf[i * 2] = frames[i].tileId;
            buf[i * 2 + 1] = frames[i].duration;
        }
        const bytes = buf.byteLength;
        const ptr = module_._malloc(bytes);
        new Uint32Array(module_.HEAPU8.buffer, ptr, buf.length).set(buf);
        module_.tilemap_setTileAnimation(entity, tileId, ptr, frames.length);
        module_._free(ptr);
    },

    advanceAnimations(entity: number, dtMs: number): void {
        module_?.tilemap_advanceAnimations(entity, dtMs);
    },

    setTileProperty(entity: number, tileId: number,
                    key: string, value: string): void {
        module_?.tilemap_setTileProperty(entity, tileId, key, value);
    },

    getTileProperty(entity: number, x: number, y: number, key: string): string {
        if (!module_) return '';
        return module_.tilemap_getTileProperty(entity, x, y, key);
    },

    flipTile(entity: number, x: number, y: number,
             flipH: boolean, flipV: boolean, flipD: boolean): void {
        module_?.tilemap_flipTile(entity, x, y, flipH, flipV, flipD);
    },

    rotateTile(entity: number, x: number, y: number, degrees: number): void {
        module_?.tilemap_rotateTile(entity, x, y, degrees);
    },

    initInfiniteLayer(entity: number, tileWidth: number, tileHeight: number): void {
        // Prefer the idempotent binding so a second call doesn't wipe tiles.
        if (module_?.tilemap_initInfinite) {
            module_.tilemap_initInfinite(entity, tileWidth, tileHeight);
            return;
        }
        module_?.tilemap_initInfiniteLayer(entity, tileWidth, tileHeight);
    },

    setChunkTiles(entity: number, chunkX: number, chunkY: number,
                  tiles: Uint16Array, width: number, height: number): void {
        if (!module_) return;
        const bytes = tiles.byteLength;
        const ptr = module_._malloc(bytes);
        new Uint16Array(module_.HEAPU8.buffer, ptr, tiles.length).set(tiles);
        module_.tilemap_setChunkTiles(entity, chunkX, chunkY, ptr, width, height);
        module_._free(ptr);
    },

    setGridType(entity: number, type: number): void {
        module_?.tilemap_setGridType(entity, type);
    },

    tileToWorld(entity: number, tx: number, ty: number,
                originX: number, originY: number): { x: number; y: number } {
        if (!module_) return { x: 0, y: 0 };
        const ptr = module_.tilemap_tileToWorld(entity, tx, ty, originX, originY);
        const floats = new Float32Array(module_.HEAPU8.buffer, ptr, 2);
        return { x: floats[0], y: floats[1] };
    },

    worldToTile(entity: number, wx: number, wy: number,
                originX: number, originY: number): { x: number; y: number } {
        if (!module_) return { x: 0, y: 0 };
        const ptr = module_.tilemap_worldToTile(entity, wx, wy, originX, originY);
        const floats = new Float32Array(module_.HEAPU8.buffer, ptr, 2);
        return { x: floats[0], y: floats[1] };
    },

    exportChunks(entity: number): string {
        return module_?.tilemap_exportChunks?.(entity) ?? '';
    },

    importChunks(entity: number, encoded: string): boolean {
        return module_?.tilemap_importChunks?.(entity, encoded) ?? false;
    },
};
