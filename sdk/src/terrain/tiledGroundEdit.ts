// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tiledGroundEdit.ts
 * @brief   Brushes on ground kept as tiles: a dab changes the tiles in memory under it and the overview with them, and a changed tile stays
 *          in memory until it is saved.
 *
 * @details A dab is run on a window of the area's samples copied out of the tiles it covers (one sample wider, for smoothing), with the
 *          same brushes as an area of one heightfield (sculpt.ts), and written back to every tile that holds each changed sample, so a
 *          seam two tiles share stays one height. Where a tile under the brush is not in memory yet, it is read and that dab is skipped,
 *          as only loaded ground can be edited.
 */
import { encodeHeightmap, paintSplat, reach, sculptField, SculptMode, unionDirty, type Brush, type BrushProfile, type Dirty } from './sculpt';
import { BeforeTiles, clearChannel, usedChannels, put, type Piece } from './groundEdit';
import type { ModifiedSource, Splat } from './source';
import { paintKernel, type TerrainPaintSettings } from './weightBrush';
import { HeightmapFormat, heightfieldFromPixels, type Heightfield } from './heightfield';
import type { Tile, TiledSource, TerrainTilesDocument } from './tiles';
import type { GroundHost } from './groundEdit';

/** What one stroke changed in one array of a tiled ground. */
interface Arrays { heights: Piece<Float32Array> | null; splat: Piece<Uint8Array> | null; splat2: Piece<Uint8Array> | null }

/** What one stroke on a tiled ground changed: in each tile it reached, and in the overview. @experimental */
export interface TiledGroundPatch { tiles: Map<string, Arrays>; overview: Arrays; bounds: [number, number, number, number] }

interface Kept {
    heights: BeforeTiles<Float32Array> | null;
    splat: BeforeTiles<Uint8Array> | null;
    splat2: BeforeTiles<Uint8Array> | null;
    h: Dirty | null;
    s: Dirty | null;
    s2: Dirty | null;
}

/** An image a save writes, with where it goes. @experimental */
export interface TiledGroundImage {
    path: string;
    width: number;
    height: number;
    pixels: Uint8Array;
    /** The destination's heightmap format. Height pixels are packed as RedGreen16 here, and splatmaps have no format. */
    heightFormat?: number;
}

function heightImage(path: string, field: Heightfield, heightFormat: number): TiledGroundImage {
    return { path, width: field.width, height: field.height, pixels: encodeHeightmap(field), heightFormat };
}

const kept = (): Kept => ({ heights: null, splat: null, splat2: null, h: null, s: null, s2: null });

/** One tiled ground, open to brushes. @experimental */
export class TiledGroundEdit {
    readonly tiled = true;
    private open_: { tiles: Map<string, Kept>; overview: Kept; bounds: [number, number, number, number] | null } | null = null;

    /** @internal */
    constructor(private readonly host: GroundHost, private readonly source: TiledSource, private readonly modified: ModifiedSource,
                private readonly sizeX: number, private readonly sizeZ: number) {}

    /** Active material layers and their stable weightmap slots, when the terrain has layer info. */
    get paintTargets() { return this.source.paintLayout; }
    get minHeight(): number { return this.source.minHeight; }
    get maxHeight(): number { return this.source.maxHeight; }
    get area(): { sizeX: number; sizeZ: number } { return { sizeX: this.sizeX, sizeZ: this.sizeZ }; }
    get origin(): { x: number; z: number } { return { x: this.modified.origin.x, z: this.modified.origin.z }; }
    get samplesX(): number { return this.source.samplesX; }
    get samplesZ(): number { return this.source.samplesZ; }
    /** Tiles changed and not saved yet. */
    get unsaved(): string[] { return this.source.dirtyTiles(); }

    heightAt(x: number, z: number): number | null {
        return this.source.height(x - this.modified.origin.x, z - this.modified.origin.z);
    }

    /** Whether two handles still address the same loaded ground. */
    sameSource(other: TiledGroundEdit): boolean { return this.source === other.source; }

    /** Keep all tiles reached by a compound stroke resident until the returned release function is called. */
    async prepareBrushes(brushes: readonly Brush[]): Promise<() => void> {
        const s = this.source, n = s.doc.tileSamples - 1, keys = new Set<string>();
        for (const brush of brushes) {
            const span = reach(s.samplesX, s.samplesZ, this.sizeX, this.sizeZ,
                { ...brush, x: brush.x - this.origin.x, z: brush.z - this.origin.z });
            if (!span) continue;
            const left = Math.max(0, Math.floor((span.i0 - 1) / n)), back = Math.max(0, Math.floor((span.j0 - 1) / n));
            const right = Math.min(s.doc.tilesX - 1, Math.floor((span.i1 + 1) / n)), front = Math.min(s.doc.tilesZ - 1, Math.floor((span.j1 + 1) / n));
            for (let z = back; z <= front; z++) for (let x = left; x <= right; x++) if (s.hasTile(x, z)) keys.add(x + ':' + z);
        }
        return s.holdForEdit(keys);
    }

    begin(): void {
        if (!this.open_) this.open_ = { tiles: new Map(), overview: kept(), bounds: null };
    }

    sculpt(mode: number, x: number, z: number, radius: number, falloff: number, amount: number, target?: number, profile?: BrushProfile): void {
        const span = this.span;
        this.dab({ ...profile, x, z, radius, falloff }, (win, sx, sz, brush) => {
            const field: Heightfield = { width: win.w, height: win.h, data: this.readWindow(win, (t) => t.field.data, 1) };
            const hit = sculptField(field, sx, sz, { mode, brush, amount: mode <= SculptMode.Lower || mode === SculptMode.Clay ? amount / span : amount,
                target: target === undefined ? undefined : (target - this.minHeight) / span });
            if (hit) this.writeWindow(win, hit, field.data, 1, 'heights');
            return hit;
        });
    }

    paint(layer: number, x: number, z: number, radius: number, falloff: number, strength: number, erase = false, profile?: BrushProfile, settings?: TerrainPaintSettings): void {
        this.dab({ ...profile, x, z, radius, falloff }, (win, sx, sz, brush) => {
            const second = layer > 3 || (settings?.weighted ?? 0) > 15 || win.tiles.some(({ tile }) => tile.splat2);
            for (const { tile, tx, tz } of win.tiles) this.source.ensureTileSplats(tile, tx, tz, second);
            const a: Splat = { width: win.w, height: win.h, pixels: this.readWindow(win, (t) => t.splat!.pixels, 4) };
            const b: Splat | null = second ? { width: win.w, height: win.h, pixels: this.readWindow(win, (t) => t.splat2!.pixels, 4) } : null;
            const hit = paintSplat(a, b, sx, sz, { layer, brush, strength, erase, settings, worldCenter: { x, z } });
            if (!hit) return null;
            this.writeWindow(win, hit, a.pixels, 4, 'splat');
            if (b) this.writeWindow(win, hit, b.pixels, 4, 'splat2');
            return hit;
        }, paintKernel(settings));
    }

    usedPaintSlots(): number {
        const { a, b } = this.source.overviewSplats(false, false);
        let mask = usedChannels(a) | (usedChannels(b) << 4);
        for (const e of this.source.doc.tiles) {
            const t = this.source.tileAt(e.x, e.z);
            // An unloaded authored image may hold any of its four channels. Keep it until it can be inspected.
            mask |= t ? usedChannels(t.splat) | (usedChannels(t.splat2) << 4) : (e.splat ? 15 : 0) | (e.splat2 ? 240 : 0);
            if (mask === 255) break;
        }
        return mask;
    }

    /** Read just tiles with the relevant weight image, then clear their channel in one synchronous edit. */
    async clearPaintLayer(slot: number, current: () => boolean = () => true): Promise<TiledGroundPatch | null> {
        if (!Number.isInteger(slot) || slot < 0 || slot > 7) return null;
        const s = this.source, field = slot < 4 ? 'splat' : 'splat2';
        const entries = s.doc.tiles.filter(e => e[field] || s.tileAt(e.x, e.z)?.[field]);
        const release = await s.holdForEdit(new Set(entries.map(e => e.x + ':' + e.z)));
        try {
            if (!current()) return null;
            const tiles = new Map<string, Arrays>();
            const clear = (image: Splat | null): Arrays => ({
                heights: null, splat: field === 'splat' ? clearChannel(image, slot % 4) : null,
                splat2: field === 'splat2' ? clearChannel(image, slot % 4) : null,
            });
            for (const e of entries) {
                const part = clear(s.tileAt(e.x, e.z)?.[field] ?? null);
                if (part[field]) tiles.set(e.x + ':' + e.z, part);
            }
            const { a, b } = s.overviewSplats(false, false), overview = clear(slot < 4 ? a : b);
            if (!tiles.size && !overview[field]) return null;
            const bounds: TiledGroundPatch['bounds'] = [-this.sizeX / 2, -this.sizeZ / 2, this.sizeX / 2, this.sizeZ / 2];
            const patch = { tiles, overview, bounds };
            this.apply(patch, 'after');
            return patch;
        } finally { release(); }
    }

    end(): TiledGroundPatch | null {
        const o = this.open_;
        this.open_ = null;
        if (!o || !o.bounds) return null;
        const tiles = new Map<string, Arrays>();
        for (const [key, k] of o.tiles) {
            const [tx, tz] = key.split(':').map(Number) as [number, number];
            const tile = this.source.tileAt(tx, tz);
            if (tile) tiles.set(key, finish(k, tile.field.data, tile.splat?.pixels, tile.splat2?.pixels));
        }
        const { a, b } = this.source.overviewSplats(false, false);
        return { tiles, overview: finish(o.overview, this.source.overview.data, a?.pixels, b?.pixels), bounds: o.bounds };
    }

    /** Lays a patch's `before` or `after` back; a tile that has left memory since is read again first. */
    apply(patch: TiledGroundPatch, side: 'before' | 'after'): void {
        const lay = (tile: Tile, arrays: Arrays): void => {
            if (arrays.heights) put(tile.field.data, arrays.heights, side, 1);
            if (arrays.splat && tile.splat) put(tile.splat.pixels, arrays.splat, side, 4);
            if (arrays.splat2 && tile.splat2) put(tile.splat2.pixels, arrays.splat2, side, 4);
        };
        const later: Promise<void>[] = [];
        for (const [key, arrays] of patch.tiles) {
            const [tx, tz] = key.split(':').map(Number) as [number, number];
            this.source.markDirty(tx, tz);
            const tile = this.source.tileAt(tx, tz);
            if (tile) { lay(tile, arrays); continue; }
            later.push(this.source.readTile(tx, tz).then((t) => { if (t) lay(t, arrays); }));
        }
        const { a, b } = this.source.overviewSplats(!!patch.overview.splat, !!patch.overview.splat2);
        if (patch.overview.heights) put(this.source.overview.data, patch.overview.heights, side, 1);
        if (patch.overview.splat && a) put(a.pixels, patch.overview.splat, side, 4);
        if (patch.overview.splat2 && b) put(b.pixels, patch.overview.splat2, side, 4);
        this.source.markOverviewDirty();
        this.host.remake(this.world(patch.bounds));
        if (later.length) void Promise.all(later).then(() => this.host.remake(this.world(patch.bounds)));
    }

    /**
     * What a save writes: every changed tile's images, and the overview's, at the paths the document names. A splatmap the document did not
     * name before is given a path beside its tile's heights, and `document` is then the document to write as well (null when unchanged).
     * An authoring host can resolve height references to file paths when naming these new images.
     */
    saveImages(resolveHeightPath: (ref: string) => string = ref => ref): { images: TiledGroundImage[]; document: TerrainTilesDocument | null } {
        const doc = this.source.doc, images: TiledGroundImage[] = [];
        const beside = (ref: string, suffix: string): string => {
            const path = resolveHeightPath(ref).replace(/(\.[^./]+)?$/, `${suffix}.png`);
            this.source.documentDirty = true;
            return path;
        };
        for (const { tile, entry } of this.source.residentDirtyTiles()) {
            images.push(heightImage(entry.height, tile.field, doc.format));
            if (tile.splat) {
                if (!entry.splat) entry.splat = beside(entry.height, '_splat');
                images.push({ path: entry.splat, ...tile.splat });
            }
            if (tile.splat2) {
                if (!entry.splat2) entry.splat2 = beside(entry.height, '_splat2');
                images.push({ path: entry.splat2, ...tile.splat2 });
            }
        }
        if (this.source.overviewDirty) {
            images.push(heightImage(doc.overview, this.source.overview, doc.format));
            const { a, b } = this.source.overviewSplats(false, false);
            if (a) {
                if (!doc.overviewSplat) doc.overviewSplat = beside(doc.overview, '_splat');
                images.push({ path: doc.overviewSplat, ...a });
            }
            if (b) {
                if (!doc.overviewSplat2) doc.overviewSplat2 = beside(doc.overview, '_splat2');
                images.push({ path: doc.overviewSplat2, ...b });
            }
        }
        return { images, document: this.source.documentDirty ? doc : null };
    }

    /**
     * The whole area as one heightmap image, the size {@link importImage} takes. `all` requires every tile in the grid and reads
     * each in turn. `loaded` uses the overview for the rest and returns null when no tile is in memory.
     */
    async exportImage(mode: 'all' | 'loaded'): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
        const s = this.source, n = s.doc.tileSamples - 1, t = n + 1;
        const expected = s.doc.tilesX * s.doc.tilesZ;
        if (mode === 'all' && s.doc.tiles.length !== expected) {
            throw new Error(`Terrain document lists ${s.doc.tiles.length} of ${expected} tiles. Full export requires every tile.`);
        }
        const chosen = s.doc.tiles.filter((e) => mode === 'all' || s.tileAt(e.x, e.z));
        if (chosen.length === 0) return null;
        const field: Heightfield = { width: s.samplesX, height: s.samplesZ, data: new Float32Array(s.samplesX * s.samplesZ) };
        if (mode === 'loaded') {
            const ov = s.overview;
            for (let j = 0; j < field.height; j++) for (let i = 0; i < field.width; i++) {
                const u = i / (s.samplesX - 1) * (ov.width - 1), v = j / (s.samplesZ - 1) * (ov.height - 1);
                field.data[j * field.width + i] = bilinear(ov.data, ov.width, u, v);
            }
        }
        for (const e of chosen) {
            const tile = s.tileAt(e.x, e.z) ?? (mode === 'all' ? await s.readTile(e.x, e.z) : null);
            if (!tile) {
                if (mode === 'all') throw new Error(`Terrain tile ${e.x}:${e.z} is missing. Full export requires every tile.`);
                continue;
            }
            for (let j = 0; j < t; j++) {
                const row = (e.z * n + j) * field.width + e.x * n;
                field.data.set(tile.field.data.subarray(j * t, j * t + t), row);
            }
        }
        return { width: field.width, height: field.height, pixels: encodeHeightmap(field) };
    }

    /**
     * A heightmap laid over the ground: on every tile (`all`) or the tiles in memory (`loaded`). `field` covers the whole area and is
     * resampled to it if its size differs. The tiles in memory take it at once; what comes back is every image to write (the tiles'
     * and the overview's). Refused while there are changes not saved, which it would overwrite.
     */
    importImage(field: Heightfield, mode: 'all' | 'loaded'): TiledGroundImage[] {
        const staged = this.prepareImageImport(field, mode);
        staged.apply();
        return staged.images;
    }

    /** Prepare the files without changing the live ground. Apply after the caller has published the files. */
    prepareImageImport(field: Heightfield, mode: 'all' | 'loaded'): {
        images: TiledGroundImage[];
        assertClean(): void;
        apply(): void;
    } {
        const s = this.source, n = s.doc.tileSamples - 1, t = n + 1;
        const assertClean = () => {
            if (s.dirtyTiles().length > 0 || s.overviewDirty) throw new Error('save or undo the changes to this terrain before importing over it');
        };
        assertClean();
        const at = (gi: number, gj: number): number => bilinear(field.data, field.width,
            gi / (s.samplesX - 1) * (field.width - 1), gj / (s.samplesZ - 1) * (field.height - 1));
        const chosen = s.doc.tiles.filter((e) => mode === 'all' || s.tileAt(e.x, e.z));
        const images: TiledGroundImage[] = [];
        const columnsByRow = new Map<number, Set<number>>();
        const preparedResident = new Map<number, Float32Array>();
        for (const e of chosen) {
            let columns = columnsByRow.get(e.z);
            if (!columns) columnsByRow.set(e.z, columns = new Set());
            columns.add(e.x);
            const heights: Heightfield = { width: t, height: t, data: new Float32Array(t * t) };
            for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) heights.data[j * t + i] = at(e.x * n + i, e.z * n + j);
            if (s.tileAt(e.x, e.z)) preparedResident.set(images.length, heights.data);
            images.push(heightImage(e.height, heights, s.doc.format));
        }
        const ov = { ...s.overview, data: s.overview.data.slice() };
        for (let oj = 0; oj < ov.height; oj++) {
            const gj = oj / (ov.height - 1) * (s.samplesZ - 1);
            const columns = columnsByRow.get(Math.min(Math.floor(gj / n), s.doc.tilesZ - 1));
            if (!columns) continue;
            for (let oi = 0; oi < ov.width; oi++) {
                const gi = oi / (ov.width - 1) * (s.samplesX - 1);
                const tx = Math.min(Math.floor(gi / n), s.doc.tilesX - 1);
                if (columns.has(tx)) ov.data[oj * ov.width + oi] = at(gi, gj);
            }
        }
        images.push(heightImage(s.doc.overview, ov, s.doc.format));
        let applied = false;
        return {
            images, assertClean,
            apply: () => {
                if (applied) return;
                assertClean();
                for (const [i, entry] of chosen.entries()) {
                    s.applyImportedHeights(entry.x, entry.z, () =>
                        preparedResident.get(i) ?? heightfieldFromPixels(t, t, images[i]!.pixels, HeightmapFormat.RedGreen16).data);
                }
                s.overview.data.set(ov.data);
                applied = true;
                this.host.remake(this.world([-this.sizeX / 2, -this.sizeZ / 2, this.sizeX / 2, this.sizeZ / 2]));
            },
        };
    }

    /** After the images of {@link saveImages} are written: the tiles may leave memory again. */
    saved(): void {
        this.source.markSaved();
    }

    private get span(): number {
        return Math.max(this.maxHeight - this.minHeight, 1e-6);
    }

    /** The window of samples a brush reaches, one wider, and the tiles in memory over it; null where one is not, after asking for it. */
    private dab(world: Brush, run: (win: Window, sx: number, sz: number, brush: Brush) => Dirty | null, halo = 1): void {
        const o = this.modified.origin, s = this.source;
        const brush = { ...world, x: world.x - o.x, z: world.z - o.z };
        const span = reach(s.samplesX, s.samplesZ, this.sizeX, this.sizeZ, brush);
        if (!span) return;
        const win = this.window(span, halo);
        if (!win || !win.tiles.length) return;
        const ex = this.sizeX / (s.samplesX - 1), ez = this.sizeZ / (s.samplesZ - 1);
        const cx = ((win.i0 + win.i1) / 2 / (s.samplesX - 1) - 0.5) * this.sizeX, cz = ((win.j0 + win.j1) / 2 / (s.samplesZ - 1) - 0.5) * this.sizeZ;
        const hit = run(win, (win.w - 1) * ex, (win.h - 1) * ez, { ...brush, x: brush.x - cx, z: brush.z - cz });
        if (!hit) return;
        const global = { i0: hit.i0 + win.i0, j0: hit.j0 + win.j0, i1: hit.i1 + win.i0, j1: hit.j1 + win.j0 };
        this.updateOverview(global);
        const bounds: [number, number, number, number] = [
            (global.i0 / (s.samplesX - 1) - 0.5) * this.sizeX - ex, (global.j0 / (s.samplesZ - 1) - 0.5) * this.sizeZ - ez,
            (global.i1 / (s.samplesX - 1) - 0.5) * this.sizeX + ex, (global.j1 / (s.samplesZ - 1) - 0.5) * this.sizeZ + ez,
        ];
        if (this.open_) {
            const b = this.open_.bounds;
            this.open_.bounds = b ? [Math.min(b[0], bounds[0]), Math.min(b[1], bounds[1]), Math.max(b[2], bounds[2]), Math.max(b[3], bounds[3])] : bounds;
        }
        this.host.remake(this.world(bounds));
    }

    private window(span: Dirty, halo: number): Window | null {
        const s = this.source, n = s.doc.tileSamples - 1;
        const i0 = Math.max(span.i0 - halo, 0), j0 = Math.max(span.j0 - halo, 0);
        const i1 = Math.min(span.i1 + halo, s.samplesX - 1), j1 = Math.min(span.j1 + halo, s.samplesZ - 1);
        const tiles: Window['tiles'] = [];
        let missing = false;
        for (let tz = Math.min(Math.floor(j0 / n), s.doc.tilesZ - 1); tz <= Math.min(Math.floor(j1 / n), s.doc.tilesZ - 1); tz++) {
            for (let tx = Math.min(Math.floor(i0 / n), s.doc.tilesX - 1); tx <= Math.min(Math.floor(i1 / n), s.doc.tilesX - 1); tx++) {
                if (!s.hasTile(tx, tz)) continue;
                const tile = s.tileAt(tx, tz);
                if (tile) tiles.push({ tile, tx, tz });
                else { missing = true; void s.readTile(tx, tz); }
            }
        }
        return missing ? null : { i0, j0, i1, j1, w: i1 - i0 + 1, h: j1 - j0 + 1, tiles };
    }

    /** The window's values of one array, read from whichever tile holds each sample. */
    private readWindow<T extends Float32Array | Uint8Array>(win: Window, of: (t: Tile) => T, stride: number): T {
        const n = this.source.doc.tileSamples - 1, t = n + 1;
        let out: T | null = null;
        for (const { tile, tx, tz } of win.tiles) {
            const src = of(tile);
            out ??= new (src.constructor as { new (k: number): T })(win.w * win.h * stride);
            const gi0 = Math.max(win.i0, tx * n), gi1 = Math.min(win.i1, tx * n + n), gj0 = Math.max(win.j0, tz * n), gj1 = Math.min(win.j1, tz * n + n);
            for (let gj = gj0; gj <= gj1; gj++) {
                const from = ((gj - tz * n) * t + (gi0 - tx * n)) * stride;
                out.set(src.subarray(from, from + (gi1 - gi0 + 1) * stride) as never, ((gj - win.j0) * win.w + (gi0 - win.i0)) * stride);
            }
        }
        return out!;
    }

    /** Writes the window's `hit` back into every tile that holds a sample of it, keeping each tile's values first for undo. */
    private writeWindow(win: Window, hit: Dirty, values: Float32Array | Uint8Array, stride: number, which: 'heights' | 'splat' | 'splat2'): void {
        const n = this.source.doc.tileSamples - 1, t = n + 1;
        const gi0 = hit.i0 + win.i0, gi1 = hit.i1 + win.i0, gj0 = hit.j0 + win.j0, gj1 = hit.j1 + win.j0;
        for (const { tile, tx, tz } of win.tiles) {
            const a0 = Math.max(gi0, tx * n), a1 = Math.min(gi1, tx * n + n), b0 = Math.max(gj0, tz * n), b1 = Math.min(gj1, tz * n + n);
            if (a0 > a1 || b0 > b1) continue;
            const into = which === 'heights' ? tile.field.data : which === 'splat' ? tile.splat!.pixels : tile.splat2!.pixels;
            const local = { i0: a0 - tx * n, j0: b0 - tz * n, i1: a1 - tx * n, j1: b1 - tz * n };
            if (this.open_) {
                const key = `${tx}:${tz}`;
                let k = this.open_.tiles.get(key);
                if (!k) this.open_.tiles.set(key, k = kept());
                if (which === 'heights') { (k.heights ??= new BeforeTiles(t, t, 1)).keep(into as Float32Array, local); k.h = unionDirty(k.h, local); }
                else if (which === 'splat') { (k.splat ??= new BeforeTiles(t, t, 4)).keep(into as Uint8Array, local); k.s = unionDirty(k.s, local); }
                else { (k.splat2 ??= new BeforeTiles(t, t, 4)).keep(into as Uint8Array, local); k.s2 = unionDirty(k.s2, local); }
            }
            for (let gj = b0; gj <= b1; gj++) {
                const from = ((gj - win.j0) * win.w + (a0 - win.i0)) * stride;
                into.set(values.subarray(from, from + (a1 - a0 + 1) * stride) as never, ((gj - tz * n) * t + (a0 - tx * n)) * stride);
            }
            this.source.markDirty(tx, tz);
        }
    }

    /** Brings the overview's samples over the changed samples up to date, from the tiles. */
    private updateOverview(g: Dirty): void {
        const s = this.source, ov = s.overview, ow = ov.width, oh = ov.height;
        const fx = (ow - 1) / (s.samplesX - 1), fz = (oh - 1) / (s.samplesZ - 1);
        const span = { i0: Math.max(Math.floor((g.i0 - 1) * fx), 0), j0: Math.max(Math.floor((g.j0 - 1) * fz), 0),
            i1: Math.min(Math.ceil((g.i1 + 1) * fx), ow - 1), j1: Math.min(Math.ceil((g.j1 + 1) * fz), oh - 1) };
        const anySplat = [...this.tilesOver(span, fx, fz)].some(({ tile }) => tile.splat);
        const { a, b } = s.overviewSplats(anySplat, [...this.tilesOver(span, fx, fz)].some(({ tile }) => tile.splat2));
        const k = this.open_?.overview;
        if (k) {
            (k.heights ??= new BeforeTiles(ow, oh, 1)).keep(ov.data, span); k.h = unionDirty(k.h, span);
            if (a) { (k.splat ??= new BeforeTiles(ow, oh, 4)).keep(a.pixels, span); k.s = unionDirty(k.s, span); }
            if (b) { (k.splat2 ??= new BeforeTiles(ow, oh, 4)).keep(b.pixels, span); k.s2 = unionDirty(k.s2, span); }
        }
        const n = s.doc.tileSamples - 1;
        for (let oj = span.j0; oj <= span.j1; oj++) for (let oi = span.i0; oi <= span.i1; oi++) {
            const gx = oi / fx, gz = oj / fz;
            const tx = Math.min(Math.floor(gx / n), s.doc.tilesX - 1), tz = Math.min(Math.floor(gz / n), s.doc.tilesZ - 1);
            const tile = s.tileAt(tx, tz);
            if (!tile) continue;
            const lx = gx - tx * n, lz = gz - tz * n;
            ov.data[oj * ow + oi] = bilinear(tile.field.data, n + 1, lx, lz);
            const li = Math.round(lx), lj = Math.round(lz), at = (lj * (n + 1) + li) * 4, to = (oj * ow + oi) * 4;
            if (a && tile.splat) a.pixels.set(tile.splat.pixels.subarray(at, at + 4), to);
            if (b && tile.splat2) b.pixels.set(tile.splat2.pixels.subarray(at, at + 4), to);
        }
        s.markOverviewDirty();
    }

    private *tilesOver(span: Dirty, fx: number, fz: number): Generator<{ tile: Tile }> {
        const s = this.source, n = s.doc.tileSamples - 1;
        for (let tz = Math.floor(span.j0 / fz / n); tz <= Math.min(Math.floor(span.j1 / fz / n), s.doc.tilesZ - 1); tz++) {
            for (let tx = Math.floor(span.i0 / fx / n); tx <= Math.min(Math.floor(span.i1 / fx / n), s.doc.tilesX - 1); tx++) {
                const tile = s.tileAt(tx, tz);
                if (tile) yield { tile };
            }
        }
    }

    private world(b: readonly [number, number, number, number]): [number, number, number, number] {
        const o = this.modified.origin;
        return [b[0] + o.x, b[1] + o.z, b[2] + o.x, b[3] + o.z];
    }
}

interface Window { i0: number; j0: number; i1: number; j1: number; w: number; h: number; tiles: Array<{ tile: Tile; tx: number; tz: number }> }

function finish(k: Kept, heights: Float32Array, splat: Uint8Array | undefined, splat2: Uint8Array | undefined): Arrays {
    return {
        heights: k.heights && k.h ? k.heights.piece(heights, k.h) : null,
        splat: k.splat && k.s && splat ? k.splat.piece(splat, k.s) : null,
        splat2: k.splat2 && k.s2 && splat2 ? k.splat2.piece(splat2, k.s2) : null,
    };
}

function bilinear(data: Float32Array, width: number, fx: number, fz: number): number {
    const height = data.length / width;
    const i = Math.min(Math.max(Math.floor(fx), 0), width - 2), j = Math.min(Math.max(Math.floor(fz), 0), height - 2);
    const u = fx - i, v = fz - j;
    const a = data[j * width + i]!, b = data[j * width + i + 1]!, c = data[(j + 1) * width + i]!, d = data[(j + 1) * width + i + 1]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
