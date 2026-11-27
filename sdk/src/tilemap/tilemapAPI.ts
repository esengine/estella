// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { withMalloc } from '../wasm/wasmScratch';
import { WasmBridge } from '../wasm/WasmBridge';
import { worldEngineApi, type EngineApi } from '../ecs/bridge/engineApi';
import type { World } from '../ecs/world';
import { readCollisionChunks, type CollisionChunkSnapshot } from './nativeCollisionChunks';
import { defineResource } from '../ecs/resource';
import { isTileCoordinate, tileWorldToLocal } from './tileGeometry';

function isTileExtent(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

// The binding declarations supply the signatures on both hosts. Some older tilemap
// cores only expose the original layer API and use a full chunk export for collision.
type LayerCalls = Pick<EngineApi, Exclude<Extract<keyof EngineApi, `tilemap_${string}`>, `${string}InWorld`>>;
type OptionalCall = 'tilemap_initInfinite' | 'tilemap_exportChunks' | 'tilemap_importChunks' | 'tilemap_removeChunk'
    | 'tilemap_getGeneration' | 'tilemap_getEditRevision' | 'tilemap_readChunkIndex' | 'tilemap_readChunkTiles';
type TilemapModule = Required<Omit<LayerCalls, OptionalCall>> & Pick<LayerCalls, OptionalCall>
    & Required<Pick<EngineApi, 'HEAPU8' | '_malloc' | '_free'>>;

/** Guarded view of the core: after a wasm abort a call throws instead of reaching
 *  a dead module. A native host's bindings pass through the same channel and
 *  simply never abort. */
class TilemapBridge extends WasmBridge<NonNullable<EngineApi>> {
    protected readonly label = 'tilemap';
}

const worldCalls = [
    'tilemap_initLayerInWorld', 'tilemap_initInfiniteInWorld', 'tilemap_initInfiniteLayerInWorld',
    'tilemap_destroyLayerInWorld', 'tilemap_hasLayerInWorld', 'tilemap_getEditRevisionInWorld',
    'tilemap_getGenerationInWorld', 'tilemap_readChunkIndexInWorld', 'tilemap_readChunkTilesInWorld',
    'tilemap_setTileInWorld', 'tilemap_getTileInWorld', 'tilemap_fillRectInWorld',
    'tilemap_setTilesInWorld', 'tilemap_setChunkTilesInWorld', 'tilemap_removeChunkInWorld',
    'tilemap_flipTileInWorld', 'tilemap_rotateTileInWorld', 'tilemap_setTilesetsInWorld',
    'tilemap_setRenderPropsInWorld', 'tilemap_setTintInWorld', 'tilemap_setVisibleInWorld',
    'tilemap_setOriginEntityInWorld', 'tilemap_setGridTypeInWorld', 'tilemap_setHexParamsInWorld',
    'tilemap_tileToWorldInWorld', 'tilemap_worldToTileInWorld', 'tilemap_setTileAnimationInWorld',
    'tilemap_clearTileAnimationsInWorld', 'tilemap_advanceAnimationsInWorld',
    'tilemap_setTilePropertyInWorld', 'tilemap_getTilePropertyInWorld', 'tilemap_exportChunksInWorld',
    'tilemap_importChunksInWorld',
] as const satisfies ReadonlyArray<keyof EngineApi>;

function tilemapModule(engine: EngineApi, registry?: object | null): TilemapModule {
    const bridge = new TilemapBridge();
    bridge.connect(engine);
    const core = bridge.module;
    if (!registry || !('tilemap_initLayerInWorld' in engine)) return core as TilemapModule;

    // Inherit the live heap views and allocator. Bind each operation once, retaining the abort guard.
    const scoped = Object.create(core) as TilemapModule;
    for (const name of worldCalls) {
        const operation: ((registry: object, ...args: never[]) => unknown) | undefined = core[name];
        if (operation) Object.defineProperty(scoped, name.slice(0, -'InWorld'.length), {
            value: operation.bind(core, registry),
        });
    }
    return scoped;
}

const legacyOwner = {};
const worldTools = new WeakMap<World, TilemapToolkit>();
const bindings: Array<{ owner: object; world?: World; state: { module: TilemapModule | null } }> = [];
let module_: TilemapModule | null = null;

/** @internal Install this world's toolkit and make it available to host tools. */
export function initTilemapAPI(engine: EngineApi, owner: object = legacyOwner, world?: World): TilemapToolkit {
    shutdownTilemapAPI(owner);
    const state = { module: tilemapModule(engine, world?.getCppRegistry?.()) };
    bindings.push({ owner, world, state });
    module_ = state.module;
    const tiles = tilemapAPI(() => state.module);
    if (world) worldTools.set(world, tiles);
    return tiles;
}

/** @internal Release the retiring registry and restore the previous host toolkit. */
export function shutdownTilemapAPI(owner?: object): void {
    for (let i = bindings.length - 1; i >= 0; i--) {
        const binding = bindings[i];
        if (owner && binding.owner !== owner) continue;
        if (binding.world) worldTools.delete(binding.world);
        binding.state.module = null;
        bindings.splice(i, 1);
    }
    module_ = bindings[bindings.length - 1]?.state.module ?? null;
}

/**
 * u32s per slot in the `tilemap_setTilesets` buffer, in the order
 * [firstId, textureHandle, columns, margin, spacing, extrude]. Two files unpack
 * it and no generator spans them, so the number is named on both sides —
 * `TilemapBindings.cpp` is the other half.
 */
export const TILESET_SLOT_STRIDE = 6;

/**
 * Tile editing, serialization and collision reads over the same bound layer store.
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
        if (!isTileCoordinate(x) || !isTileCoordinate(y)) return;
        moduleOf()?.tilemap_setTile(entity, x, y, tileId);
    },

    getTile(entity: number, x: number, y: number): number {
        if (!isTileCoordinate(x) || !isTileCoordinate(y)) return 0;
        return moduleOf()?.tilemap_getTile(entity, x, y) ?? 0;
    },

    fillRect(entity: number, x: number, y: number,
             w: number, h: number, tileId: number): void {
        if (!isTileCoordinate(x) || !isTileCoordinate(y)) return;
        if (!isTileExtent(w) || !isTileExtent(h) || w === 0 || h === 0) return;
        moduleOf()?.tilemap_fillRect(entity, x, y, w, h, tileId);
    },

    /** Replace the layer's tiles. An empty buffer clears its tiles and keeps the layer. */
    setTiles(entity: number, tiles: Uint16Array): void {
        const m = moduleOf();
        if (!m) return;
        const bytes = tiles.byteLength;
        if (bytes === 0) {
            m.tilemap_setTiles(entity, 0, 0);
            return;
        }
        withMalloc(m, bytes, ptr => {
            new Uint16Array(m.HEAPU8.buffer, ptr, tiles.length).set(tiles);
            m.tilemap_setTiles(entity, ptr, tiles.length);
        });
    },

    /**
     * Replace the layer's multi-tileset table. Empty array reverts to single-tileset.
     * Hold an `assets.acquireTexture(ref, true, 'imported')` receipt for each file atlas the layer uses.
     * TILESET_SLOT_STRIDE and the field order below match the native `tilemap_setTilesets` table.
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
        if (!isTileCoordinate(x) || !isTileCoordinate(y)) return '';
        return moduleOf()?.tilemap_getTileProperty(entity, x, y, key) ?? '';
    },

    flipTile(entity: number, x: number, y: number,
             flipH: boolean, flipV: boolean, flipD: boolean): void {
        if (!isTileCoordinate(x) || !isTileCoordinate(y)) return;
        moduleOf()?.tilemap_flipTile(entity, x, y, flipH, flipV, flipD);
    },

    rotateTile(entity: number, x: number, y: number, degrees: number): void {
        if (!isTileCoordinate(x) || !isTileCoordinate(y)) return;
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

    /** Replace a chunk from a row-major buffer covering the declared width and height. */
    setChunkTiles(entity: number, chunkX: number, chunkY: number,
                  tiles: Uint16Array, width: number, height: number): void {
        if (!isTileCoordinate(chunkX) || !isTileCoordinate(chunkY)) return;
        if (!isTileExtent(width) || !isTileExtent(height)) return;
        const count = width * height;
        if (count > tiles.length) return;
        const m = moduleOf();
        if (!m) return;
        // Even an empty rectangle must supply a pointer to the chunk binding.
        const bytes = Math.max(1, count) * Uint16Array.BYTES_PER_ELEMENT;
        withMalloc(m, bytes, ptr => {
            if (!ptr) return;
            new Uint16Array(m.HEAPU8.buffer, ptr, count).set(count === tiles.length ? tiles : tiles.subarray(0, count));
            m.tilemap_setChunkTiles(entity, chunkX, chunkY, ptr, width, height);
        });
    },

    /**
     * Takes one chunk (16 by 16 tiles, in chunk coordinates) out of a layer, tiles and drawn mesh both. A world that is streamed in as it is walked
     * calls this for the chunks it has left behind, so the layer holds the ones near and not every one it ever held.
     */
    removeChunk(entity: number, chunkX: number, chunkY: number): void {
        if (!isTileCoordinate(chunkX) || !isTileCoordinate(chunkY)) return;
        moduleOf()?.tilemap_removeChunk?.(entity, chunkX, chunkY);
    },

    setGridType(entity: number, type: number): void {
        moduleOf()?.tilemap_setGridType(entity, type);
    },

    /** Hexagonal-grid layout inputs (Tiled hexsidelength/staggeraxis/staggerindex);
     *  only read when the layer's grid type is Hexagonal (3). */
    setHexParams(entity: number, sideLength: number, staggerAxisX: boolean, staggerIndexEven: boolean): void {
        moduleOf()?.tilemap_setHexParams(entity, sideLength, staggerAxisX ? 1 : 0, staggerIndexEven ? 1 : 0);
    },

    /** Grid anchor in world pixels; rotation is the layer's world Z angle in radians. */
    tileToWorld(entity: number, tx: number, ty: number,
                originX: number, originY: number, rotation = 0): { x: number; y: number } {
        if (!isTileCoordinate(tx) || !isTileCoordinate(ty)) return { x: 0, y: 0 };
        const module = moduleOf();
        if (!module) return { x: 0, y: 0 };
        const ptr = module.tilemap_tileToWorld(entity, tx, ty, 0, 0);
        const floats = new Float32Array(module.HEAPU8.buffer, ptr, 2);
        const x = floats[0], y = floats[1];
        // The core returns a zero anchor for an absent layer as well as for a valid origin cell.
        if (x === 0 && y === 0 && !module.tilemap_hasLayer(entity)) return { x: 0, y: 0 };
        if (rotation === 0) return { x: originX + x, y: originY + y };
        const c = Math.cos(rotation), s = Math.sin(rotation);
        return { x: originX + (c * x - s * y), y: originY + (s * x + c * y) };
    },

    /** Invert the layer origin and world Z rotation before reading its grid. */
    worldToTile(entity: number, wx: number, wy: number,
                originX: number, originY: number, rotation = 0): { x: number; y: number } {
        const module = moduleOf();
        if (!module) return { x: 0, y: 0 };
        const local = tileWorldToLocal(wx, wy, originX, originY, rotation);
        const ptr = module.tilemap_worldToTile(entity, local.x, local.y, 0, 0);
        const floats = new Float32Array(module.HEAPU8.buffer, ptr, 2);
        return { x: floats[0], y: floats[1] };
    },

    /** Generation of the current layer, when the core tracks it. */
    getGeneration(entity: number): number | undefined {
        return moduleOf()?.tilemap_getGeneration?.(entity);
    },

    /** Content revision for incremental readers of this layer. */
    getEditRevision(entity: number): number | undefined {
        return moduleOf()?.tilemap_getEditRevision?.(entity);
    },

    /** Copy changed collision chunks from this world. */
    readCollisionChunks(entity: number, previous: ReadonlyMap<string, CollisionChunkSnapshot> | null) {
        return readCollisionChunks(moduleOf(), entity, previous);
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

/** @internal Construct a toolkit without installing it as the current host. */
export function createTilemapAPI(engine: EngineApi, registry?: object | null): TilemapToolkit {
    const module = tilemapModule(engine, registry);
    return tilemapAPI(() => module);
}

/** Tile tools for the supplied world, including when several worlds share the same core.
 * @experimental
 */
export function tilemapsForWorld(world: World): TilemapToolkit {
    const installed = worldTools.get(world);
    if (installed) return installed;
    const registry = world.getCppRegistry?.();
    if (!registry) return TilemapAPI;
    const core = worldEngineApi(world);
    return core?.tilemap_initLayer ? createTilemapAPI(core, registry) : tilemapAPI(() => null);
}

/**
 * The canonical game-code accessor: `Res(Tilemaps)`, same shape as every other
 * subsystem resource. The tilemap plugin inserts its app's own toolkit; the
 * default is the host seam above, for a world with no tilemap plugin built.
 */
export const Tilemaps = defineResource<TilemapToolkit>(TilemapAPI, 'Tilemaps');
