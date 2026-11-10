// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    groundEdit.ts
 * @brief   A handle on one area terrain's ground that a tool can change: strokes in, the drawn ground, its queries and its collision follow.
 *
 * @details The ground an area draws is a field of heights and up to two splatmaps (source.ts). A handle changes those arrays in place with
 *          the brushes of sculpt.ts and has the terrain make again only the pages the stroke reached. A stroke is bracketed by
 *          {@link GroundEdit.begin} and {@link GroundEdit.end}, and `end` returns what changed as a {@link GroundPatch} that
 *          {@link GroundEdit.apply} lays down either way, which is what an editor's undo is made of. Nothing here writes a file: the
 *          arrays are what {@link GroundEdit.heightmapPixels} and {@link GroundEdit.splatmapPixels} hand over to be saved.
 */
import type { Heightfield } from './heightfield';
import type { FieldSource, Splat } from './source';
import type { ModifiedSource } from './source';
import { encodeHeightmap, paintSplat, reach, sculptField, unionDirty, type Dirty } from './sculpt';

type Texels = Float32Array | Uint8Array;

interface Tile<T> { rect: Dirty; before: T; after: T }

/** @internal What one stroke changed in one array: the 32-by-32 tiles it touched, as they were and as they are. */
export interface Piece<T> { rect: Dirty; width: number; tiles: Tile<T>[] }

const TILE = 32;

/** What one stroke changed. @experimental */
export interface GroundPatch {
    heights: Piece<Float32Array> | null;
    splat: Piece<Uint8Array> | null;
    splat2: Piece<Uint8Array> | null;
}

/** @internal */
export class BeforeTiles<T extends Texels> {
    readonly kept = new Map<number, { rect: Dirty; before: T }>();

    constructor(private readonly width: number, private readonly height: number, private readonly stride: number) {}

    keep(now: T, span: Dirty): void {
        for (let tj = span.j0 >> 5; tj <= span.j1 >> 5; tj++) for (let ti = span.i0 >> 5; ti <= span.i1 >> 5; ti++) {
            const key = tj * (((this.width - 1) >> 5) + 1) + ti;
            if (this.kept.has(key)) continue;
            const rect = { i0: ti * TILE, j0: tj * TILE, i1: Math.min(ti * TILE + TILE - 1, this.width - 1), j1: Math.min(tj * TILE + TILE - 1, this.height - 1) };
            this.kept.set(key, { rect, before: copied(now, this.width, rect, this.stride) });
        }
    }

    piece(now: T, rect: Dirty): Piece<T> {
        const tiles = [...this.kept.values()].map((tile) => ({ ...tile, after: copied(now, this.width, tile.rect, this.stride) }));
        return { rect, width: this.width, tiles };
    }
}

interface Open {
    heights: BeforeTiles<Float32Array>;
    splat: BeforeTiles<Uint8Array> | null;
    splat2: BeforeTiles<Uint8Array> | null;
    h: Dirty | null;
    s: Dirty | null;
    s2: Dirty | null;
}

/** What a handle needs of its terrain. @internal */
export interface GroundHost {
    /** Makes again the pages and the collision of the world square [minX, minZ, maxX, maxZ]. */
    remake(b: readonly [number, number, number, number]): void;
}

/** One area terrain's ground, open to brushes. @experimental */
export class GroundEdit {
    private open_: Open | null = null;

    /** @internal */
    constructor(private readonly host: GroundHost, private readonly source: FieldSource, private readonly modified: ModifiedSource,
                private readonly sizeX: number, private readonly sizeZ: number) {}

    get field(): Heightfield { return this.source.field; }
    get samplesX(): number { return this.source.field.width; }
    get samplesZ(): number { return this.source.field.height; }
    /** The world height the field's 0 sits at and its 1 reaches. */
    get minHeight(): number { return this.source.minHeight; }
    get maxHeight(): number { return this.source.maxHeight; }
    get area(): { sizeX: number; sizeZ: number } { return { sizeX: this.sizeX, sizeZ: this.sizeZ }; }
    /** The terrain's world position on the ground plane: the brush's world (x, z) is this far from the terrain's own. */
    get origin(): { x: number; z: number } { return { x: this.modified.origin.x, z: this.modified.origin.z }; }

    private get span(): number { return Math.max(this.maxHeight - this.minHeight, 1e-6); }

    /** The height of the ground (the brushes' own, without modifiers laid over it) at world (x, z), or null off the area. */
    heightAt(x: number, z: number): number | null {
        return this.source.height(x - this.modified.origin.x, z - this.modified.origin.z);
    }

    begin(): void {
        if (this.open_) return;
        this.open_ = {
            heights: new BeforeTiles(this.field.width, this.field.height, 1), splat: null, splat2: null,
            h: null, s: null, s2: null,
        };
    }

    /**
     * One dab of height. `amount` is in world units for raise and lower (how far the brush's core moves the ground) and 0 to 1 for smooth
     * and flatten (how much of the way they go); `target` is flatten's world height. At the world position (x, z).
     */
    sculpt(mode: number, x: number, z: number, radius: number, falloff: number, amount: number, target?: number): void {
        const o = this.modified.origin;
        const dab = { mode, brush: { x: x - o.x, z: z - o.z, radius, falloff }, amount: mode <= 1 ? amount / this.span : amount,
            target: target === undefined ? undefined : (target - this.minHeight) / this.span };
        const span = reach(this.field.width, this.field.height, this.sizeX, this.sizeZ, dab.brush);
        if (this.open_ && span) this.open_.heights.keep(this.field.data, span);
        const hit = sculptField(this.field, this.sizeX, this.sizeZ, dab);
        if (!hit) return;
        if (this.open_) this.open_.h = unionDirty(this.open_.h, hit);
        this.remake(x, z, radius, this.field);
    }

    /** One dab of paint at the world position (x, z). Layers 5 to 8 make the second splatmap if there is none. */
    paint(layer: number, x: number, z: number, radius: number, falloff: number, strength: number, erase = false): void {
        const o = this.modified.origin;
        const { a, b } = this.source.ensureSplats(layer > 3);
        const brush = { x: x - o.x, z: z - o.z, radius, falloff };
        const span = reach(a.width, a.height, this.sizeX, this.sizeZ, brush);
        if (this.open_ && span) {
            (this.open_.splat ??= new BeforeTiles(a.width, a.height, 4)).keep(a.pixels, span);
            if (b) (this.open_.splat2 ??= new BeforeTiles(b.width, b.height, 4)).keep(b.pixels, span);
        }
        const hit = paintSplat(a, b, this.sizeX, this.sizeZ, { layer, brush, strength, erase });
        if (!hit) return;
        if (this.open_) { this.open_.s = unionDirty(this.open_.s, hit); if (b) this.open_.s2 = unionDirty(this.open_.s2, hit); }
        this.remake(x, z, radius, a);
    }

    /** Ends the stroke and says what it changed, or null when it changed nothing. */
    end(): GroundPatch | null {
        const o = this.open_;
        this.open_ = null;
        if (!o) return null;
        const { a, b } = this.source.splats();
        const patch: GroundPatch = {
            heights: o.h ? o.heights.piece(this.field.data, o.h) : null,
            splat: o.s && a && o.splat ? o.splat.piece(a.pixels, o.s) : null,
            splat2: o.s2 && b && o.splat2 ? o.splat2.piece(b.pixels, o.s2) : null,
        };
        return patch.heights || patch.splat || patch.splat2 ? patch : null;
    }

    /** Lays a patch's `before` or its `after` back over the ground. */
    apply(patch: GroundPatch, side: 'before' | 'after'): void {
        let rect: Dirty | null = null;
        if (patch.heights) { put(this.field.data, patch.heights, side, 1); rect = patch.heights.rect; }
        const { a, b } = this.source.splats();
        if (patch.splat && a) put(a.pixels, patch.splat, side, 4);
        if (patch.splat2 && b) put(b.pixels, patch.splat2, side, 4);
        const r = rect ?? patch.splat?.rect ?? patch.splat2?.rect;
        if (!r) return;
        const w = patch.heights ? this.field.width : (a ?? b)!.width, h = patch.heights ? this.field.height : (a ?? b)!.height;
        const x0 = (r.i0 / (w - 1) - 0.5) * this.sizeX + this.modified.origin.x, x1 = (r.i1 / (w - 1) - 0.5) * this.sizeX + this.modified.origin.x;
        const z0 = (r.j0 / (h - 1) - 0.5) * this.sizeZ + this.modified.origin.z, z1 = (r.j1 / (h - 1) - 0.5) * this.sizeZ + this.modified.origin.z;
        this.host.remake([x0 - this.sizeX / w, z0 - this.sizeZ / h, x1 + this.sizeX / w, z1 + this.sizeZ / h]);
    }

    /** The heights as the image a heightmap is saved as: red and green 16 bits, `RGBA`, `field.width` by `field.height`. */
    heightmapPixels(): { width: number; height: number; pixels: Uint8Array } {
        return { width: this.field.width, height: this.field.height, pixels: encodeHeightmap(this.field) };
    }

    /** The splatmaps as `RGBA` images to save, null where the ground has none. */
    splatmapPixels(): { a: Splat | null; b: Splat | null } {
        return this.source.splats();
    }

    private remake(x: number, z: number, radius: number, grid: { width: number }): void {
        const pad = Math.max(this.sizeX / Math.max(grid.width - 1, 1), 0);
        this.host.remake([x - radius - pad, z - radius - pad, x + radius + pad, z + radius + pad]);
    }
}

function blank<T extends Texels>(like: T, rect: Dirty, stride: number): T {
    return new (like.constructor as { new (n: number): T })((rect.i1 - rect.i0 + 1) * (rect.j1 - rect.j0 + 1) * stride);
}

function copied<T extends Texels>(from: T, width: number, rect: Dirty, stride: number): T {
    const out = blank(from, rect, stride), w = (rect.i1 - rect.i0 + 1) * stride;
    for (let j = rect.j0; j <= rect.j1; j++) {
        const at = (j * width + rect.i0) * stride;
        out.set(from.subarray(at, at + w) as never, (j - rect.j0) * w);
    }
    return out;
}

/** @internal */
export function put<T extends Texels>(into: T, p: Piece<T>, side: 'before' | 'after', stride: number): void {
    for (const tile of p.tiles) {
        const from = tile[side], r = tile.rect, w = (r.i1 - r.i0 + 1) * stride;
        for (let j = r.j0; j <= r.j1; j++) {
            const row = (j - r.j0) * w;
            into.set(from.subarray(row, row + w) as never, (j * p.width + r.i0) * stride);
        }
    }
}
