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
/**
 * u32s per slot in the `tilemap_setTilesets` buffer, in the order
 * [firstId, textureHandle, columns, margin, spacing, extrude]. Two files unpack
 * it and no generator spans them, so the number is named on both sides —
 * `TilemapBindings.cpp` is the other half.
 */
export const TILESET_SLOT_STRIDE = 6;

/**
 * The tilemap toolkit over ONE engine core.
 *
 * A factory rather than a singleton: an editor world and a play world are two
 * apps with two cores, and a module-level `module_` answered both with whichever
 * initialised last — so one app's reads went to the other's engine.
 */
function tilemapAPI(moduleOf: () => TilemapModule | null) {
  return {
    initLayer(entity: number, width: number, height: number,
              tileWidth: number, tileHeight: number): void {
        moduleOf()?.tilemap_initLayer(entity, width, height, tileWidth, tileHeight);
    },

    destroyLayer(entity: number): void {
        moduleOf()?.tilemap_destroyLayer(entity);
    },

    setTile(entity: number, x: number, y: number, tileId: number): void {
        moduleOf()?.tilemap_setTile(entity, x, y, tileId);
    },

    getTile(entity: number, x: number, y: number): number {
        if (!moduleOf()) return 0;
        return moduleOf()!.tilemap_getTile(entity, x, y);
    },

    fillRect(entity: number, x: number, y: number,
             w: number, h: number, tileId: number): void {
        moduleOf()?.tilemap_fillRect(entity, x, y, w, h, tileId);
    },

    setTiles(entity: number, tiles: Uint16Array): void {
        const m = moduleOf();
        if (!m) return;
        const bytes = tiles.byteLength;
        withMalloc(m, bytes, ptr => {
            new Uint16Array(m.HEAPU8.buffer, ptr, tiles.length).set(tiles);
            m.tilemap_setTiles(entity, ptr, tiles.length);
        });
    },

    /**
     * Replace the layer's multi-tileset table. Empty array reverts to single-tileset.
     *
     * The packed field ORDER is the contract with `tilemap_setTilesets`, and it is
     * written down here and read there — see TILESET_SLOT_STRIDE.
     */
    setTilesets(entity: number, slots: {
        firstId: number; textureHandle: number; columns: number;
        margin?: number; spacing?: number; extrude?: number;
    }[]): void {
        const m = moduleOf();
        if (!m) return;
        const STRIDE = TILESET_SLOT_STRIDE;
        const packed = new Uint32Array(slots.length * STRIDE);
        for (let i = 0; i < slots.length; i++) {
            packed[i * STRIDE] = slots[i].firstId;
            packed[i * STRIDE + 1] = slots[i].textureHandle;
            packed[i * STRIDE + 2] = slots[i].columns;
            packed[i * STRIDE + 3] = slots[i].margin ?? 0;
            packed[i * STRIDE + 4] = slots[i].spacing ?? 0;
            packed[i * STRIDE + 5] = slots[i].extrude ?? 0;
        }
        withMalloc(m, packed.byteLength, ptr => {
            new Uint32Array(m.HEAPU8.buffer, ptr, packed.length).set(packed);
            m.tilemap_setTilesets(entity, ptr, slots.length);
        });
    },

    hasLayer(entity: number): boolean {
        if (!moduleOf()) return false;
        return moduleOf()!.tilemap_hasLayer(entity);
    },

    setRenderProps(entity: number, textureHandle: number, tilesetColumns: number,
                   uvTileW: number, uvTileH: number,
                   sortLayer: number, depth: number,
                   parallaxX: number, parallaxY: number): void {
        moduleOf()?.tilemap_setRenderProps(entity, textureHandle, tilesetColumns,
            uvTileW, uvTileH, sortLayer, depth, parallaxX, parallaxY);
    },

    setTint(entity: number, r: number, g: number, b: number, a: number,
            opacity: number): void {
        moduleOf()?.tilemap_setTint(entity, r, g, b, a, opacity);
    },

    setVisible(entity: number, visible: boolean): void {
        moduleOf()?.tilemap_setVisible(entity, visible);
    },

    setOriginEntity(layerKey: number, originEntity: number): void {
        moduleOf()?.tilemap_setOriginEntity(layerKey, originEntity);
    },

    setTileAnimation(entity: number, tileId: number,
                     frames: { tileId: number; duration: number }[]): void {
        const m = moduleOf();
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
        moduleOf()?.tilemap_clearTileAnimations(entity);
    },

    advanceAnimations(entity: number, dtMs: number): void {
        moduleOf()?.tilemap_advanceAnimations(entity, dtMs);
    },

    setTileProperty(entity: number, tileId: number,
                    key: string, value: string): void {
        moduleOf()?.tilemap_setTileProperty(entity, tileId, key, value);
    },

    getTileProperty(entity: number, x: number, y: number, key: string): string {
        if (!moduleOf()) return '';
        return moduleOf()!.tilemap_getTileProperty(entity, x, y, key);
    },

    flipTile(entity: number, x: number, y: number,
             flipH: boolean, flipV: boolean, flipD: boolean): void {
        moduleOf()?.tilemap_flipTile(entity, x, y, flipH, flipV, flipD);
    },

    rotateTile(entity: number, x: number, y: number, degrees: number): void {
        moduleOf()?.tilemap_rotateTile(entity, x, y, degrees);
    },

    initInfiniteLayer(entity: number, tileWidth: number, tileHeight: number): void {
        // Prefer the idempotent binding so a second call doesn't wipe tiles.
        const m = moduleOf();
        if (m?.tilemap_initInfinite) {
            m.tilemap_initInfinite(entity, tileWidth, tileHeight);
            return;
        }
        moduleOf()?.tilemap_initInfiniteLayer(entity, tileWidth, tileHeight);
    },

    setChunkTiles(entity: number, chunkX: number, chunkY: number,
                  tiles: Uint16Array, width: number, height: number): void {
        const m = moduleOf();
        if (!m) return;
        const bytes = tiles.byteLength;
        withMalloc(m, bytes, ptr => {
            new Uint16Array(m.HEAPU8.buffer, ptr, tiles.length).set(tiles);
            m.tilemap_setChunkTiles(entity, chunkX, chunkY, ptr, width, height);
        });
    },

    setGridType(entity: number, type: number): void {
        moduleOf()?.tilemap_setGridType(entity, type);
    },

    /** Hexagonal-grid layout inputs (Tiled hexsidelength/staggeraxis/staggerindex);
     *  only read when the layer's grid type is Hexagonal (3). */
    setHexParams(entity: number, sideLength: number, staggerAxisX: boolean, staggerIndexEven: boolean): void {
        moduleOf()?.tilemap_setHexParams(entity, sideLength, staggerAxisX ? 1 : 0, staggerIndexEven ? 1 : 0);
    },

    tileToWorld(entity: number, tx: number, ty: number,
                originX: number, originY: number): { x: number; y: number } {
        if (!moduleOf()) return { x: 0, y: 0 };
        const m0 = moduleOf()!;
        const ptr = m0.tilemap_tileToWorld(entity, tx, ty, originX, originY);
        const floats = new Float32Array(m0.HEAPU8.buffer, ptr, 2);
        return { x: floats[0], y: floats[1] };
    },

    worldToTile(entity: number, wx: number, wy: number,
                originX: number, originY: number): { x: number; y: number } {
        if (!moduleOf()) return { x: 0, y: 0 };
        const m0 = moduleOf()!;
        const ptr = m0.tilemap_worldToTile(entity, wx, wy, originX, originY);
        const floats = new Float32Array(m0.HEAPU8.buffer, ptr, 2);
        return { x: floats[0], y: floats[1] };
    },

    exportChunks(entity: number): string {
        return moduleOf()?.tilemap_exportChunks?.(entity) ?? '';
    },

    importChunks(entity: number, encoded: string): boolean {
        return moduleOf()?.tilemap_importChunks?.(entity, encoded) ?? false;
    },
  };
}

/** The tilemap toolkit's shape, however it was bound. */
export type TilemapToolkit = ReturnType<typeof tilemapAPI>;

/**
 * The host/tooling seam: the editor's tile tools and tests reach the core that
 * {@link initTilemapAPI} bound, where no App is in scope. Game code reads
 * `Res(Tilemaps)`, which is its own app's.
 */
export const TilemapAPI: TilemapToolkit = tilemapAPI(() => module_);

/** @internal One toolkit per App, over that app's core. */
export function createTilemapAPI(engine: NonNullable<EngineApi>): TilemapToolkit {
    const own = new TilemapBridge();
    own.connect(engine);
    const module = own.module as unknown as TilemapModule;
    return tilemapAPI(() => module);
}

/**
 * The canonical game-code accessor: `Res(Tilemaps)`, same shape as every other
 * subsystem resource. The tilemap plugin inserts its app's own toolkit; the
 * default is the host seam above, for a world with no tilemap plugin built.
 */
export const Tilemaps = defineResource<TilemapToolkit>(TilemapAPI, 'Tilemaps');
