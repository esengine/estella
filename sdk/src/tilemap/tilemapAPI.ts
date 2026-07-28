// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { withMalloc } from '../wasm/wasmScratch';
import { WasmBridge } from '../wasm/WasmBridge';
import type { EngineApi } from '../ecs/bridge/engineApi';
import { defineResource } from '../ecs/resource';

/**
 * The tilemap entry points as a core that HAS tilemaps answers them — the shape
 * this file drives, spelled once. Both cores answer these names (embind on the
 * web, EHT-generated QuickJS wrappers on a device), and both carry the heap the
 * tile arrays cross through, so the toolkit below is core-agnostic.
 */
interface TilemapModule {
    tilemap_initLayer(entity: number, width: number, height: number,
                      tileWidth: number, tileHeight: number): void;
    tilemap_destroyLayer(entity: number): void;
    tilemap_setTile(entity: number, x: number, y: number, tileId: number): void;
    tilemap_getTile(entity: number, x: number, y: number): number;
    tilemap_fillRect(entity: number, x: number, y: number,
                     w: number, h: number, tileId: number): void;
    tilemap_setTiles(entity: number, tilesPtr: number, count: number): void;
    tilemap_setTilesets(entity: number, dataPtr: number, count: number): void;
    tilemap_hasLayer(entity: number): boolean;
    tilemap_setRenderProps(entity: number, textureHandle: number, tilesetColumns: number,
                           uvTileW: number, uvTileH: number,
                           sortLayer: number, depth: number,
                           parallaxX: number, parallaxY: number): void;
    tilemap_setTint(entity: number, r: number, g: number, b: number, a: number,
                    opacity: number): void;
    tilemap_setVisible(entity: number, visible: boolean): void;
    tilemap_setOriginEntity(layerKey: number, originEntity: number): void;

    tilemap_setTileAnimation(entity: number, tileId: number,
                              framesPtr: number, frameCount: number): void;
    tilemap_clearTileAnimations(entity: number): void;
    tilemap_advanceAnimations(entity: number, dtMs: number): void;
    tilemap_setTileProperty(entity: number, tileId: number,
                             key: string, value: string): void;
    tilemap_getTileProperty(entity: number, x: number, y: number,
                             key: string): string;
    tilemap_flipTile(entity: number, x: number, y: number,
                      flipH: boolean, flipV: boolean, flipD: boolean): void;
    tilemap_rotateTile(entity: number, x: number, y: number, degrees: number): void;
    tilemap_setGridType(entity: number, type: number): void;
    tilemap_setHexParams(entity: number, sideLength: number, staggerAxisX: number, staggerIndexEven: number): void;
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


    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

/** Guarded view of the core: after a wasm abort a call throws instead of reaching
 *  a dead module. A native host's bindings pass through the same channel and
 *  simply never abort. */
class TilemapBridge extends WasmBridge<NonNullable<EngineApi>> {
    protected readonly label = 'tilemap';
}

const bridge = new TilemapBridge();
let module_: TilemapModule | null = null;

/** @internal Wired by the engine plugins — not part of the public API.
 *  Takes whichever core is present (see ecs/engineApi.ts); the plugin only calls
 *  this once it has checked that the core compiles tilemaps, which is what makes
 *  the narrowing below sound. */
export function initTilemapAPI(engine: NonNullable<EngineApi>): void {
    bridge.connect(engine);
    module_ = bridge.module as unknown as TilemapModule;
}

/** @internal Wired by the engine plugins — not part of the public API. */
export function shutdownTilemapAPI(): void {
    bridge.disconnect();
    module_ = null;
}

/**
 * The static tilemap toolkit — chunk/tile accessors over the wasm module,
 * addressed by runtime layer handle. Contract: game code reads this as the
 * `Res(Tilemaps)` resource like every other subsystem; direct `TilemapAPI.*`
 * calls are the host/tooling surface (the editor's tile tools, tests) where no
 * App is in scope. Both names are the same object.
 */
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
        const m = module_;
        if (!m) return;
        const bytes = tiles.byteLength;
        withMalloc(m, bytes, ptr => {
            new Uint16Array(m.HEAPU8.buffer, ptr, tiles.length).set(tiles);
            m.tilemap_setTiles(entity, ptr, tiles.length);
        });
    },

    /** Replace the layer's multi-tileset table. Empty array reverts to single-tileset. */
    setTilesets(entity: number, slots: { firstId: number; textureHandle: number; columns: number; margin?: number; spacing?: number }[]): void {
        const m = module_;
        if (!m) return;
        const STRIDE = 5;
        const packed = new Uint32Array(slots.length * STRIDE);
        for (let i = 0; i < slots.length; i++) {
            packed[i * STRIDE] = slots[i].firstId;
            packed[i * STRIDE + 1] = slots[i].textureHandle;
            packed[i * STRIDE + 2] = slots[i].columns;
            packed[i * STRIDE + 3] = slots[i].margin ?? 0;
            packed[i * STRIDE + 4] = slots[i].spacing ?? 0;
        }
        withMalloc(m, packed.byteLength, ptr => {
            new Uint32Array(m.HEAPU8.buffer, ptr, packed.length).set(packed);
            m.tilemap_setTilesets(entity, ptr, slots.length);
        });
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

    setTileAnimation(entity: number, tileId: number,
                     frames: { tileId: number; duration: number }[]): void {
        const m = module_;
        if (!m || frames.length === 0) return;
        const buf = new Uint32Array(frames.length * 2);
        for (let i = 0; i < frames.length; i++) {
            buf[i * 2] = frames[i].tileId;
            buf[i * 2 + 1] = frames[i].duration;
        }
        const bytes = buf.byteLength;
        withMalloc(m, bytes, ptr => {
            new Uint32Array(m.HEAPU8.buffer, ptr, buf.length).set(buf);
            m.tilemap_setTileAnimation(entity, tileId, ptr, frames.length);
        });
    },

    /** Drop every tile animation on the layer (a tileset swap re-adds the new set's). */
    clearTileAnimations(entity: number): void {
        module_?.tilemap_clearTileAnimations(entity);
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
        const m = module_;
        if (!m) return;
        const bytes = tiles.byteLength;
        withMalloc(m, bytes, ptr => {
            new Uint16Array(m.HEAPU8.buffer, ptr, tiles.length).set(tiles);
            m.tilemap_setChunkTiles(entity, chunkX, chunkY, ptr, width, height);
        });
    },

    setGridType(entity: number, type: number): void {
        module_?.tilemap_setGridType(entity, type);
    },

    /** Hexagonal-grid layout inputs (Tiled hexsidelength/staggeraxis/staggerindex);
     *  only read when the layer's grid type is Hexagonal (3). */
    setHexParams(entity: number, sideLength: number, staggerAxisX: boolean, staggerIndexEven: boolean): void {
        module_?.tilemap_setHexParams(entity, sideLength, staggerAxisX ? 1 : 0, staggerIndexEven ? 1 : 0);
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

/**
 * The canonical game-code accessor: `Res(Tilemaps)`, same shape as every other
 * subsystem resource. Wraps the {@link TilemapAPI} singleton — see its doc for
 * when direct use is appropriate.
 */
export const Tilemaps = defineResource<typeof TilemapAPI>(TilemapAPI, 'Tilemaps');
