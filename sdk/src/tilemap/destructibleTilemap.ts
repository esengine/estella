// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    destructibleTilemap.ts
 * @brief   A tile layer a game can change while it runs: digging, explosions, placing, and all that has to follow them.
 *
 * @details Every change goes through one write, so the drawn tiles, the collision (which follows the native edit revision by itself), the neighbouring autotiles,
 *          the navigation grids and the save can never disagree about a cell. What a save stores is the difference from the map the layer started as, kept
 *          by chunk, so a large world costs what was changed in it rather than what it holds, and a chunk streamed out and made again comes back as it was left.
 */
import type { App } from '../app/app';
import { NavGrid } from '../ai/nav/NavGrid';
import { TilemapLayer, Transform, type TilemapLayerData } from '../ecs/component';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { CHUNK_SIZE, recodeCell } from './chunkCodec';
import { buildTerrainIndices, resolveAutotileMatch, TERRAIN_NEIGHBORS } from './autotile';
import { tileIdOf, TILE_FLIP_D, TILE_FLIP_H, TILE_FLIP_V, TILE_ID_MASK } from './tileBits';
import { tileCellCenter, TilemapOrientation, type TileGridParams } from './tileGeometry';
import { tileCollisionTable } from './tileQuery';
import { Tilemaps, type TilemapToolkit } from './tilemapAPI';
import { TilemapRuntimeState } from './tilemapPlugin';
import type { TilesetAsset } from './tilesetAsset';

/** What made a cell change. @experimental */
export type TileEditCause = 'set' | 'dig' | 'explode' | 'retile' | 'load';

/** One cell's change. `before` and `after` are raw cells: tile id and flip flags. @experimental */
export interface TileEdit { x: number; y: number; before: number; after: number; cause: TileEditCause }

/** What a blow did to one cell. @experimental */
export interface TileHit {
    x: number;
    y: number;
    /** The raw cell the blow landed on. */
    tile: number;
    /** Damage the cell has taken, after this blow. 0 once it is destroyed. */
    damage: number;
    hardness: number;
    destroyed: boolean;
}

/** A cell's new look, or undefined to leave it. `read` answers any cell's raw value. @experimental */
export type TileRetile = (x: number, y: number, read: (x: number, y: number) => number) => number | undefined;

/** @experimental */
export interface DestructibleTilemapOptions {
    /**
     * Damage a tile takes to destroy, by tile id; `Infinity` cannot be destroyed. Defaults to the tile's `hardness` property
     * (from the `.estileset`, or Tiled), and 1 where it has none. Answers are remembered per tile id.
     */
    hardness?: number | ((tileId: number) => number);
    /** The cell a destroyed tile leaves, by tile id: rubble, a back wall. Defaults to empty. */
    replaceWith?: (tileId: number) => number;
    /** Keeps edges right around every change. See {@link peeringRetile}. */
    retile?: TileRetile;
    /** Generate colliders for exposed tiles only (see `TilemapRuntime.setCollisionOutline`). Defaults to on. */
    collisionOutline?: boolean;
    /** The layer's chunks come from {@link DestructibleTilemap.publishChunk}, so a chunk not yet published is not empty ground: nothing is written to it. */
    streamed?: boolean;
}

/** @experimental */
export interface TileExplosionOptions {
    /** How much weaker the rim is than the centre, 0 (flat) to 1 (nothing at the rim). Defaults to 1. */
    falloff?: number;
    /** Tiles on the way absorb the blast by their hardness, and one that cannot be destroyed stops it. Defaults to off. */
    shielded?: boolean;
}

/** @experimental */
export interface TileNavSyncOptions {
    /** The tile the grid's top-left cell stands on. Defaults to (0, 0). */
    tileX?: number;
    tileY?: number;
    /** Whether a tile id blocks. Defaults to the layer's collision (a sensor does not block), or any tile where it has none. */
    isBlocked?: (tileId: number) => boolean;
}

/** @experimental */
export interface TileNavGridOptions extends TileNavSyncOptions {
    width: number;
    height: number;
}

/** A layer's changes, as a save stores them. Plain JSON. @experimental */
export interface DestructibleTilemapData {
    version: 1;
    /** `[chunkSize, idMask, flipH, flipV, flipD]` the cells were written under. A later engine recodes them. */
    encoding: number[];
    /** `cells` and `damage` are flat `[cellIndex, value, ...]` pairs. */
    chunks: { x: number; y: number; cells: number[]; damage?: number[] }[];
}

interface CellChange { before: number | null; now: number }
interface ChunkState { x: number; y: number; cells: Map<number, CellChange>; damage: Map<number, number> }
interface NavBinding { grid: NavGrid; tileX: number; tileY: number; isBlocked: (tileId: number) => boolean }

const chunkOf = (v: number): number => Math.floor(v / CHUNK_SIZE);
const cellOf = (x: number, y: number): number =>
    (y - chunkOf(y) * CHUNK_SIZE) * CHUNK_SIZE + (x - chunkOf(x) * CHUNK_SIZE);
const ENCODING = [CHUNK_SIZE, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D];

/** One layer open to digging, explosions and building. Make one with {@link createDestructibleTilemap}. @experimental */
export class DestructibleTilemap {
    private readonly tiles_: TilemapToolkit;
    private readonly chunks_ = new Map<string, ChunkState>();
    private readonly hardness_ = new Map<number, number>();
    private readonly listeners_ = new Set<(edits: readonly TileEdit[]) => void>();
    private readonly navs_: NavBinding[] = [];
    private readonly resident_: Set<string> | null;

    /** @internal */
    constructor(private readonly app: App, readonly layer: Entity, private readonly options: DestructibleTilemapOptions) {
        this.tiles_ = app.getResource(Tilemaps);
        this.resident_ = options.streamed ? new Set() : null;
        if (options.collisionOutline !== false && app.hasResource(TilemapRuntimeState)) {
            app.getResource(TilemapRuntimeState).setCollisionOutline(layer, true);
        }
    }

    /** Told every operation's changes together, once it has finished. The returned function stops listening. */
    subscribe(listener: (edits: readonly TileEdit[]) => void): () => void {
        this.listeners_.add(listener);
        return () => { this.listeners_.delete(listener); };
    }

    /** The raw cell, flip flags included. */
    tileAt(x: number, y: number): number { return this.tiles_.getTile(this.layer, x, y); }

    /** Damage the cell's tile has taken so far. */
    damageAt(x: number, y: number): number {
        return this.chunks_.get(`${chunkOf(x)},${chunkOf(y)}`)?.damage.get(cellOf(x, y)) ?? 0;
    }

    /** How many cells differ from the map the layer started as. */
    get changedCells(): number {
        let n = 0;
        for (const chunk of this.chunks_.values()) n += chunk.cells.size;
        return n;
    }

    /** The cell under a world position, through the layer's origin, rotation and grid. */
    worldToTile(worldX: number, worldY: number): { x: number; y: number } {
        const local = this.toLocal_(worldX, worldY), t = this.tiles_.worldToTile(this.layer, local.x, local.y, 0, 0);
        return { x: Math.floor(t.x), y: Math.floor(t.y) };
    }

    /** Puts a raw cell down (0 clears it). Says whether anything changed. */
    set(x: number, y: number, tile: number): boolean {
        return this.setMany([{ x, y, tile }]).length > 0;
    }

    /** Changes many cells as one operation: autotiles settle and listeners hear once. Returns every change, autotile ones included. */
    setMany(cells: Iterable<{ x: number; y: number; tile: number }>): readonly TileEdit[] {
        const edits: TileEdit[] = [];
        for (const { x, y, tile } of cells) this.write_(x, y, tile, 'set', edits);
        return this.finish_(edits);
    }

    fillRect(x: number, y: number, width: number, height: number, tile: number): readonly TileEdit[] {
        const edits: TileEdit[] = [];
        for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) this.write_(tx, ty, tile, 'set', edits);
        return this.finish_(edits);
    }

    /** Lands a blow on one cell. Null when there is nothing to hit: an empty cell, or a tile that cannot be destroyed. */
    dig(x: number, y: number, power = Infinity): TileHit | null {
        const edits: TileEdit[] = [];
        const hit = this.hit_(x, y, power, 'dig', edits);
        this.finish_(edits);
        return hit;
    }

    digAtWorld(worldX: number, worldY: number, power = Infinity): TileHit | null {
        const t = this.worldToTile(worldX, worldY);
        return this.dig(t.x, t.y, power);
    }

    /**
     * Blasts a circle around a world position, `radius` in world units, measured from cell centres whatever the layer's orientation.
     * Every cell it reached comes back, destroyed or only damaged.
     */
    explode(worldX: number, worldY: number, radius: number, power: number, opts: TileExplosionOptions = {}): TileHit[] {
        if (!(radius > 0) || !(power > 0)) return [];
        const falloff = Math.min(1, Math.max(0, opts.falloff ?? 1));
        const centre = this.toLocal_(worldX, worldY), grid = this.grid_();
        const corner = (dx: number, dy: number) => this.tiles_.worldToTile(this.layer, centre.x + dx, centre.y + dy, 0, 0);
        const corners = [corner(-radius, -radius), corner(radius, -radius), corner(radius, radius), corner(-radius, radius)];
        const x0 = Math.floor(Math.min(...corners.map(c => c.x))) - 1, x1 = Math.ceil(Math.max(...corners.map(c => c.x))) + 1;
        const y0 = Math.floor(Math.min(...corners.map(c => c.y))) - 1, y1 = Math.ceil(Math.max(...corners.map(c => c.y))) + 1;
        const origin = corner(0, 0), ox = Math.floor(origin.x), oy = Math.floor(origin.y);
        // Every blow is worked out before any lands, so a cell's shelter is what stood when the blast began; the rays cross the same cells again and again.
        const standing = new Map<string, number>();
        const stood = (x: number, y: number): number => {
            const key = `${x},${y}`;
            let raw = standing.get(key);
            if (raw === undefined) { raw = this.tileAt(x, y); standing.set(key, raw); }
            return raw;
        };
        const blows: { x: number; y: number; amount: number }[] = [];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            if (tileIdOf(stood(x, y)) === 0) continue;
            const c = tileCellCenter(grid, x, y), distance = Math.hypot(c.x - centre.x, c.y - centre.y);
            if (distance > radius) continue;
            let amount = power * (1 - falloff * (distance / radius));
            if (opts.shielded) amount -= this.shelter_(ox, oy, x, y, stood);
            if (amount > 0) blows.push({ x, y, amount });
        }
        const edits: TileEdit[] = [], hits: TileHit[] = [];
        for (const blow of blows) {
            const hit = this.hit_(blow.x, blow.y, blow.amount, 'explode', edits);
            if (hit) hits.push(hit);
        }
        this.finish_(edits);
        return hits;
    }

    /**
     * Keeps `grid` matching the layer from now on: it is brought up to date here, and each later change flips only its own cell,
     * which is what sends agents to plan again. The returned function stops it.
     */
    syncNavGrid(grid: NavGrid, opts: TileNavSyncOptions = {}): () => void {
        const binding: NavBinding = { grid, tileX: opts.tileX ?? 0, tileY: opts.tileY ?? 0, isBlocked: opts.isBlocked ?? this.defaultBlocked_() };
        this.navs_.push(binding);
        for (let gy = 0; gy < grid.height; gy++) for (let gx = 0; gx < grid.width; gx++) {
            const x = binding.tileX + gx, y = binding.tileY + grid.height - 1 - gy;
            grid.setWalkable(gx, gy, !binding.isBlocked(tileIdOf(this.tileAt(x, y))));
        }
        return () => { const i = this.navs_.indexOf(binding); if (i >= 0) this.navs_.splice(i, 1); };
    }

    /** A grid over a rectangle of this layer, already placed where the layer is drawn and kept in step. Needs an orthogonal, unrotated layer with square cells. */
    createNavGrid(opts: TileNavGridOptions): NavGrid {
        const data = this.data_(), rotated = this.rotation_() !== 0;
        if (rotated || (data.orientation ?? 0) !== TilemapOrientation.Orthogonal || data.cellSize.x !== data.cellSize.y) {
            throw new Error('createNavGrid needs an orthogonal, unrotated tile layer with square cells');
        }
        const tileX = opts.tileX ?? 0, tileY = opts.tileY ?? 0;
        this.app.world.ensureTransformsComposed();
        const at = this.app.world.get(this.layer, Transform).worldPosition;
        const bottomLeft = tileCellCenter(this.grid_(), tileX, tileY + opts.height - 1);
        const grid = new NavGrid({
            width: opts.width, height: opts.height, cellSize: data.cellSize.x,
            origin: { x: at.x + data.originOffset.x + bottomLeft.x, y: at.y + data.originOffset.y + bottomLeft.y, z: at.z },
        });
        this.syncNavGrid(grid, opts);
        return grid;
    }

    /**
     * Shows one chunk of a streamed layer: what the generator made, with this layer's changes laid over it. `tiles` is the chunk's whole
     * row-major array and is not kept.
     */
    publishChunk(chunkX: number, chunkY: number, tiles: Uint16Array): void {
        const merged = tiles.slice(), state = this.chunks_.get(`${chunkX},${chunkY}`);
        for (const [cell, change] of state?.cells ?? []) {
            change.before = tiles[cell] ?? 0;
            if (change.before === change.now) state!.cells.delete(cell);
            else merged[cell] = change.now;
        }
        if (state) this.prune_(state);
        this.tiles_.setChunkTiles(this.layer, chunkX, chunkY, merged, CHUNK_SIZE, CHUNK_SIZE);
        this.resident_?.add(`${chunkX},${chunkY}`);
        for (let i = 0; i < merged.length; i++) {
            this.syncNav_(chunkX * CHUNK_SIZE + (i % CHUNK_SIZE), chunkY * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), merged[i]!);
        }
    }

    /** Lets one chunk go. Its changes are kept for when it is published again. */
    releaseChunk(chunkX: number, chunkY: number): void {
        this.resident_?.delete(`${chunkX},${chunkY}`);
        this.tiles_.removeChunk(this.layer, chunkX, chunkY);
    }

    /** What a save stores: only the cells that changed and the damage standing on them. */
    toJSON(): DestructibleTilemapData {
        const chunks = [...this.chunks_.values()].sort((a, b) => a.y - b.y || a.x - b.x).map(({ x, y, cells, damage }) => {
            const flat: number[] = [];
            for (const cell of [...cells.keys()].sort((a, b) => a - b)) flat.push(cell, cells.get(cell)!.now);
            const out: DestructibleTilemapData['chunks'][number] = { x, y, cells: flat };
            if (damage.size > 0) {
                out.damage = [];
                for (const cell of [...damage.keys()].sort((a, b) => a - b)) out.damage.push(cell, damage.get(cell)!);
            }
            return out;
        });
        return { version: 1, encoding: ENCODING.slice(), chunks };
    }

    /**
     * Replaces every change with a save's: what this session changed goes back first, so loading twice is loading once.
     * A save that does not read is refused whole, with `false` and the layer untouched.
     */
    load(data: DestructibleTilemapData): boolean {
        const decoded = decodeSave(data);
        if (!decoded) {
            log.error('tilemap', 'a destructible tilemap save was refused: it is damaged, or was written under an encoding that cannot hold its tiles.');
            return false;
        }
        const edits: TileEdit[] = [];
        for (const chunk of [...this.chunks_.values()]) {
            if (!this.isResident_(chunk.x, chunk.y)) continue;
            for (const [cell, change] of chunk.cells) {
                if (change.before === null) continue;
                this.write_(chunk.x * CHUNK_SIZE + (cell % CHUNK_SIZE), chunk.y * CHUNK_SIZE + Math.floor(cell / CHUNK_SIZE), change.before, 'load', edits);
            }
        }
        this.chunks_.clear();
        for (const { x, y, tile, damage } of decoded) {
            if (tile !== undefined) {
                if (this.isResident_(chunkOf(x), chunkOf(y))) this.write_(x, y, tile, 'load', edits);
                else this.state_(chunkOf(x), chunkOf(y)).cells.set(cellOf(x, y), { before: null, now: tile });
            }
            if (damage !== undefined) this.state_(chunkOf(x), chunkOf(y)).damage.set(cellOf(x, y), damage);
        }
        // A save holds the settled autotiles already, so it is not settled again.
        this.emit_(edits);
        return true;
    }

    /** Stops the grids and listeners. The layer stays as it is. */
    dispose(): void {
        this.navs_.length = 0;
        this.listeners_.clear();
    }

    private hit_(x: number, y: number, amount: number, cause: TileEditCause, edits: TileEdit[]): TileHit | null {
        if (!(amount > 0) || !this.isResident_(chunkOf(x), chunkOf(y))) return null;
        const tile = this.tileAt(x, y), id = tileIdOf(tile);
        if (id === 0) return null;
        const hardness = this.hardnessOf_(id, x, y);
        if (hardness === Infinity) return null;
        const state = this.chunks_.get(`${chunkOf(x)},${chunkOf(y)}`), cell = cellOf(x, y);
        const damage = (state?.damage.get(cell) ?? 0) + amount;
        if (damage < hardness) {
            this.state_(chunkOf(x), chunkOf(y)).damage.set(cell, damage);
            return { x, y, tile, damage, hardness, destroyed: false };
        }
        this.clearDamage_(x, y);
        const left = this.options.replaceWith?.(id) ?? 0;
        // A tile left as itself would never come down, and a hit would report one that did.
        this.write_(x, y, tileIdOf(left) === id ? 0 : left, cause, edits);
        return { x, y, tile, damage: 0, hardness, destroyed: true };
    }

    private write_(x: number, y: number, tile: number, cause: TileEditCause, edits: TileEdit[]): void {
        if (!this.isResident_(chunkOf(x), chunkOf(y))) return;
        const before = this.tileAt(x, y);
        if (before === tile) return;
        this.tiles_.setTile(this.layer, x, y, tile);
        // A finite layer drops a write past its edge without a word.
        if (tile !== 0 && this.tileAt(x, y) !== tile) return;
        const state = this.state_(chunkOf(x), chunkOf(y)), cell = cellOf(x, y), change = state.cells.get(cell);
        if (change) {
            change.now = tile;
            if (change.before === tile) state.cells.delete(cell);
        } else {
            state.cells.set(cell, { before, now: tile });
        }
        if (cause !== 'retile' && tileIdOf(before) !== tileIdOf(tile)) state.damage.delete(cell);
        this.prune_(state);
        this.syncNav_(x, y, tile);
        edits.push({ x, y, before, after: tile, cause });
    }

    /** Settles the autotiles around what changed, then tells the listeners. */
    private finish_(edits: TileEdit[]): readonly TileEdit[] {
        const retile = this.options.retile;
        if (retile && edits.length > 0) {
            const seen = new Set<string>(), read = (x: number, y: number) => this.tileAt(x, y);
            for (const { x, y } of edits.slice()) {
                for (const n of [{ dx: 0, dy: 0 }, ...TERRAIN_NEIGHBORS]) {
                    const cx = x + n.dx, cy = y + n.dy, key = `${cx},${cy}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (!this.neighbourhoodResident_(cx, cy) || tileIdOf(this.tileAt(cx, cy)) === 0) continue;
                    const next = retile(cx, cy, read);
                    if (next !== undefined) this.write_(cx, cy, next, 'retile', edits);
                }
            }
        }
        this.emit_(edits);
        return edits;
    }

    private emit_(edits: readonly TileEdit[]): void {
        if (edits.length > 0) for (const listener of [...this.listeners_]) listener(edits);
    }

    private syncNav_(x: number, y: number, tile: number): void {
        for (const nav of this.navs_) {
            const gx = x - nav.tileX, gy = nav.grid.height - 1 - (y - nav.tileY);
            if (nav.grid.inBounds(gx, gy)) nav.grid.setWalkable(gx, gy, !nav.isBlocked(tileIdOf(tile)));
        }
    }

    private defaultBlocked_(): (tileId: number) => boolean {
        return (id) => {
            if (id === 0) return false;
            const table = tileCollisionTable(this.layer);
            if (!table) return true;
            return table.boxIds.has(id) || (table.shapes.has(id) && !table.shapes.get(id)!.sensor);
        };
    }

    private hardnessOf_(id: number, x: number, y: number): number {
        const fixed = this.options.hardness;
        if (typeof fixed === 'number') return fixed;
        let value = this.hardness_.get(id);
        if (value === undefined) {
            const authored = fixed ? fixed(id) : Number(this.tiles_.getTileProperty(this.layer, x, y, 'hardness') || NaN);
            value = Number.isNaN(authored) ? 1 : authored;
            this.hardness_.set(id, value);
        }
        return value;
    }

    /** What the tiles between the blast's centre and a cell absorb. A straight run over tile coordinates, the cell itself and the centre excluded. */
    private shelter_(ox: number, oy: number, x: number, y: number, stood: (x: number, y: number) => number): number {
        const steps = Math.max(Math.abs(x - ox), Math.abs(y - oy));
        let absorbed = 0;
        for (let i = 1; i < steps; i++) {
            const tx = Math.round(ox + (x - ox) * i / steps), ty = Math.round(oy + (y - oy) * i / steps);
            const id = tileIdOf(stood(tx, ty));
            if (id !== 0) absorbed += this.hardnessOf_(id, tx, ty);
        }
        return absorbed;
    }

    private state_(x: number, y: number): ChunkState {
        const key = `${x},${y}`;
        let state = this.chunks_.get(key);
        if (!state) { state = { x, y, cells: new Map(), damage: new Map() }; this.chunks_.set(key, state); }
        return state;
    }

    private prune_(state: ChunkState): void {
        if (state.cells.size === 0 && state.damage.size === 0) this.chunks_.delete(`${state.x},${state.y}`);
    }

    private clearDamage_(x: number, y: number): void {
        const state = this.chunks_.get(`${chunkOf(x)},${chunkOf(y)}`);
        if (state) { state.damage.delete(cellOf(x, y)); this.prune_(state); }
    }

    private isResident_(chunkX: number, chunkY: number): boolean {
        return this.resident_ === null || this.resident_.has(`${chunkX},${chunkY}`);
    }

    /** A cell at the edge of what is loaded cannot tell its neighbours' terrain, so it keeps the look it was generated with. */
    private neighbourhoodResident_(x: number, y: number): boolean {
        if (this.resident_ === null) return true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!this.isResident_(chunkOf(x + dx), chunkOf(y + dy))) return false;
        }
        return true;
    }

    private data_(): TilemapLayerData {
        return this.app.world.get(this.layer, TilemapLayer) as TilemapLayerData;
    }

    private grid_(): TileGridParams {
        const data = this.data_();
        return {
            orientation: data.orientation ?? 0, tileWidth: data.cellSize.x, tileHeight: data.cellSize.y,
            hexSideLength: data.hexSideLength ?? 0, staggerAxisX: data.staggerAxis === 1, staggerIndexEven: data.staggerIndex === 1,
        };
    }

    private rotation_(): number {
        this.app.world.ensureTransformsComposed();
        const q = this.app.world.get(this.layer, Transform).worldRotation;
        return 2 * Math.atan2(q.z, q.w);
    }

    private toLocal_(worldX: number, worldY: number): { x: number; y: number } {
        this.app.world.ensureTransformsComposed();
        const transform = this.app.world.get(this.layer, Transform), offset = this.data_().originOffset;
        const dx = worldX - transform.worldPosition.x, dy = worldY - transform.worldPosition.y;
        const angle = this.rotation_(), c = Math.cos(angle), s = Math.sin(angle);
        return { x: dx * c + dy * s - offset.x, y: -dx * s + dy * c - offset.y };
    }
}

/** Every saved cell in tile coordinates, under this engine's encoding, or null when any of it does not read. */
function decodeSave(data: DestructibleTilemapData): { x: number; y: number; tile?: number; damage?: number }[] | null {
    if (data?.version !== 1 || !Array.isArray(data.encoding) || data.encoding.length !== 5 || !Array.isArray(data.chunks)) return null;
    const side = data.encoding[0]!;
    if (!Number.isInteger(side) || side <= 0 || !data.encoding.every(v => Number.isInteger(v) && v >= 0)) return null;
    const out: { x: number; y: number; tile?: number; damage?: number }[] = [];
    const read = (chunk: { x: number; y: number }, flat: number[], put: (at: { x: number; y: number }, value: number) => boolean): boolean => {
        if (flat.length % 2 !== 0) return false;
        for (let i = 0; i < flat.length; i += 2) {
            const cell = flat[i]!;
            if (!Number.isInteger(cell) || cell < 0 || cell >= side * side) return false;
            if (!put({ x: chunk.x * side + (cell % side), y: chunk.y * side + Math.floor(cell / side) }, flat[i + 1]!)) return false;
        }
        return true;
    };
    for (const chunk of data.chunks) {
        if (!Number.isInteger(chunk?.x) || !Number.isInteger(chunk?.y) || !Array.isArray(chunk.cells)) return null;
        if (!read(chunk, chunk.cells, (at, raw) => {
            if (!Number.isInteger(raw) || raw < 0 || raw > 0xffff) return false;
            const tile = recodeCell(raw, data.encoding);
            if (tile < 0) return false;
            out.push({ ...at, tile });
            return true;
        })) return null;
        if (chunk.damage !== undefined && (!Array.isArray(chunk.damage) || !read(chunk, chunk.damage, (at, damage) => {
            if (!(damage > 0) || !Number.isFinite(damage)) return false;
            out.push({ ...at, damage });
            return true;
        }))) return null;
    }
    return out;
}

/**
 * Opens a tile layer to change at runtime. The layer stays an ordinary layer: draw, collision and queries read it as they always do.
 * @experimental
 */
export function createDestructibleTilemap(app: App, layer: Entity, options: DestructibleTilemapOptions = {}): DestructibleTilemap {
    return new DestructibleTilemap(app, layer, options);
}

/**
 * Autotiling for a tileset's edge and corner terrains: a cell of a terrain takes the tile that matches which neighbours are still that terrain.
 * Wang terrains paint corner colours rather than peering, so they are the game's to answer with its own {@link TileRetile}.
 * @experimental
 */
export function peeringRetile(asset: TilesetAsset, firstId = 1): TileRetile {
    const { sets, tileTerrain } = buildTerrainIndices(asset);
    const setOf = (raw: number) => tileTerrain.get(tileIdOf(raw) - firstId + 1);
    return (x, y, read) => {
        const set = setOf(read(x, y)), index = set === undefined ? undefined : sets.get(set);
        if (!index) return undefined;
        const tileId = resolveAutotileMatch(index, TERRAIN_NEIGHBORS.map(n => setOf(read(x + n.dx, y + n.dy)) === set)).tileId;
        return tileId === 0 ? undefined : tileId + firstId - 1;
    };
}
