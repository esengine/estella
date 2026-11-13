// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    source.ts
 * @brief   Where the ground's height and paint come from: a field over an area, or noise that goes on for ever.
 *
 * @details The terrain draws from height pages (pages.ts) and answers the CPU (what stands on it, what floats over it) from the same
 *          numbers, so both ask one source. Positions are in the terrain's own space (its entity at the origin), heights in world units
 *          above it.
 *            - An area is a heightfield (a heightmap, or noise made once and worn by rain) over `sizeX` by `sizeZ`, painted by its splatmap
 *              or by height and slope, with dirt where the rain ran.
 *            - An infinite ground is noise read at any (x, z), so it never ends and the same seed is the same ground everywhere. Rain cannot
 *              be run over ground that has no edge, so its wear is the noise's own: each octave is damped where the octaves under it are
 *              already steep, which leaves smooth valleys between sharp ridges and gullies down the slopes.
 */
import { paintWeights } from './paint';
import type { TerrainData } from './terrainPlugin';
import { sampleHeight, terrainNormal, type Heightfield } from './heightfield';

/** The ground a terrain draws, as the pages and the CPU read it. */
export interface TerrainSource {
    /** Whether the ground goes on for ever (no edge to clip, no area to bake). */
    readonly infinite: boolean;
    /** The area the ground covers, [minX, minZ, maxX, maxZ] in the terrain's space; null for an infinite one. */
    readonly bounds: readonly [number, number, number, number] | null;
    /** The least and the most the height can be: what the pages encode their heights over. */
    readonly minHeight: number;
    readonly maxHeight: number;
    /** The height at (x, z), or null off the area (or where a provider has not answered yet). */
    height(x: number, z: number): number | null;
    /** The ground's unit normal at (x, z), or null where the height is not known. */
    normal(x: number, z: number): [number, number, number] | null;
    /** The weights of the layers (up to eight; the first four by default grass, dirt, snow, rock) at (x, z), where the ground there is `h` high and faces `ny` up. */
    paint(x: number, z: number, h: number, ny: number): LayerWeights;
    /**
     * The ground over a grid of `count` by `count` samples `spacing` apart from (x0, z0), when the source samples whole regions (a
     * provider, which may answer later); without it the pages read `height` and `paint` point by point.
     */
    region?(x0: number, z0: number, spacing: number, count: number): TerrainRegionSamples | Promise<TerrainRegionSamples>;
}

/** A region's samples: heights, and the weights of layers 1 to 4 (`paint`) and 5 to 8 (`paint2`), four a sample. */
export interface TerrainRegionSamples { heights: Float32Array; paint?: Float32Array; paint2?: Float32Array }

/** The weights of a terrain's layers at a point, in order: four or eight of them (a missing one weighs nothing). */
export type LayerWeights = readonly number[];

/** The pixels of a splatmap, as the terrain read them. */
export interface Splat { width: number; height: number; pixels: Uint8Array }

/** What an area's ground is made of, as plain data a worker can rebuild it from. */
export interface FieldSourceData {
    field: Heightfield;
    params: Pick<TerrainData, 'sizeX' | 'sizeZ' | 'height' | 'rockSlope' | 'dirtHeight' | 'snowHeight'>;
    splat: Splat | null;
    splat2: Splat | null;
    flow: Float32Array | null;
    range: [number, number];
}

/**
 * An area's ground: a field of heights (0 to 1 over `range`, from 0 to `height` by default), centred on the terrain, with its splatmap
 * and where its rain ran.
 */
export class FieldSource implements TerrainSource {
    readonly infinite = false;
    readonly bounds: readonly [number, number, number, number];
    readonly minHeight: number;
    readonly maxHeight: number;

    constructor(
        readonly field: Heightfield,
        private readonly data: Pick<TerrainData, 'sizeX' | 'sizeZ' | 'height' | 'rockSlope' | 'dirtHeight' | 'snowHeight'>,
        private splat: Splat | null,
        private readonly flow: Float32Array | null,
        range: readonly [number, number] = [0, data.height],
        private splat2: Splat | null = null,
    ) {
        this.bounds = [-data.sizeX / 2, -data.sizeZ / 2, data.sizeX / 2, data.sizeZ / 2];
        [this.minHeight, this.maxHeight] = range;
    }

    /**
     * The splatmaps a brush paints into, made where the ground had none: the first from the paint the ground has now (by height and
     * slope), the second (layers 5 to 8) empty, and only when `second` says it is wanted. They are as fine as the field, to 1024 a side.
     */
    ensureSplats(second: boolean): { a: Splat; b: Splat | null } {
        const f = this.field, width = Math.min(f.width, 1024), height = Math.min(f.height, 1024);
        if (!this.splat) {
            const pixels = new Uint8Array(width * height * 4);
            const sx = this.data.sizeX, sz = this.data.sizeZ;
            for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
                const x = (i / (width - 1) - 0.5) * sx, z = (j / (height - 1) - 0.5) * sz;
                const h = this.height(x, z) ?? this.minHeight, n = this.normal(x, z);
                const w = paintWeights((h - this.minHeight) / this.span, n ? n[1] : 1, this.data);
                for (let c = 0; c < 4; c++) pixels[(j * width + i) * 4 + c] = Math.round(w[c]! * 255);
            }
            this.splat = { width, height, pixels };
        }
        if (second && !this.splat2) this.splat2 = { width: this.splat.width, height: this.splat.height, pixels: new Uint8Array(this.splat.width * this.splat.height * 4) };
        return { a: this.splat, b: this.splat2 };
    }

    /** The splatmaps now, null where the ground has none. */
    splats(): { a: Splat | null; b: Splat | null } {
        return { a: this.splat, b: this.splat2 };
    }

    private get span(): number {
        return Math.max(this.maxHeight - this.minHeight, 1e-6);
    }

    /** The ground as data (its arrays are shared, not copied): `FieldSource.fromData` makes the same ground from it. */
    toData(): FieldSourceData {
        const d = this.data;
        return {
            field: this.field, params: { sizeX: d.sizeX, sizeZ: d.sizeZ, height: d.height, rockSlope: d.rockSlope, dirtHeight: d.dirtHeight, snowHeight: d.snowHeight },
            splat: this.splat, splat2: this.splat2, flow: this.flow, range: [this.minHeight, this.maxHeight],
        };
    }

    static fromData(d: FieldSourceData): FieldSource {
        return new FieldSource(d.field, d.params, d.splat, d.flow, d.range, d.splat2);
    }

    height(x: number, z: number): number | null {
        const u = x / this.data.sizeX + 0.5, v = z / this.data.sizeZ + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        return this.minHeight + sampleHeight(this.field, u, v) * this.span;
    }

    /** The ground's normal at (x, z), or null off the area. */
    normal(x: number, z: number): [number, number, number] | null {
        const u = x / this.data.sizeX + 0.5, v = z / this.data.sizeZ + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        return terrainNormal(this.field, u, v, this.data.sizeX, this.data.sizeZ, this.span);
    }

    paint(x: number, z: number, h: number, ny: number): LayerWeights {
        const u = Math.min(Math.max(x / this.data.sizeX + 0.5, 0), 1), v = Math.min(Math.max(z / this.data.sizeZ + 0.5, 0), 1);
        let w: number[] = [...paintWeights((h - this.minHeight) / this.span, ny, this.data)];
        // The splatmaps, where they say anything, say all of it: layers 1 to 4 from the first, 5 to 8 from the second.
        // Read between its pixels: a page near the eye samples the ground finer than the splatmap is, and the nearest pixel alone drew
        // every pixel of it as a flat square with an edge.
        const read = (splat: Splat | null): number[] => {
            if (!splat) return [0, 0, 0, 0];
            const fx = u * (splat.width - 1), fy = v * (splat.height - 1);
            const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, splat.width - 1), y1 = Math.min(y0 + 1, splat.height - 1);
            const tx = fx - x0, ty = fy - y0, px = splat.pixels, row0 = y0 * splat.width, row1 = y1 * splat.width;
            const out = [0, 0, 0, 0];
            for (let c = 0; c < 4; c++) {
                const top = px[(row0 + x0) * 4 + c]! * (1 - tx) + px[(row0 + x1) * 4 + c]! * tx;
                const bottom = px[(row1 + x0) * 4 + c]! * (1 - tx) + px[(row1 + x1) * 4 + c]! * tx;
                out[c] = (top * (1 - ty) + bottom * ty) / 255;
            }
            return out;
        };
        if (this.splat || this.splat2) {
            const s = [...read(this.splat), ...(this.splat2 ? read(this.splat2) : [])];
            const sum = s.reduce((a, b) => a + b, 0);
            if (sum > 0.001) w = s.map((c) => c / sum);
        }
        if (this.flow) {
            // Where the rain ran it took the grass and left dirt; the other layers stay as they are.
            const fx = Math.round(u * (this.field.width - 1)), fy = Math.round(v * (this.field.height - 1));
            const channel = smooth(0.45, 0.85, this.flow[fy * this.field.width + fx]!) * 0.8 * w[0]!;
            w[0] = w[0]! - channel;
            w[1] = w[1]! + channel;
        }
        return w;
    }
}

/** What shapes an infinite ground: the noise's seed and scale, and how worn and how ridged it is. */
export type NoiseParams = Pick<TerrainData, 'seed' | 'frequency' | 'octaves' | 'persistence' | 'ridged' | 'warp' | 'erosion' | 'sizeX' | 'height'
    | 'rockSlope' | 'dirtHeight' | 'snowHeight'>;

/**
 * Ground that goes on for ever: fractal noise read at any point, `frequency` hills to every `sizeX` world units, `height` tall at most.
 * `erosion` damps each octave by how steep the ones under it already are, which is what rain does to real ground.
 */
export class NoiseSource implements TerrainSource {
    readonly infinite = true;
    readonly bounds = null;
    readonly minHeight = 0;
    readonly maxHeight: number;

    constructor(private readonly p: NoiseParams) {
        this.maxHeight = p.height;
    }

    /** The ground as data: `NoiseSource.fromData` makes the same ground from it. */
    toData(): NoiseParams {
        return { ...this.p };
    }

    static fromData(p: NoiseParams): NoiseSource {
        return new NoiseSource(p);
    }

    height(x: number, z: number): number {
        return this.sample(x, z)[0] * this.p.height;
    }

    /** The normal at (x, z), from the noise's own slope. */
    normal(x: number, z: number): [number, number, number] {
        const [, dx, dz] = this.sample(x, z);
        const sx = dx * this.p.height, sz = dz * this.p.height;
        const len = Math.hypot(sx, 1, sz);
        return [-sx / len, 1 / len, -sz / len];
    }

    paint(_x: number, _z: number, h: number, ny: number): [number, number, number, number] {
        return paintWeights(h / Math.max(this.p.height, 1e-6), ny, this.p);
    }

    /** The height (0 to 1) at (x, z) and its slope along x and z, per world unit. */
    sample(x: number, z: number): [number, number, number] {
        const p = this.p;
        const scale = Math.max(p.frequency, 1e-6) / Math.max(p.sizeX, 1e-6);
        let u = x * scale, v = z * scale;
        const warp = Math.min(Math.max(p.warp, 0), 1);
        if (warp > 0) {
            // Pushed about by noise of its own, up to half a hill: valleys wind and ridges bend.
            u += (noised(u + 5.2, v + 1.3, p.seed + 7001)[0] * 2 - 1) * warp * 0.5;
            v += (noised(u + 8.3, v + 2.8, p.seed + 7003)[0] * 2 - 1) * warp * 0.5;
        }
        const octaves = Math.max(1, Math.min(8, Math.floor(p.octaves)));
        const wear = Math.min(Math.max(p.erosion, 0), 4);
        let amp = 1, freq = 1, sum = 0, norm = 0, dx = 0, dz = 0;
        // The slope the octaves so far have built up, which damps the ones that follow.
        let gx = 0, gz = 0;
        for (let o = 0; o < octaves; o++) {
            const [n, nx, nz] = noised(u * freq, v * freq, p.seed + o * 101);
            let value = n, ddx = nx * freq, ddz = nz * freq;
            if (p.ridged > 0) {
                // Folded about its middle into a crest, rounded over its last few hundredths: a slope that turned there at once would
                // jump the wear the octaves after it take from it, and with it the ground.
                const s = n * 2 - 1, root = Math.sqrt(s * s + RIDGE_ROUND * RIDGE_ROUND);
                const fold = (root - RIDGE_ROUND) / RIDGE_SPAN, turn = (s / root / RIDGE_SPAN) * 2;
                value = n * (1 - p.ridged) + (1 - fold) * p.ridged;
                ddx = ddx * (1 - p.ridged) - turn * ddx * p.ridged;
                ddz = ddz * (1 - p.ridged) - turn * ddz * p.ridged;
            }
            gx += ddx * amp; gz += ddz * amp;
            const damp = wear > 0 ? 1 / (1 + wear * (gx * gx + gz * gz) * 0.25) : 1;
            sum += value * amp * damp;
            dx += ddx * amp * damp; dz += ddz * amp * damp;
            norm += amp;
            amp *= p.persistence;
            freq *= 2;
        }
        return [sum / norm, (dx / norm) * scale, (dz / norm) * scale];
    }
}

/** How round a ridge's crest is, in the noise's own 0 to 1 (folded, -1 to 1), and what the rounded fold reaches at the ends. */
const RIDGE_ROUND = 0.06;
const RIDGE_SPAN = Math.sqrt(1 + RIDGE_ROUND * RIDGE_ROUND) - RIDGE_ROUND;

/** A 32-bit integer hash, stable across hosts, so a seed makes the same ground everywhere. */
function hash2(x: number, y: number, seed: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

/** Value noise at (x, y), 0 to 1, and its derivatives along x and y. */
export function noised(x: number, y: number, seed: number): [number, number, number] {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const dsx = 6 * fx * (1 - fx), dsy = 6 * fy * (1 - fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    const k1 = b - a, k2 = c - a, k3 = a - b - c + d;
    return [a + k1 * sx + k2 * sy + k3 * sx * sy, (k1 + k3 * sy) * dsx, (k2 + k3 * sx) * dsy];
}

function smooth(a: number, b: number, x: number): number {
    const t = Math.min(Math.max((x - a) / (b - a || 1e-6), 0), 1);
    return t * t * (3 - 2 * t);
}

/**
 * A change made to the ground over part of the world (a building's plot levelled, a riverbed cut): in world space, a height in and a
 * height out. Modifiers are applied in the order they were set, inside their bounds only.
 */
export interface TerrainModifier {
    readonly id: string;
    /** The world square it can change, [minX, minZ, maxX, maxZ], its edge included. */
    readonly bounds: readonly [number, number, number, number];
    /** The world height at world (x, z), given the height the ground has there. */
    apply(x: number, z: number, h: number): number;
}

/** A source with the modifiers laid over it: what the pages, the queries and collision all read. */
export class ModifiedSource implements TerrainSource {
    readonly infinite: boolean;
    readonly bounds: TerrainSource['bounds'];
    readonly minHeight: number;
    readonly maxHeight: number;
    /** The terrain's world position: its space is this far from the world's. Kept current by the terrain. */
    origin: { x: number; y: number; z: number };

    constructor(readonly base: TerrainSource, private readonly modifiers: () => Iterable<TerrainModifier>,
                origin: { x: number; y: number; z: number }, private readonly step: number) {
        this.infinite = base.infinite;
        this.bounds = base.bounds;
        this.minHeight = base.minHeight;
        this.maxHeight = base.maxHeight;
        this.origin = { ...origin };
    }

    height(x: number, z: number): number | null {
        const h = this.base.height(x, z);
        return h === null ? null : this.modify(x, z, h);
    }

    normal(x: number, z: number): [number, number, number] | null {
        if (!this.touched(x - this.step, z - this.step, x + this.step, z + this.step)) return this.base.normal(x, z);
        const e = this.step;
        const l = this.height(x - e, z), r = this.height(x + e, z), d = this.height(x, z - e), u = this.height(x, z + e);
        if (l === null || r === null || d === null || u === null) return null;
        const sx = (r - l) / (2 * e), sz = (u - d) / (2 * e), len = Math.hypot(sx, 1, sz);
        return [-sx / len, 1 / len, -sz / len];
    }

    paint(x: number, z: number, h: number, ny: number): LayerWeights {
        return this.base.paint(x, z, h, ny);
    }

    get region(): TerrainSource['region'] {
        const region = this.base.region?.bind(this.base);
        if (!region) return undefined;
        return (x0, z0, spacing, count) => {
            const got = region(x0, z0, spacing, count);
            const lay = (r: TerrainRegionSamples) => {
                if (!this.touched(x0, z0, x0 + spacing * (count - 1), z0 + spacing * (count - 1))) return r;
                const heights = new Float32Array(r.heights);
                for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
                    heights[j * count + i] = this.modify(x0 + i * spacing, z0 + j * spacing, heights[j * count + i]!);
                }
                return { ...r, heights };
            };
            return got instanceof Promise ? got.then(lay) : lay(got);
        };
    }

    /** Whether any modifier can change something in the square [x0, x1] by [z0, z1] of the terrain's space. */
    touched(x0: number, z0: number, x1: number, z1: number): boolean {
        const ox = this.origin.x, oz = this.origin.z;
        for (const m of this.modifiers()) {
            const b = m.bounds;
            if (b[0] <= x1 + ox && b[2] >= x0 + ox && b[1] <= z1 + oz && b[3] >= z0 + oz) return true;
        }
        return false;
    }

    private modify(x: number, z: number, h: number): number {
        const wx = x + this.origin.x, wz = z + this.origin.z, oy = this.origin.y;
        let out = h + oy;
        for (const m of this.modifiers()) {
            const b = m.bounds;
            if (wx < b[0] || wx > b[2] || wz < b[1] || wz > b[3]) continue;
            out = m.apply(wx, wz, out);
        }
        return Math.min(Math.max(out - oy, this.minHeight), this.maxHeight);
    }
}

/**
 * Levels the ground to world height `height` over a circle or a turned rectangle, blending back to the ground over `falloff` world
 * units past its outline: a plot built on, a landing pad, a road's bed.
 */
export function flattenModifier(id: string, shape:
    | { type: 'circle'; x: number; z: number; radius: number }
    | { type: 'rect'; x: number; z: number; halfX: number; halfZ: number; yaw?: number }, height: number, falloff: number): TerrainModifier {
    const reach = (shape.type === 'circle' ? shape.radius : Math.hypot(shape.halfX, shape.halfZ)) + Math.max(falloff, 0);
    const outside = (x: number, z: number): number => {
        if (shape.type === 'circle') return Math.hypot(x - shape.x, z - shape.z) - shape.radius;
        const c = Math.cos(-(shape.yaw ?? 0)), s = Math.sin(-(shape.yaw ?? 0));
        const dx = x - shape.x, dz = z - shape.z;
        const lx = Math.abs(dx * c - dz * s) - shape.halfX, lz = Math.abs(dx * s + dz * c) - shape.halfZ;
        return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
    };
    return {
        id,
        bounds: [shape.x - reach, shape.z - reach, shape.x + reach, shape.z + reach],
        apply(x, z, h) {
            const d = outside(x, z);
            if (d <= 0) return height;
            if (falloff <= 0 || d >= falloff) return h;
            const t = 1 - d / falloff, w = t * t * (3 - 2 * t);
            return h + (height - h) * w;
        },
    };
}
