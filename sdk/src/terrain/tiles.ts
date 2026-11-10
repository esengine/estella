// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tiles.ts
 * @brief   An area's ground kept as tiles (`.esterrain`): a coarse overview always in memory, and full-detail tiles read near where
 *          they are looked at and let go, least recently used first, past a budget.
 *
 * @details Tiles share their edge samples, so tile (tx, tz) of `tileSamples` a side covers the area's samples
 *          [tx (tileSamples - 1), (tx + 1)(tileSamples - 1)] along x and the same along z. A page as coarse as the overview or coarser is
 *          made from it alone; a finer one waits for the tiles it covers. A height where no tile is in memory is not known yet (null),
 *          as with a provider: collision and queries try again once it is.
 */
import { paintWeights } from './paint';
import { HeightmapFormat, heightfieldFromPixels, type Heightfield } from './heightfield';
import type { TerrainData } from './terrainPlugin';
import type { LayerWeights, Splat, TerrainRegionSamples, TerrainSource } from './source';

/** One tile of a `.esterrain`, by its place in the grid and the project paths of its images. @experimental */
export interface TerrainTileEntry { x: number; z: number; height: string; splat?: string; splat2?: string }

/** A `.esterrain` document. @experimental */
export interface TerrainTilesDocument {
    version: 1;
    /** Samples along a tile's side, its edges shared with its neighbours. */
    tileSamples: number;
    tilesX: number;
    tilesZ: number;
    /** How the tile and overview images hold their heights: a {@link HeightmapFormat}. */
    format: number;
    /** The whole area at low detail, always in memory: what distant ground is drawn from. */
    overview: string;
    overviewSplat?: string;
    overviewSplat2?: string;
    tiles: TerrainTileEntry[];
}

/** An image's pixels as the terrain reads them. */
export interface TerrainImage { width: number; height: number; pixels: Uint8Array; wide?: Uint16Array }

/** What a tiled ground holds in memory and is reading. @experimental */
export interface TerrainTileStats { resident: number; reading: number; bytes: number; reads: number; evictions: number }

/** A `.esterrain` checked, or a message naming what is wrong with it. */
export function parseTerrainTiles(json: unknown, file = 'terrain tiles'): TerrainTilesDocument {
    const o = json as Partial<TerrainTilesDocument> | null;
    if (!o || typeof o !== 'object' || o.version !== 1) throw new Error(`${file}: not a version 1 terrain`);
    const whole = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
    if (!whole(o.tileSamples, 3) || !whole(o.tilesX, 1) || !whole(o.tilesZ, 1)) throw new Error(`${file}: tileSamples, tilesX and tilesZ must be whole numbers`);
    if (typeof o.overview !== 'string' || !o.overview) throw new Error(`${file}: names no overview image`);
    if (!Array.isArray(o.tiles)) throw new Error(`${file}: has no tile list`);
    const seen = new Set<string>();
    for (const t of o.tiles) {
        if (!whole(t?.x, 0) || !whole(t?.z, 0) || t.x >= o.tilesX || t.z >= o.tilesZ || typeof t.height !== 'string') {
            throw new Error(`${file}: tile ${JSON.stringify(t)} is outside the ${o.tilesX} by ${o.tilesZ} grid or names no heights`);
        }
        if (seen.has(`${t.x}:${t.z}`)) throw new Error(`${file}: tile ${t.x}, ${t.z} is listed twice`);
        seen.add(`${t.x}:${t.z}`);
    }
    return { version: 1, tileSamples: o.tileSamples, tilesX: o.tilesX, tilesZ: o.tilesZ, format: o.format ?? HeightmapFormat.RedGreen16,
        overview: o.overview, overviewSplat: o.overviewSplat, overviewSplat2: o.overviewSplat2, tiles: o.tiles };
}

/** @internal One tile in memory. */
export interface Tile { field: Heightfield; splat: Splat | null; splat2: Splat | null; bytes: number; used: number }

type Params = Pick<TerrainData, 'sizeX' | 'sizeZ' | 'height' | 'rockSlope' | 'dirtHeight' | 'snowHeight'>;

/** The default most a tiled ground keeps of its full-detail tiles in memory. */
export const TERRAIN_TILE_BUDGET = 256 * 1024 * 1024;

/** An area's ground read from tiles. @experimental */
export class TiledSource implements TerrainSource {
    readonly infinite = false;
    readonly bounds: readonly [number, number, number, number];
    readonly minHeight = 0;
    readonly maxHeight: number;
    /** Samples along the whole area's sides. */
    readonly samplesX: number;
    readonly samplesZ: number;
    private readonly entries_ = new Map<string, TerrainTileEntry>();
    private readonly tiles_ = new Map<string, Tile>();
    private readonly reading_ = new Map<string, Promise<Tile | null>>();
    private readonly dirty_ = new Set<string>();
    private overviewDirty_ = false;
    private clock_ = 0;
    private bytes_ = 0;
    private reads_ = 0;
    private evictions_ = 0;

    constructor(
        readonly doc: TerrainTilesDocument,
        private readonly params: Params,
        readonly overview: Heightfield,
        private overviewSplat: Splat | null,
        private overviewSplat2: Splat | null,
        private readonly read: (path: string) => Promise<TerrainImage | null>,
        readonly budget = TERRAIN_TILE_BUDGET,
    ) {
        this.bounds = [-params.sizeX / 2, -params.sizeZ / 2, params.sizeX / 2, params.sizeZ / 2];
        this.maxHeight = params.height;
        this.samplesX = doc.tilesX * (doc.tileSamples - 1) + 1;
        this.samplesZ = doc.tilesZ * (doc.tileSamples - 1) + 1;
        for (const t of doc.tiles) this.entries_.set(`${t.x}:${t.z}`, t);
    }

    stats(): TerrainTileStats {
        return { resident: this.tiles_.size, reading: this.reading_.size, bytes: this.bytes_, reads: this.reads_, evictions: this.evictions_ };
    }

    /** Bytes the overview holds, which stay for as long as the ground does. */
    get overviewBytes(): number {
        return this.overview.data.byteLength + (this.overviewSplat?.pixels.byteLength ?? 0) + (this.overviewSplat2?.pixels.byteLength ?? 0);
    }

    /** The world-unit spacing of the overview's samples along x: pages this coarse or coarser are made from it alone. */
    get overviewSpacing(): number {
        return this.params.sizeX / Math.max(this.overview.width - 1, 1);
    }

    height(x: number, z: number): number | null {
        const at = this.locate(x, z), tile = this.tile(at.key);
        if (!tile) {
            void this.ensure(at.key);
            return null;
        }
        return this.params.height * bilinear(tile.field.data, tile.field.width, at.lx, at.lz);
    }

    normal(x: number, z: number): [number, number, number] | null {
        const e = this.params.sizeX / (this.samplesX - 1);
        const l = this.height(x - e, z), r = this.height(x + e, z), d = this.height(x, z - e), u = this.height(x, z + e);
        if (l === null || r === null || d === null || u === null) return null;
        const sx = (r - l) / (2 * e), sz = (u - d) / (2 * e), len = Math.hypot(sx, 1, sz);
        return [-sx / len, 1 / len, -sz / len];
    }

    paint(x: number, z: number, h: number, ny: number): LayerWeights {
        const at = this.locate(x, z), tile = this.tile(at.key);
        const u = x / this.params.sizeX + 0.5, v = z / this.params.sizeZ + 0.5;
        if (tile?.splat) return weights(tile.splat, tile.splat2, at.lx / (this.doc.tileSamples - 1), at.lz / (this.doc.tileSamples - 1));
        if (this.overviewSplat) return weights(this.overviewSplat, this.overviewSplat2, u, v);
        return paintWeights((h - this.minHeight) / Math.max(this.maxHeight, 1e-6), ny, this.params);
    }

    region(x0: number, z0: number, spacing: number, count: number): TerrainRegionSamples | Promise<TerrainRegionSamples> {
        if (spacing >= this.overviewSpacing * 0.999) return this.fromOverview(x0, z0, spacing, count);
        const far = x0 + spacing * (count - 1), farZ = z0 + spacing * (count - 1);
        const keys = this.keysOver(x0, z0, far, farZ);
        const missing = keys.filter((k) => !this.tiles_.has(k) && this.entries_.has(k));
        for (const k of keys) this.tile(k);
        if (missing.length === 0) return this.fromTiles(x0, z0, spacing, count);
        return Promise.all(missing.map((k) => this.ensure(k))).then(() => {
            for (const k of keys) this.tile(k);
            return this.fromTiles(x0, z0, spacing, count);
        });
    }

    /** Lets go of tiles, least recently used first, until what is held is within the budget; those in `keep` stay. */
    trim(keep: ReadonlySet<string> = new Set()): void {
        if (this.bytes_ <= this.budget) return;
        const order = [...this.tiles_].filter(([k]) => !keep.has(k) && !this.dirty_.has(k)).sort((a, b) => a[1].used - b[1].used);
        for (const [key, tile] of order) {
            if (this.bytes_ <= this.budget) break;
            this.tiles_.delete(key);
            this.bytes_ -= tile.bytes;
            this.evictions_++;
        }
    }

    /** @internal The tile at (tx, tz) if it is in memory. */
    tileAt(tx: number, tz: number): Tile | undefined {
        return this.tile(`${tx}:${tz}`);
    }

    /** @internal Reads the tile at (tx, tz) if it is not in memory; null where the document has none. */
    readTile(tx: number, tz: number): Promise<Tile | null> {
        return this.ensure(`${tx}:${tz}`);
    }

    /** @internal Whether the document has a tile at (tx, tz). */
    hasTile(tx: number, tz: number): boolean {
        return this.entries_.has(`${tx}:${tz}`);
    }

    /** @internal Keeps a changed tile in memory until {@link markSaved}: a tile let go with changes in it would lose them. */
    markDirty(tx: number, tz: number): void {
        this.dirty_.add(`${tx}:${tz}`);
    }

    /** @internal The tiles changed since they were read or last saved. */
    dirtyTiles(): string[] {
        return [...this.dirty_].sort();
    }

    /** @internal Whether the overview has changed since it was read or last saved. */
    get overviewDirty(): boolean {
        return this.overviewDirty_;
    }

    /** @internal */
    markOverviewDirty(): void {
        this.overviewDirty_ = true;
    }

    /** @internal Lets saved tiles go again. */
    markSaved(): void {
        this.dirty_.clear();
        this.overviewDirty_ = false;
        this.trim();
    }

    /** @internal Gives a tile in memory its splatmaps where it has none, painted as the ground is painted now. */
    ensureTileSplats(tile: Tile, tx: number, tz: number, second: boolean): void {
        const t = this.doc.tileSamples, n = t - 1;
        const make = (layers: number): Splat => {
            const pixels = new Uint8Array(t * t * 4);
            for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) {
                const x = ((tx * n + i) / (this.samplesX - 1) - 0.5) * this.params.sizeX, z = ((tz * n + j) / (this.samplesZ - 1) - 0.5) * this.params.sizeZ;
                const h = this.params.height * tile.field.data[j * t + i]!;
                const w = this.paint(x, z, h, this.normal(x, z)?.[1] ?? 1);
                for (let c = 0; c < 4; c++) pixels[(j * t + i) * 4 + c] = Math.round(Math.min(Math.max(w[c + layers] ?? 0, 0), 1) * 255);
            }
            return { width: t, height: t, pixels };
        };
        if (!tile.splat) { tile.splat = make(0); tile.bytes += tile.splat.pixels.byteLength; this.bytes_ += tile.splat.pixels.byteLength; }
        if (second && !tile.splat2) { tile.splat2 = make(4); tile.bytes += tile.splat2.pixels.byteLength; this.bytes_ += tile.splat2.pixels.byteLength; }
    }

    /** @internal The overview's splatmaps, made at the overview's size where it has none. */
    overviewSplats(make: boolean, second: boolean): { a: Splat | null; b: Splat | null } {
        const w = this.overview.width, h = this.overview.height;
        if (make && !this.overviewSplat) {
            const pixels = new Uint8Array(w * h * 4), d = this.overview.data, ex = this.params.sizeX / (w - 1), ez = this.params.sizeZ / (h - 1);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const at = (ii: number, jj: number) => d[Math.min(Math.max(jj, 0), h - 1) * w + Math.min(Math.max(ii, 0), w - 1)]! * this.params.height;
                const sx = (at(i + 1, j) - at(i - 1, j)) / (2 * ex), sz = (at(i, j + 1) - at(i, j - 1)) / (2 * ez);
                const weights = paintWeights(d[j * w + i]!, 1 / Math.hypot(sx, 1, sz), this.params);
                for (let c = 0; c < 4; c++) pixels[(j * w + i) * 4 + c] = Math.round(weights[c]! * 255);
            }
            this.overviewSplat = { width: w, height: h, pixels };
        }
        if (make && second && !this.overviewSplat2) this.overviewSplat2 = { width: w, height: h, pixels: new Uint8Array(w * h * 4) };
        return { a: this.overviewSplat, b: this.overviewSplat2 };
    }

    private tile(key: string): Tile | undefined {
        const t = this.tiles_.get(key);
        if (t) t.used = ++this.clock_;
        return t;
    }

    private ensure(key: string): Promise<Tile | null> {
        const have = this.tiles_.get(key);
        if (have) return Promise.resolve(have);
        const reading = this.reading_.get(key);
        if (reading) return reading;
        const entry = this.entries_.get(key);
        if (!entry) return Promise.resolve(null);
        const job = (async (): Promise<Tile | null> => {
            const [h, a, b] = await Promise.all([this.read(entry.height), entry.splat ? this.read(entry.splat) : null, entry.splat2 ? this.read(entry.splat2) : null]);
            if (!h) throw new Error(`the heights of terrain tile ${key} (${entry.height}) could not be read`);
            if (h.width !== this.doc.tileSamples || h.height !== this.doc.tileSamples) {
                throw new Error(`terrain tile ${key} is ${h.width} by ${h.height}, not ${this.doc.tileSamples} a side`);
            }
            const field = heightfieldFromPixels(h.width, h.height, h.pixels, this.doc.format, h.wide);
            const splat = a && { width: a.width, height: a.height, pixels: a.pixels };
            const splat2 = b && { width: b.width, height: b.height, pixels: b.pixels };
            const tile: Tile = { field, splat, splat2, used: ++this.clock_,
                bytes: field.data.byteLength + (splat?.pixels.byteLength ?? 0) + (splat2?.pixels.byteLength ?? 0) };
            this.tiles_.set(key, tile);
            this.bytes_ += tile.bytes;
            this.reads_++;
            this.trim(new Set([key]));
            return tile;
        })().finally(() => this.reading_.delete(key));
        this.reading_.set(key, job);
        return job;
    }

    /** Where (x, z) falls: its tile's key, and its place in that tile in samples. */
    private locate(x: number, z: number): { key: string; lx: number; lz: number } {
        const n = this.doc.tileSamples - 1;
        const gx = clamp(x / this.params.sizeX + 0.5, 0, 1) * (this.samplesX - 1), gz = clamp(z / this.params.sizeZ + 0.5, 0, 1) * (this.samplesZ - 1);
        const tx = Math.min(Math.floor(gx / n), this.doc.tilesX - 1), tz = Math.min(Math.floor(gz / n), this.doc.tilesZ - 1);
        return { key: `${tx}:${tz}`, lx: gx - tx * n, lz: gz - tz * n };
    }

    private keysOver(x0: number, z0: number, x1: number, z1: number): string[] {
        const a = this.locate(x0, z0), b = this.locate(x1, z1);
        const [ax, az] = a.key.split(':').map(Number), [bx, bz] = b.key.split(':').map(Number);
        const keys: string[] = [];
        for (let tz = az!; tz <= bz!; tz++) for (let tx = ax!; tx <= bx!; tx++) keys.push(`${tx}:${tz}`);
        return keys;
    }

    private fromOverview(x0: number, z0: number, spacing: number, count: number): TerrainRegionSamples {
        const heights = new Float32Array(count * count);
        const p1 = this.overviewSplat ? new Float32Array(count * count * 4) : undefined;
        const p2 = this.overviewSplat2 ? new Float32Array(count * count * 4) : undefined;
        for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
            const k = j * count + i;
            const u = clamp((x0 + i * spacing) / this.params.sizeX + 0.5, 0, 1), v = clamp((z0 + j * spacing) / this.params.sizeZ + 0.5, 0, 1);
            heights[k] = this.params.height * bilinear(this.overview.data, this.overview.width, u * (this.overview.width - 1), v * (this.overview.height - 1));
            if (p1) fill(p1, k, this.overviewSplat!, u, v);
            if (p2) fill(p2, k, this.overviewSplat2!, u, v);
        }
        return { heights, ...(p1 ? { paint: p1 } : {}), ...(p2 ? { paint2: p2 } : {}) };
    }

    private fromTiles(x0: number, z0: number, spacing: number, count: number): TerrainRegionSamples {
        const heights = new Float32Array(count * count);
        const painted = this.overviewSplat !== null || [...this.tiles_.values()].some((t) => t.splat);
        const p1 = painted ? new Float32Array(count * count * 4) : undefined;
        const second = this.overviewSplat2 !== null || [...this.tiles_.values()].some((t) => t.splat2);
        const p2 = painted && second ? new Float32Array(count * count * 4) : undefined;
        const n = this.doc.tileSamples - 1;
        for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
            const k = j * count + i, x = x0 + i * spacing, z = z0 + j * spacing;
            const at = this.locate(x, z), tile = this.tiles_.get(at.key);
            const u = clamp(x / this.params.sizeX + 0.5, 0, 1), v = clamp(z / this.params.sizeZ + 0.5, 0, 1);
            heights[k] = tile ? this.params.height * bilinear(tile.field.data, tile.field.width, at.lx, at.lz)
                : this.params.height * bilinear(this.overview.data, this.overview.width, u * (this.overview.width - 1), v * (this.overview.height - 1));
            if (!p1) continue;
            const splat = tile?.splat ?? this.overviewSplat, splat2 = tile?.splat ? tile.splat2 : this.overviewSplat2;
            const su = tile?.splat ? at.lx / n : u, sv = tile?.splat ? at.lz / n : v;
            if (splat) fill(p1, k, splat, su, sv);
            if (p2 && splat2) fill(p2, k, splat2, su, sv);
        }
        return { heights, ...(p1 ? { paint: p1 } : {}), ...(p2 ? { paint2: p2 } : {}) };
    }
}

const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(v, a), b);

function bilinear(data: Float32Array, width: number, fx: number, fz: number): number {
    const height = data.length / width;
    const i = clamp(Math.floor(fx), 0, width - 2), j = clamp(Math.floor(fz), 0, height - 2);
    const u = fx - i, v = fz - j;
    const a = data[j * width + i]!, b = data[j * width + i + 1]!, c = data[(j + 1) * width + i]!, d = data[(j + 1) * width + i + 1]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fill(out: Float32Array, k: number, s: Splat, u: number, v: number): void {
    const i = Math.round(clamp(u, 0, 1) * (s.width - 1)), j = Math.round(clamp(v, 0, 1) * (s.height - 1));
    for (let c = 0; c < 4; c++) out[k * 4 + c] = s.pixels[(j * s.width + i) * 4 + c]! / 255;
}

function weights(a: Splat, b: Splat | null, u: number, v: number): LayerWeights {
    const out = new Float32Array(b ? 8 : 4);
    fill(out, 0, a, u, v);
    if (b) {
        const tmp = new Float32Array(4);
        fill(tmp, 0, b, u, v);
        out.set(tmp, 4);
    }
    return [...out];
}
