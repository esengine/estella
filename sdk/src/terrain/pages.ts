// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pages.ts
 * @brief   The ground's height, slope and paint in pages: one per quadtree node, made from the source and kept in two atlas textures.
 *
 * @details A page is a node's square sampled `PAGE_TEXELS` times along each side (two samples to a cell of its patch), with one sample
 *          more past each edge so the slope at the edge is known and a filtered read there stays inside the page. Its three images:
 *            - heights: red and green the height over the source's range, high byte then low (read texel by texel and blended in the
 *              shader, as a filtered pair of bytes is no number); blue and alpha the normal's x and z (filtered);
 *            - paint and paint2: the weights of layers 1 to 4 and 5 to 8 (filtered).
 *          Pages are made as the tree asks for them, coarse ones first, within a time budget a frame, and the least recently drawn give
 *          their slot up when the atlas is full. A node whose page is not made yet is drawn by an ancestor's.
 */
import type { LayerWeights, TerrainRegionSamples, TerrainSource } from './source';

/** Cells along a patch's side, and samples along a page's (two to a cell). */
export const PATCH_CELLS = 32;
export const PAGE_TEXELS = PATCH_CELLS * 2;
/** A page's side in the atlas: its samples, the one on its far edge, and one past each edge. */
export const PAGE_SIDE = PAGE_TEXELS + 3;

/** A page's place and what it found. */
export interface Page {
    slot: number;
    /** The least and most height in it: the node's box. */
    min: number;
    max: number;
    /** When it was last drawn, for choosing which to give up. */
    used: number;
    /** The ground changed under it: it is still drawn, as it was, until a new image takes its slot. */
    stale?: boolean;
}

/** The pixels of one page. */
export interface PageImage { heights: Uint8Array; paint: Uint8Array; paint2: Uint8Array; min: number; max: number }

/**
 * Samples a node's page from `source`: square (x0, z0) to (x0 + size, z0 + size) in the terrain's space. Heights are encoded over
 * the source's range. Off an area's edge the ground is its nearest edge's, so the pages there are whole. A source that samples regions
 * (a provider) is asked for the page's whole grid at once, and may answer later. `repaint`, given, has the last word on each sample's
 * paint (a world's biomes), from the paint the source gave it.
 */
export function makePage(source: TerrainSource, x0: number, z0: number, size: number, repaint?: Repaint): PageImage | Promise<PageImage> {
    const n = PAGE_SIDE, step = size / PAGE_TEXELS;
    if (source.region) {
        const got = source.region(x0 - step, z0 - step, step, n);
        return got instanceof Promise ? got.then((r) => encodePage(source, x0, z0, step, r.heights, r, repaint))
            : encodePage(source, x0, z0, step, got.heights, got, repaint);
    }
    return finishPage(makePageJob(source, x0, z0, size, repaint));
}

/** A page made in bounded sample batches. Use only when height() is ready and synchronous; region-only providers keep their async path. */
export function* makePageJob(source: TerrainSource, x0: number, z0: number, size: number, repaint?: Repaint): Generator<number, PageImage, void> {
    const n = PAGE_SIDE, step = size / PAGE_TEXELS, h = new Float32Array(n * n);
    const [bx0, bz0, bx1, bz1] = source.bounds ?? [-Infinity, -Infinity, Infinity, Infinity];
    for (let k = 0; k < h.length; k++) {
        const i = k % n, j = Math.floor(k / n);
        const x = Math.min(Math.max(x0 + (i - 1) * step, bx0), bx1), z = Math.min(Math.max(z0 + (j - 1) * step, bz0), bz1);
        h[k] = source.height(x, z) ?? source.minHeight;
        if ((k + 1) % 32 === 0) yield 0.4 * (k + 1) / h.length;
    }
    yield 0.4;
    return yield* encodePageJob(source, x0, z0, step, h, undefined, repaint);
}

function finishPage(job: Generator<number, PageImage, void>): PageImage {
    for (;;) { const next = job.next(); if (next.done) return next.value; }
}

/** The paint of a sample at (x, z) in the terrain's space, `h` high and facing `ny` up, from what it would otherwise be. */
export type Repaint = (x: number, z: number, h: number, ny: number, w: LayerWeights) => LayerWeights;

/** Encodes a page's samples (row by row, one past each edge): heights and normals into one image, the paint into the other. */
function encodePage(source: TerrainSource, x0: number, z0: number, step: number, h: Float32Array, given?: TerrainRegionSamples, repaint?: Repaint): PageImage {
    return finishPage(encodePageJob(source, x0, z0, step, h, given, repaint));
}

function* encodePageJob(source: TerrainSource, x0: number, z0: number, step: number, h: Float32Array, given?: TerrainRegionSamples, repaint?: Repaint): Generator<number, PageImage, void> {
    const n = PAGE_SIDE;
    const [bx0, bz0, bx1, bz1] = source.bounds ?? [-Infinity, -Infinity, Infinity, Infinity];
    let min = Infinity, max = -Infinity;
    for (let j = 1; j <= n - 2; j++) for (let i = 1; i <= n - 2; i++) { const v = h[j * n + i]!; min = Math.min(min, v); max = Math.max(max, v); }
    const span = Math.max(source.maxHeight - source.minHeight, 1e-6);
    const heights = new Uint8Array(n * n * 4), paint = new Uint8Array(n * n * 4), paint2 = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const enc = Math.round(Math.min(Math.max((h[k]! - source.minHeight) / span, 0), 1) * 65535);
        const hl = h[j * n + Math.max(i - 1, 0)]!, hr = h[j * n + Math.min(i + 1, n - 1)]!;
        const hd = h[Math.max(j - 1, 0) * n + i]!, hu = h[Math.min(j + 1, n - 1) * n + i]!;
        const sx = (hr - hl) / (2 * step), sz = (hu - hd) / (2 * step);
        const len = Math.hypot(sx, 1, sz);
        const nx = -sx / len, ny = 1 / len, nz = -sz / len;
        heights[k * 4] = enc >> 8;
        heights[k * 4 + 1] = enc & 255;
        heights[k * 4 + 2] = Math.round((nx * 0.5 + 0.5) * 255);
        heights[k * 4 + 3] = Math.round((nz * 0.5 + 0.5) * 255);
        const x = Math.min(Math.max(x0 + (i - 1) * step, bx0), bx1), z = Math.min(Math.max(z0 + (j - 1) * step, bz0), bz1);
        const p1 = given?.paint, p2 = given?.paint2;
        let w: LayerWeights = p1
            ? [p1[k * 4]!, p1[k * 4 + 1]!, p1[k * 4 + 2]!, p1[k * 4 + 3]!, ...(p2 ? [p2[k * 4]!, p2[k * 4 + 1]!, p2[k * 4 + 2]!, p2[k * 4 + 3]!] : [])]
            : source.paint(x, z, h[k]!, ny);
        if (repaint) w = repaint(x, z, h[k]!, ny, w);
        for (let c = 0; c < 4; c++) {
            paint[k * 4 + c] = Math.round(Math.min(Math.max(w[c] ?? 0, 0), 1) * 255);
            paint2[k * 4 + c] = Math.round(Math.min(Math.max(w[c + 4] ?? 0, 0), 1) * 255);
        }
        if ((k + 1) % 32 === 0) yield 0.4 + 0.6 * (k + 1) / (n * n);
    }
    return { heights, paint, paint2, min: Number.isFinite(min) ? min : source.minHeight, max: Number.isFinite(max) ? max : source.maxHeight };
}

/** Where the pages live: slots in a square atlas, given out and taken back by key. */
export class PageTable {
    readonly perRow: number;
    readonly capacity: number;
    private readonly pages_ = new Map<string, Page>();
    private readonly free_: number[] = [];
    private clock_ = 0;

    constructor(readonly atlasSize: number) {
        this.perRow = Math.floor(atlasSize / PAGE_SIDE);
        this.capacity = this.perRow * this.perRow;
        for (let s = this.capacity - 1; s >= 0; s--) this.free_.push(s);
    }

    get(key: string): Page | undefined {
        return this.pages_.get(key);
    }

    /** Marks pages drawn this frame, so they are the last to be given up. */
    touch(key: string): void {
        const p = this.pages_.get(key);
        if (p) p.used = this.clock_;
    }

    /** Moves the clock a frame on. */
    tick(): void {
        this.clock_++;
    }

    /** A slot for a new page under `key`: a free one, or the least recently drawn one not drawn this frame. Null when every slot is in use now. */
    claim(key: string, min: number, max: number): Page | null {
        // A page the ground changed under is made again in its own slot, so what is drawn there changes in place and never goes missing.
        const had = this.pages_.get(key);
        if (had) { had.min = min; had.max = max; had.used = this.clock_; had.stale = false; return had; }
        let slot = this.free_.pop();
        if (slot === undefined) {
            let oldest: string | null = null, at = Infinity;
            for (const [k, p] of this.pages_) if (p.used < this.clock_ && p.used < at) { at = p.used; oldest = k; }
            if (oldest === null) return null;
            slot = this.pages_.get(oldest)!.slot;
            this.pages_.delete(oldest);
        }
        const page: Page = { slot, min, max, used: this.clock_ };
        this.pages_.set(key, page);
        return page;
    }

    /** Forgets the pages `test` names (the ground changed under them): they are made again as they are wanted. */
    forget(test: (key: string) => boolean): void {
        for (const [key, page] of this.pages_) {
            if (!test(key)) continue;
            this.pages_.delete(key);
            this.free_.push(page.slot);
        }
    }

    /**
     * Marks the pages `test` names as out of date without taking them away: they go on being drawn as they were until each is made again
     * (`claim` on its key), so an edit never leaves a hole in the ground while its pages are rebuilt over the next frames.
     */
    markStale(test: (key: string) => boolean): void {
        for (const [key, page] of this.pages_) if (test(key)) page.stale = true;
    }

    /** Whether the page under `key` is out of date. */
    isStale(key: string): boolean {
        return this.pages_.get(key)?.stale === true;
    }

    /** Forgets every page (the device lost the atlas, or the ground changed). */
    clear(): void {
        this.pages_.clear();
        this.free_.length = 0;
        for (let s = this.capacity - 1; s >= 0; s--) this.free_.push(s);
    }

    /** Where a slot's page starts in the atlas, in texels. */
    origin(slot: number): [number, number] {
        return [(slot % this.perRow) * PAGE_SIDE, Math.floor(slot / this.perRow) * PAGE_SIDE];
    }

    get size(): number {
        return this.pages_.size;
    }
}
