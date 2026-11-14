// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  landBake.ts — runs a land source's steps over a grid of heights, and measures what came of them.
 *
 * Heights are world units on a square grid, row 0 the least z. Each step changes them in place and says how far it raised and
 * lowered the ground; rivers, roads and lakes also leave where they are (a line with heights, a level), which is what a scene
 * puts water and road surfaces on, and how far every sample is from the nearest of each, which is what layers and maps are
 * laid by. Nothing here knows an engine: it is arithmetic, so a test or a tool can run it anywhere.
 */
import { erodeHeightfield } from '../../../sdk/src/terrain/heightfield';
import { LandBuildError, landInWorldUnits, validateLandSource, type LandLayer, type LandMap, type LandStand, type LandSource, type LandStep, type LinePoint, type Point2, type Where } from './landSource';

export interface BakedRiver {
    name: string;
    /** The water's line: world x, y (its surface) and z, and its width there. */
    points: { x: number; y: number; z: number; width: number }[];
    length: number;
    /** Where it drops sheer: the lip, and how far it falls. */
    falls: { at: [number, number, number]; drop: number }[];
}
export interface BakedRoad {
    name: string;
    points: { x: number; y: number; z: number }[];
    length: number;
    /** The grade asked for, and the steepest stretch it came out with (rise over run, and in degrees), and where. */
    asked: number;
    steepest: { grade: number; degrees: number; at: [number, number] };
    /** The deepest it cuts into the ground and the highest it is banked up over it. */
    cut: number;
    fill: number;
    /** False when its ends are further apart in height than its length allows at the grade: it needs a longer way round. */
    reachable: boolean;
}
export interface BakedLake { name: string; at: [number, number]; radius: number; level: number }

export interface LandReport {
    resolution: number;
    /** World units between samples. */
    cell: number;
    min: number;
    max: number;
    sea: number | null;
    /** Shares of the ground (above the sea) by how steep it is: walkable under 25 degrees, steep to 45, cliff beyond. */
    slopes: { walkable: number; steep: number; cliff: number };
    /** The share of the ground (above the sea) that is creased: where it bends by more than 25 degrees from one sample to the next. Round country has almost none outside its cliffs. */
    creased: number;
    steps: { index: number; op: string; id?: string; raised: number; lowered: number }[];
    rivers: BakedRiver[];
    roads: BakedRoad[];
    lakes: BakedLake[];
    layers: { name: string; cover: number }[];
    /** How many of each stand there are. */
    stands: { name: string; count: number }[];
    /** How many of each plant that is placed one by one stand. */
    groves: { plant: string; count: number }[];
    warnings: string[];
}

/** A kind of plant placed one by one: where each stands, five numbers a plant (x, y, z in the world, its turn in radians, its size). */
export interface BakedGrove { plant: string; places: number[] }

export interface StandPlace { model: number; x: number; y: number; z: number; scale: number; turn: number; lean: number; leanToward: number }
export interface BakedStand { name: string; models: { mesh: string; material?: string; texture?: string }[]; collide: boolean; places: StandPlace[] }

export interface BakedLand {
    source: LandSource;
    /** Samples a side. */
    n: number;
    size: [number, number];
    center: [number, number];
    /** n * n heights in world units, row by row from the least z. */
    heights: Float32Array;
    /** The side of the layer weights and the maps: n - 1. */
    m: number;
    /** One byte a sample for each layer, in the layers' order. */
    weights: { name: string; file?: string; values: Uint8Array }[];
    maps: { name: string; values: Uint8Array }[];
    /** The wash of colour, m * m RGBA bytes (sRGB, its alpha how much of it is laid), where the source has tints. */
    tint: Uint8Array | null;
    /** What stands on the land, each place in the world: where its foot is, which model, how large, turned (degrees about upright) and leant (a unit axis in the ground and degrees about it). */
    stands: BakedStand[];
    /** The plants that are placed one by one (those with `lods`), a grove for each. */
    groves: BakedGrove[];
    /** How far each sample (n * n) is from the nearest water's edge, road's edge, lake's shore and coast (inland positive), where there is one. */
    fields: { river: Float32Array | null; road: Float32Array | null; lake: Float32Array | null; coast: Float32Array | null };
    report: LandReport;
}

// ---- noise ---------------------------------------------------------------------
function hash(ix: number, iz: number, seed: number): number {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}
function vnoise(x: number, z: number, seed: number): number {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
/** Fractal noise, 0 to 1, most of it between 0.3 and 0.7. */
export function landNoise(x: number, z: number, seed: number, octaves = 4): number {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * vnoise(x, z, seed + i * 17);
        norm += amp;
        x = x * 2.03 + 11.7; z = z * 2.03 - 5.3; amp *= 0.5;
    }
    return sum / norm;
}
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ridged = (v: number): number => 1 - Math.abs(2 * v - 1);

// ---- lines and outlines ----------------------------------------------------------
interface Line { xs: Float64Array; zs: Float64Array; at: Float64Array; length: number }
function lineOf(points: readonly (readonly number[])[]): Line {
    const xs = new Float64Array(points.length), zs = new Float64Array(points.length), at = new Float64Array(points.length);
    for (let i = 0; i < points.length; i++) {
        xs[i] = points[i]![0]!; zs[i] = points[i]![1]!;
        if (i > 0) at[i] = at[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!);
    }
    return { xs, zs, at, length: at[points.length - 1]! };
}
/**
 * A line's points with more put between them, on a curve that passes through every one (Catmull-Rom): a river or a road written as
 * six points bends as water and feet do, where the six joined by straight runs cut a valley with corners. A stretch shorter than
 * `keep` is left straight, so two points set close together to make a fall stay a fall. Every value a point carries beside its
 * place (its height, its width) is carried along evenly between the points it lay between; `undefined` stays undefined.
 */
function rounded<T extends readonly (number | undefined)[]>(points: readonly T[], keep: number, stride: number): (number | undefined)[][] {
    if (points.length < 3) return points.map((p) => [...p]);
    const out: (number | undefined)[][] = [];
    for (let i = 0; i + 1 < points.length; i++) {
        const a = points[Math.max(i - 1, 0)]!, b = points[i]!, c = points[i + 1]!, d = points[Math.min(i + 2, points.length - 1)]!;
        const run = Math.hypot(c[0]! - b[0]!, c[1]! - b[1]!);
        const parts = run <= keep ? 1 : Math.min(16, Math.max(1, Math.ceil(run / stride)));
        for (let s = 0; s < parts; s++) {
            const t = s / parts;
            if (s === 0) { out.push([...b]); continue; }
            const t2 = t * t, t3 = t2 * t;
            const at = (k: number): number => 0.5 * ((2 * b[k]!) + (-a[k]! + c[k]!) * t + (2 * a[k]! - 5 * b[k]! + 4 * c[k]! - d[k]!) * t2 + (-a[k]! + 3 * b[k]! - 3 * c[k]! + d[k]!) * t3);
            const extra = b.slice(2).map((v, k) => (v === undefined || c[k + 2] === undefined ? undefined : (v as number) + ((c[k + 2] as number) - (v as number)) * t));
            out.push([at(0), at(1), ...extra]);
        }
    }
    out.push([...points[points.length - 1]!]);
    return out;
}

/** The nearest place on a line: how far it is, how far along the line, and the segment and share of it. */
function nearest(line: Line, x: number, z: number): { d: number; along: number; seg: number; t: number } {
    let d = Infinity, along = 0, seg = 0, share = 0;
    for (let i = 0; i + 1 < line.xs.length; i++) {
        const ax = line.xs[i]!, az = line.zs[i]!, dx = line.xs[i + 1]! - ax, dz = line.zs[i + 1]! - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
        const dd = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (dd < d) { d = dd; seg = i; share = t; along = line.at[i]! + (line.at[i + 1]! - line.at[i]!) * t; }
    }
    return { d, along, seg, t: share };
}
/** How far inside a closed outline a place is (negative outside). */
function insideOutline(outline: readonly Point2[], x: number, z: number): number {
    let inside = false, d = Infinity;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const [ax, az] = outline[i]!, [bx, bz] = outline[j]!;
        if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
        d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return inside ? d : -d;
}

// ---- the grid ----------------------------------------------------------------------
class Grid {
    readonly h: Float32Array;
    readonly cellX: number;
    readonly cellZ: number;
    /** How far each sample is from the nearest water's edge, road's edge, lake's shore and coast (inland positive); made when first written. */
    riverD: Float32Array | null = null;
    roadD: Float32Array | null = null;
    lakeD: Float32Array | null = null;
    coastD: Float32Array | null = null;
    constructor(readonly n: number, readonly sx: number, readonly sz: number, readonly cx: number, readonly cz: number) {
        this.h = new Float32Array(n * n);
        this.cellX = sx / (n - 1);
        this.cellZ = sz / (n - 1);
    }
    x(i: number): number { return this.cx + (i / (this.n - 1) - 0.5) * this.sx; }
    z(j: number): number { return this.cz + (j / (this.n - 1) - 0.5) * this.sz; }
    /** The index range that holds a world box, clamped to the grid. */
    box(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
        const i0 = clamp(Math.floor((x0 - this.cx) / this.sx * (this.n - 1) + (this.n - 1) / 2), 0, this.n - 1);
        const i1 = clamp(Math.ceil((x1 - this.cx) / this.sx * (this.n - 1) + (this.n - 1) / 2), 0, this.n - 1);
        const j0 = clamp(Math.floor((z0 - this.cz) / this.sz * (this.n - 1) + (this.n - 1) / 2), 0, this.n - 1);
        const j1 = clamp(Math.ceil((z1 - this.cz) / this.sz * (this.n - 1) + (this.n - 1) / 2), 0, this.n - 1);
        return [i0, j0, i1, j1];
    }
    /** The ground at a world place, between samples. */
    at(x: number, z: number): number {
        const fi = clamp((x - this.cx) / this.sx * (this.n - 1) + (this.n - 1) / 2, 0, this.n - 1.001);
        const fj = clamp((z - this.cz) / this.sz * (this.n - 1) + (this.n - 1) / 2, 0, this.n - 1.001);
        const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * this.n + i;
        return mix(mix(this.h[k]!, this.h[k + 1]!, u), mix(this.h[k + this.n]!, this.h[k + this.n + 1]!, u), v);
    }
    /** The slope at a sample, in degrees from level. */
    slope(i: number, j: number): number {
        const n = this.n, a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1), c = Math.max(j - 1, 0), d = Math.min(j + 1, n - 1);
        const gx = (this.h[j * n + b]! - this.h[j * n + a]!) / ((b - a) * this.cellX);
        const gz = (this.h[d * n + i]! - this.h[c * n + i]!) / ((d - c) * this.cellZ);
        return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
    }
    field(name: 'riverD' | 'roadD' | 'lakeD' | 'coastD'): Float32Array {
        return this[name] ??= new Float32Array(this.n * this.n).fill(name === 'coastD' ? 1e9 : 1e9);
    }
}

/** A heightmap picture a source names, read by whoever runs the bake: its heights 0 to 1, row by row. */
export interface LandPicture { width: number; height: number; data: Float32Array }

interface StepOut { rivers: BakedRiver[]; roads: BakedRoad[]; lakes: BakedLake[]; warnings: string[]; inputs?: Readonly<Record<string, LandPicture>> }

type Mask = (i: number, j: number) => number;
const ALL: Mask = () => 1;

/** What a `where` comes to at each sample. `weights` are the layers laid so far, for `layer`. */
function maskOf(g: Grid, where: Where | undefined, range: number, weights?: ReadonlyMap<string, Float32Array>): Mask {
    if (!where) return ALL;
    const feather = Math.max(where.feather ?? range * 0.02, 1e-6);
    const fieldOf = (what: 'river' | 'road' | 'lake' | 'coast'): Float32Array | null => g[`${what}D` as 'riverD'];
    const layer = where.layer !== undefined ? weights?.get(where.layer) : undefined;
    if (where.layer !== undefined && !layer) throw new LandBuildError(`where.layer names "${where.layer}", which is not a layer laid before this one`);
    for (const key of ['near', 'far'] as const) {
        const by = where[key];
        if (by && !fieldOf(by.what)) throw new LandBuildError(`where.${key} asks for the nearest ${by.what}, and no step has made one`);
    }
    return (i, j) => {
        const k = j * g.n + i, h = g.h[k]!;
        let m = 1;
        if (where.above !== undefined) m *= smooth(where.above - feather, where.above + feather, h);
        if (where.below !== undefined) m *= smooth(where.below + feather, where.below - feather, h);
        if (m <= 0) return 0;
        if (where.steeper !== undefined || where.gentler !== undefined) {
            const s = g.slope(i, j);
            if (where.steeper !== undefined) m *= smooth(where.steeper - 2, where.steeper + 2, s);
            if (where.gentler !== undefined) m *= smooth(where.gentler + 2, where.gentler - 2, s);
            if (m <= 0) return 0;
        }
        const x = g.x(i), z = g.z(j);
        if (where.within) {
            const d = Math.hypot(x - where.within.at[0], z - where.within.at[1]);
            m *= smooth(where.within.radius + Math.max(where.within.feather ?? 0, 1e-6), where.within.radius, d);
        }
        if (where.outline) m *= smooth(-Math.max(where.outlineFeather ?? 0, 1e-6), 0, insideOutline(where.outline, x, z));
        if (where.noise) {
            const cover = clamp(where.noise.cover ?? 0.5, 0, 1), soft = clamp(where.noise.soft ?? 0.3, 0.01, 1);
            // Most of the noise lies between 0.3 and 0.7: `cover` is read across that band.
            const edge = 0.7 - 0.4 * cover;
            m *= smooth(edge - soft * 0.1, edge + soft * 0.1, landNoise(x / where.noise.scale, z / where.noise.scale, where.noise.seed ?? 1, 3));
        }
        if (where.near) { const d = fieldOf(where.near.what)![k]!; m *= smooth(where.near.within + Math.max(where.near.fade ?? 0, 1e-6), where.near.within, where.near.what === 'coast' ? Math.abs(d) : d); }
        if (where.far) { const d = fieldOf(where.far.what)![k]!; m *= smooth(where.far.within, where.far.within + Math.max(where.far.fade ?? 0, 1e-6), where.far.what === 'coast' ? Math.abs(d) : d); }
        if (layer) m *= layer[k]!;
        return m;
    };
}

/** A slope cut into ledges `step` high, as sheer as `hard` (0..1). */
function ledged(h: number, step: number, hard: number, phase: number): number {
    const t = h / step + phase, f = Math.floor(t), fr = t - f;
    const half = 0.5 * (1 - hard * 0.82);
    return mix(h, (f + smooth(0.5 - half, 0.5 + half, fr) - phase) * step, hard);
}

/** The heights a line's points are said to have, filled in between by distance along it; `undefined` where none was said. */
function saidHeights(path: readonly LinePoint[]): (number | undefined)[] {
    return path.map((p) => (p.length >= 3 ? p[2] : undefined)) as (number | undefined)[];
}
function fillBetween(ys: (number | undefined)[], line: Line): number[] {
    const out = ys.slice() as number[];
    let last = -1;
    for (let i = 0; i < ys.length; i++) {
        if (ys[i] === undefined) continue;
        if (last >= 0) for (let k = last + 1; k < i; k++) out[k] = mix(ys[last]!, ys[i]!, (line.at[k]! - line.at[last]!) / Math.max(line.at[i]! - line.at[last]!, 1e-9));
        last = i;
    }
    return out;
}

// ---- the steps ---------------------------------------------------------------------
function runStep(g: Grid, step: LandStep, index: number, source: LandSource, out: StepOut, range: number): void {
    const n = g.n, h = g.h;
    const mask = maskOf(g, step.where, range);
    const each = (box: [number, number, number, number], fn: (i: number, j: number, k: number, x: number, z: number) => void): void => {
        for (let j = box[1]; j <= box[3]; j++) { const z = g.z(j); for (let i = box[0]; i <= box[2]; i++) fn(i, j, j * n + i, g.x(i), z); }
    };
    const whole: [number, number, number, number] = [0, 0, n - 1, n - 1];
    const seed = ('seed' in step && step.seed !== undefined ? step.seed : 1) + index * 101;
    switch (step.op) {
        case 'fill':
            each(whole, (i, j, k) => { h[k] = mix(h[k]!, step.height, mask(i, j)); });
            return;
        case 'noise': {
            const warp = clamp(step.warp ?? 0, 0, 1), rg = clamp(step.ridged ?? 0, 0, 1), oct = step.octaves ?? 5;
            each(whole, (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                let u = x / step.scale, v = z / step.scale;
                if (warp > 0) { u += warp * 1.6 * (landNoise(u + 3.1, v, seed + 5, 3) - 0.5); v += warp * 1.6 * (landNoise(u, v + 7.7, seed + 6, 3) - 0.5); }
                const val = landNoise(u, v, seed, oct);
                h[k] = h[k]! + step.amplitude * mix(val - 0.5, ridged(val) - 0.5, rg) * 2 * m;
            });
            return;
        }
        case 'hill': {
            const flat = Math.min(step.flat ?? 0, step.radius * 0.95);
            each(g.box(step.at[0] - step.radius, step.at[1] - step.radius, step.at[0] + step.radius, step.at[1] + step.radius), (i, j, k, x, z) => {
                h[k] = h[k]! + step.height * smooth(step.radius, flat, Math.hypot(x - step.at[0], z - step.at[1])) * mask(i, j);
            });
            return;
        }
        case 'ridge': {
            const line = lineOf(step.straight ? step.path : (rounded(step.path.map((p) => [p[0], p[1]] as const), step.width * 0.5, step.width * 0.5) as number[][])), peaks = clamp(step.peaks ?? 0.6, 0, 1), spurs = clamp(step.spurs ?? 0.5, 0, 1), reach = step.width * 1.5;
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let i = 0; i < line.xs.length; i++) { x0 = Math.min(x0, line.xs[i]!); x1 = Math.max(x1, line.xs[i]!); z0 = Math.min(z0, line.zs[i]!); z1 = Math.max(z1, line.zs[i]!); }
            each(g.box(x0 - reach, z0 - reach, x1 + reach, z1 + reach), (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                const near = nearest(line, x, z);
                // The flanks are not a ruled slope: side ridges push the foot out and pull it in.
                const u = near.d / (step.width * (1 + spurs * 0.9 * (ridged(landNoise(x / (step.width * 0.4), z / (step.width * 0.4), seed + 2, 3)) - 0.5)));
                if (u >= 1) return;
                const crest = mix(1, 0.4 + 0.8 * ridged(landNoise(near.along / (step.width * 0.9), 1.7, seed, 3)) ** 1.3, peaks);
                // The ends of the range come down, where a line that simply stopped would end in a wall.
                const ends = smooth(0, step.width * 0.8, Math.min(near.along, line.length - near.along) + step.width * 0.15);
                h[k] = h[k]! + step.height * crest * ends * smooth(1, 0, u) ** 1.35 * m;
            });
            return;
        }
        case 'plateau': {
            if (!step.outline && !(step.at && step.radius !== undefined)) throw new LandBuildError('a plateau wants `at` and `radius`, or an `outline`');
            const ragged = step.ragged ?? 0, ledges = Math.max(0, Math.round(step.ledges ?? 0));
            const reach = step.edge + ragged * 2;
            let box = whole;
            if (step.at && step.radius !== undefined) box = g.box(step.at[0] - step.radius - reach, step.at[1] - step.radius - reach, step.at[0] + step.radius + reach, step.at[1] + step.radius + reach);
            const mid: Point2 = step.at ?? [step.outline!.reduce((s, p) => s + p[0], 0) / step.outline!.length, step.outline!.reduce((s, p) => s + p[1], 0) / step.outline!.length];
            each(box, (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                let s = step.outline ? insideOutline(step.outline, x, z) : step.radius! - Math.hypot(x - step.at![0], z - step.at![1]);
                if (ragged > 0) s += ragged * 2 * (landNoise(x / (ragged * 5), z / (ragged * 5), seed, 3) - 0.5) + ragged * 0.6 * (landNoise(x / (ragged * 0.9), z / (ragged * 0.9), seed + 3, 2) - 0.5);
                let t = smooth(-step.edge / 2, step.edge / 2, s);
                if (t <= 0) return;
                if (ledges > 0 && t < 1) { const q = t * ledges, f = Math.floor(q); t = (f + smooth(0.2, 0.8, q - f)) / ledges; }
                const top = step.height + (step.tilt ? step.tilt[0] * (x - mid[0]) + step.tilt[1] * (z - mid[1]) : 0);
                h[k] = mix(h[k]!, top, t * m);
            });
            return;
        }
        case 'lake': {
            const shore = step.shore ?? step.radius * 0.35, ragged = step.ragged ?? step.radius * 0.12;
            const lakeD = g.field('lakeD');
            const reach = step.radius + shore + ragged;
            each(g.box(step.at[0] - reach, step.at[1] - reach, step.at[0] + reach, step.at[1] + reach), (i, j, k, x, z) => {
                const d = Math.hypot(x - step.at[0], z - step.at[1]) + ragged * 2 * (landNoise(x / (step.radius * 0.7), z / (step.radius * 0.7), seed, 3) - 0.5);
                lakeD[k] = Math.min(lakeD[k]!, d - step.radius);
                const m = mask(i, j);
                if (m <= 0) return;
                const rim = step.level + step.depth * 0.06;
                if (d <= step.radius) h[k] = mix(h[k]!, step.level - step.depth * smooth(step.radius, step.radius * 0.35, d) - step.depth * 0.04, m);
                else if (d < step.radius + shore) {
                    const out = d - step.radius;
                    // A rim that holds the water where the ground lay lower, and a shore that comes down to it where it stood higher.
                    const held = Math.min(Math.max(h[k]!, rim), rim + out * 0.9);
                    h[k] = mix(h[k]!, mix(held, h[k]!, smooth(shore * 0.5, shore, out)), m);
                }
            });
            out.lakes.push({ name: step.name ?? `lake${out.lakes.length + 1}`, at: [step.at[0], step.at[1]], radius: step.radius, level: step.level });
            return;
        }
        case 'river': {
            // Heights and widths are settled on the points as written; then the line is rounded through them.
            const written = lineOf(step.path);
            const given = saidHeights(step.path);
            if (given[0] === undefined) given[0] = g.at(written.xs[0]!, written.zs[0]!);
            const end = given.length - 1;
            if (given[end] === undefined) {
                const before = given.slice(0, end).reverse().find((v) => v !== undefined)!;
                given[end] = Math.min(g.at(written.xs[end]!, written.zs[end]!), before, source.sea ?? Infinity);
            }
            const settled = fillBetween(given, written);
            // Said of the points as the author wrote them: the ones the curve adds are not theirs to mend.
            for (let i = 1; i < settled.length; i++) {
                if (settled[i]! > settled[i - 1]! + 1e-6) throw new LandBuildError(`the river rises from ${settled[i - 1]!.toFixed(1)} to ${settled[i]!.toFixed(1)} at point ${i}: water runs down, so give heights that never rise`);
            }
            const pathWide = step.path.map((p, i) => [p[0], p[1], settled[i]!, p.length >= 4 ? (p as readonly number[])[3]! : step.width] as const);
            const path = (step.straight ? pathWide.map((p) => [...p]) : rounded(pathWide, step.width * 3, step.width * 1.5)) as number[][];
            const line = lineOf(path);
            const said: (number | undefined)[] = path.map((p) => p[2]);
            if (said[0] === undefined) said[0] = g.at(line.xs[0]!, line.zs[0]!);
            const last = said.length - 1;
            if (said[last] === undefined) {
                const before = said.slice(0, last).reverse().find((v) => v !== undefined)!;
                said[last] = Math.min(g.at(line.xs[last]!, line.zs[last]!), before, source.sea ?? Infinity);
            }
            const ys = fillBetween(said, line);
            for (let i = 1; i < ys.length; i++) {
                if (ys[i]! > ys[i - 1]! + 1e-6) throw new LandBuildError(`the river rises from ${ys[i - 1]!.toFixed(1)} to ${ys[i]!.toFixed(1)} at point ${i}: water runs down, so give heights that never rise`);
            }
            const widths = path.map((p) => p[3]!);
            const depth = step.depth ?? Math.max(step.width * 0.1, g.cellX * 0.5), bank = Math.max(step.bank ?? step.width * 0.25, g.cellX * 1.5);
            const plain = step.plain ?? step.width * 0.8, valley = Math.max(step.valley ?? 0.9, 0.05);
            const riverD = g.field('riverD');
            let top = -Infinity, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (const v of h) if (v > top) top = v;
            for (let i = 0; i < line.xs.length; i++) { x0 = Math.min(x0, line.xs[i]!); x1 = Math.max(x1, line.xs[i]!); z0 = Math.min(z0, line.zs[i]!); z1 = Math.max(z1, line.zs[i]!); }
            const reach = Math.max(...widths) + bank + plain + Math.max(top - ys[ys.length - 1]!, 0) / valley + 40 * g.cellX;
            each(g.box(x0 - reach, z0 - reach, x1 + reach, z1 + reach), (i, j, k, x, z) => {
                const near = nearest(line, x, z);
                const alt = mix(ys[near.seg]!, ys[near.seg + 1]!, near.t), width = mix(widths[near.seg]!, widths[near.seg + 1]!, near.t);
                // A bank is not a ruled line: the water's edge wanders by a share of its width.
                const half = width / 2 * (1 + 0.45 * (landNoise(x / (width * 1.3), z / (width * 1.3), seed, 2) - 0.5));
                const edge = near.d - half;
                riverD[k] = Math.min(riverD[k]!, edge);
                const m = mask(i, j);
                if (m <= 0) return;
                const bed = alt - depth * smooth(0, -half, edge) - depth * 0.25;
                let cut: number;
                if (edge <= 0) cut = bed;
                else if (edge <= bank) cut = mix(bed, Math.min(Math.max(h[k]!, alt + depth * 0.25), alt + depth * 0.9), smooth(0, bank, edge));
                else {
                    const beyond = Math.max(0, edge - bank - plain);
                    const rough = 0.75 + 0.5 * landNoise(x / (width * 4), z / (width * 4), seed + 9, 2);
                    let wall = alt + depth * 0.9 + valley * beyond * rough;
                    // Away from its own bank the wall is as low as ANY reach of the river allows, not only the nearest: under a fall the
                    // lower reach's valley opens round the foot of it, so the headwall is a bowl about the plunge and not a ruled line
                    // across the valley where the nearest reach changes.
                    const open = smooth(bank + plain, bank + plain + width * 3, edge);
                    if (open > 0) {
                        let lowest = wall;
                        for (let q = 0; q + 1 < line.xs.length; q++) {
                            const ax = line.xs[q]!, az = line.zs[q]!, ex = line.xs[q + 1]! - ax, ez = line.zs[q + 1]! - az, len2 = ex * ex + ez * ez;
                            const t = len2 > 0 ? clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1) : 0;
                            const far = Math.hypot(x - ax - ex * t, z - az - ez * t) - mix(widths[q]!, widths[q + 1]!, t) / 2 - bank - plain;
                            // Round a plunge the rock stands sheer: a reach that is not the nearest cuts its bowl far steeper than its own
                            // valley's sides, or a fall would land on a slope half way down.
                            const other = mix(ys[q]!, ys[q + 1]!, t) + depth * 0.9 + Math.max(valley, 6) * Math.max(0, far) * rough;
                            if (other < lowest) lowest = other;
                        }
                        wall = mix(wall, lowest, open);
                    }
                    // Ground that lay under the water's height is banked up to carry it, the bank fading out over the plain.
                    const floor = mix(alt + depth * 0.7, h[k]!, smooth(bank, bank + plain + width, edge));
                    cut = Math.max(Math.min(h[k]!, wall), Math.min(floor, alt + depth * 0.9));
                }
                h[k] = mix(h[k]!, cut, m);
            });
            const river: BakedRiver = { name: step.name ?? `river${out.rivers.length + 1}`, points: [], length: line.length, falls: [] };
            for (let i = 0; i < ys.length; i++) river.points.push({ x: +line.xs[i]!.toFixed(2), y: +ys[i]!.toFixed(3), z: +line.zs[i]!.toFixed(2), width: +widths[i]!.toFixed(2) });
            for (let i = 0; i + 1 < ys.length; i++) {
                const run = line.at[i + 1]! - line.at[i]!, drop = ys[i]! - ys[i + 1]!;
                if (drop > depth * 3 && drop / Math.max(run, 1e-6) > 1.2) river.falls.push({ at: [line.xs[i]!, ys[i]!, line.zs[i]!], drop });
            }
            out.rivers.push(river);
            return;
        }
        case 'road': {
            const bent = step.straight ? step.path.map((p) => [...p] as (number | undefined)[]) : rounded(step.path.map((p) => [p[0], p[1], p.length >= 3 ? p[2] : undefined] as const), step.width * 2, step.width * 2);
            const coarse = lineOf(bent as number[][]);
            const saidAt: (number | undefined)[] = bent.map((p) => p[2]);
            const ds = Math.max(g.cellX, step.width / 2);
            // The way, a sample every `ds` along it, with the heights its points pin.
            const count = Math.max(2, Math.ceil(coarse.length / ds) + 1);
            const px = new Float64Array(count), pz = new Float64Array(count), ground = new Float64Array(count), y = new Float64Array(count);
            const pinned = new Uint8Array(count);
            for (let s = 0; s < count; s++) {
                const along = (s / (count - 1)) * coarse.length;
                let seg = 0;
                while (seg + 2 < coarse.at.length && coarse.at[seg + 1]! < along) seg++;
                const t = clamp((along - coarse.at[seg]!) / Math.max(coarse.at[seg + 1]! - coarse.at[seg]!, 1e-9), 0, 1);
                px[s] = mix(coarse.xs[seg]!, coarse.xs[seg + 1]!, t); pz[s] = mix(coarse.zs[seg]!, coarse.zs[seg + 1]!, t);
                ground[s] = g.at(px[s]!, pz[s]!);
            }
            // Only a height the author wrote pins the way (those between were carried along the curve, and are not theirs), and its ends.
            const wrote = new Set<string>(step.path.filter((p) => p.length >= 3).map((p) => `${p[0]},${p[1]}`));
            for (let p = 0; p < bent.length; p++) {
                const s = Math.round(coarse.at[p]! / coarse.length * (count - 1));
                if (wrote.has(`${bent[p]![0]},${bent[p]![1]}`)) { y[s] = saidAt[p]!; pinned[s] = 1; }
                else if (p === 0 || p === bent.length - 1) { y[s] = ground[s]!; pinned[s] = 1; }
            }
            const step1 = coarse.length / (count - 1), grade = Math.max(step.grade ?? 0.18, 0.005);
            // Between each two pinned heights the way follows the ground eased along it, held to what the grade allows: no further from
            // either pin than the run to it can climb, and no stretch steeper than the grade. Where the pins are further apart in
            // height than the run between them can climb, it is a straight ramp, as steep as it must be, and the reply says so.
            const most = grade * step1;
            const pins: number[] = [];
            for (let s = 0; s < count; s++) if (pinned[s]) pins.push(s);
            for (let p = 0; p + 1 < pins.length; p++) {
                const from = pins[p]!, to = pins[p + 1]!;
                if (Math.abs(y[to]! - y[from]!) > most * (to - from)) {
                    for (let s = from + 1; s < to; s++) y[s] = mix(y[from]!, y[to]!, (s - from) / (to - from));
                    continue;
                }
                for (let s = from + 1; s < to; s++) {
                    let sum = 0, got = 0;
                    for (let o = -4; o <= 4; o++) { const q = s + o; if (q >= 0 && q < count) { sum += ground[q]!; got++; } }
                    const lo = Math.max(y[from]! - most * (s - from), y[to]! - most * (to - s)), hi = Math.min(y[from]! + most * (s - from), y[to]! + most * (to - s));
                    y[s] = clamp(sum / got, lo, hi);
                }
                for (let s = from + 1; s < to; s++) y[s] = clamp(y[s]!, y[s - 1]! - most, y[s - 1]! + most);
                for (let s = to - 1; s > from; s--) y[s] = clamp(y[s]!, y[s + 1]! - most, y[s + 1]! + most);
            }
            let steep = 0, steepAt = 0, cutMost = 0, fillMost = 0;
            for (let s = 0; s + 1 < count; s++) { const gr = Math.abs(y[s + 1]! - y[s]!) / step1; if (gr > steep) { steep = gr; steepAt = s; } }
            for (let s = 0; s < count; s++) { cutMost = Math.max(cutMost, ground[s]! - y[s]!); fillMost = Math.max(fillMost, y[s]! - ground[s]!); }
            const fine: Line = { xs: px, zs: pz, at: Float64Array.from({ length: count }, (_, s) => s * step1), length: coarse.length };
            const side = Math.max(step.side ?? 0.7, 0.05), half = step.width / 2;
            const roadD = g.field('roadD');
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let s = 0; s < count; s++) { x0 = Math.min(x0, px[s]!); x1 = Math.max(x1, px[s]!); z0 = Math.min(z0, pz[s]!); z1 = Math.max(z1, pz[s]!); }
            const reach = half + Math.max(cutMost, fillMost) / side + 4 * g.cellX;
            each(g.box(x0 - reach, z0 - reach, x1 + reach, z1 + reach), (i, j, k, x, z) => {
                const near = nearest(fine, x, z);
                roadD[k] = Math.min(roadD[k]!, near.d - half);
                const m = mask(i, j);
                if (m <= 0 || near.d > reach) return;
                const level = mix(y[near.seg]!, y[near.seg + 1]!, near.t), beyond = Math.max(0, near.d - half);
                h[k] = mix(h[k]!, clamp(h[k]!, level - side * beyond, level + side * beyond), m);
            });
            const road: BakedRoad = {
                name: step.name ?? `road${out.roads.length + 1}`, points: [], length: coarse.length, asked: grade,
                steepest: { grade: steep, degrees: Math.atan(steep) * 180 / Math.PI, at: [px[steepAt]!, pz[steepAt]!] },
                cut: cutMost, fill: fillMost, reachable: steep <= grade * 1.02 + 1e-9,
            };
            const every = Math.max(1, Math.round(step.width * 2 / step1));
            for (let s = 0; s < count; s += every) road.points.push({ x: px[s]!, y: y[s]!, z: pz[s]! });
            if ((count - 1) % every !== 0) road.points.push({ x: px[count - 1]!, y: y[count - 1]!, z: pz[count - 1]! });
            if (!road.reachable) {
                let need = 0;
                for (let q = 0; q + 1 < pins.length; q++) need += Math.max(Math.abs(y[pins[q + 1]!]! - y[pins[q]!]!) / grade, (pins[q + 1]! - pins[q]!) * step1);
                out.warnings.push(`road "${road.name}" is ${steep.toFixed(2)} at its steepest (${road.steepest.degrees.toFixed(0)} degrees) near [${px[steepAt]!.toFixed(0)}, ${pz[steepAt]!.toFixed(0)}], steeper than the ${grade} asked: it climbs more than its length allows. It is ${coarse.length.toFixed(0)} long and needs about ${need.toFixed(0)}: give it a longer way round (switchbacks), or a gentler place to climb`);
            }
            out.roads.push(road);
            return;
        }
        case 'flatten': {
            const falloff = step.falloff ?? step.radius * 0.5, target = step.height ?? g.at(step.at[0], step.at[1]);
            const reach = step.radius + falloff;
            each(g.box(step.at[0] - reach, step.at[1] - reach, step.at[0] + reach, step.at[1] + reach), (i, j, k, x, z) => {
                h[k] = mix(h[k]!, target, smooth(reach, step.radius, Math.hypot(x - step.at[0], z - step.at[1])) * mask(i, j));
            });
            return;
        }
        case 'terrace': {
            const sharp = clamp(step.sharp ?? 0.8, 0, 1), drift = step.drift ?? 0;
            each(whole, (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                const phase = (step.phase ?? 0) + drift * (landNoise(x / (step.step * 14), z / (step.step * 14), seed, 2) - 0.5);
                h[k] = mix(h[k]!, ledged(h[k]!, step.step, sharp, phase), m);
            });
            return;
        }
        case 'pillars': {
            const cell = step.spacing, clear = clamp(step.clearings ?? 0.25, 0, 0.95);
            const ledges = Math.round(clamp(step.ledges ?? 0, 0, 4)), cluster = clamp(step.cluster ?? 0, 0, 1), tilt = clamp(step.tilt ?? 0, 0, 1);
            const reach = step.radius;
            each(g.box(step.at[0] - reach, step.at[1] - reach, step.at[0] + reach, step.at[1] + reach), (i, j, k, x, z) => {
                const m = mask(i, j) * smooth(step.radius, step.radius * 0.7, Math.hypot(x - step.at[0], z - step.at[1]));
                if (m <= 0) return;
                const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
                let top = 0;
                // One pillar's height here: a sheer shaft with a top that is level (or canted), shoulders stepping out below it, a foot of fallen rock.
                // Where two shapes meet (a shoulder and its shaft, a pillar and its splinter) the higher wins, and the inside corner between
                // them is filled a little: a crease there, on a grid, is a row of teeth.
                const fill = 3 * g.cellX;
                const join = (a: number, b: number, k: number): number => Math.max(a, b) + (k > 1e-9 ? Math.max(k - Math.abs(a - b), 0) ** 2 / (4 * k) : 0);
                const stand = (px: number, pz: number, radius: number, tall: number, key: number): number => {
                    // An outline that is not round and a face that is not ruled.
                    const bend = 1 + 0.35 * (landNoise(x / (radius * 0.9) + key, z / (radius * 0.9) - key, seed + 5, 2) - 0.5);
                    const squash = 0.8 + 0.4 * hash(key, 7, seed + 6);
                    const u = Math.hypot(x - px, (z - pz) * squash) * bend / radius;
                    if (u > 4.2) return 0;
                    const lean = hash(key, 11, seed + 8) * Math.PI * 2;
                    const cant = 1 + tilt * 0.22 * clamp(((x - px) * Math.cos(lean) + (z - pz) * Math.sin(lean)) / radius, -1, 1);
                    // A face is as sheer as the grid can carry: three samples from its brow to its foot at the least, or it is a saw.
                    const band = Math.max(0.2, 3 * g.cellX / radius);
                    let shape = smooth(1 + band * 0.6, 1 - band * 0.4, u) * (0.95 + 0.05 * smooth(1, 0, u)) * cant;
                    let out = 1;
                    for (let n = 1; n <= ledges; n++) {
                        // A shoulder: further out and lower than the last, and not the same height all the way round.
                        out += Math.max(0.3 + 0.35 * hash(key, n, seed + 9), band * 1.6);
                        const round = landNoise(x / (radius * 1.6) + key * 3 + n * 17, z / (radius * 1.6) - n * 5, seed + 10, 2);
                        const high = Math.pow(1 - n / (ledges + 1), 1.15) * (0.72 + 0.5 * round);
                        shape = join(shape, Math.min(high, 0.92) * smooth(out + band * 0.6, out - band * 0.4, u), fill / Math.max(tall, 1e-6));
                    }
                    const foot = 0.08 * smooth(out * 2.1, out * 1.05, u);
                    return tall * Math.max(shape, foot);
                };
                for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
                    const gx = cx + a, gz = cz + b;
                    if (hash(gx, gz, seed) < clear) continue;
                    const px = (gx + 0.2 + 0.6 * hash(gx, gz, seed + 1)) * cell, pz = (gz + 0.2 + 0.6 * hash(gx, gz, seed + 2)) * cell;
                    const radius = mix(step.width[0], step.width[1], hash(gx, gz, seed + 3) ** 1.6) / 2;
                    const tall = mix(step.height[0], step.height[1], hash(gx, gz, seed + 4) ** 1.3);
                    const key = gx * 131 + gz * 7919;
                    { const v = stand(px, pz, radius, tall, key); top = v > 0 && top > 0 ? join(top, v, fill) : Math.max(top, v); }
                    // Its splinters: lower, thinner, standing against it.
                    if (cluster > 0 && hash(gx, gz, seed + 12) < cluster) {
                        const count = 1 + Math.floor(hash(gx, gz, seed + 13) * 2.99);
                        for (let s = 0; s < count; s++) {
                            const turn = hash(gx + s * 3, gz - s, seed + 14) * Math.PI * 2, away = radius * (1.25 + 0.75 * hash(gx - s, gz + s * 5, seed + 15));
                            const small = radius * (0.32 + 0.3 * hash(gx + s, gz + s, seed + 16));
                            const v = stand(px + Math.cos(turn) * away, pz + Math.sin(turn) * away, small, tall * (0.4 + 0.45 * hash(gx + s * 7, gz, seed + 17)), key + 1000 + s);
                            top = v > 0 && top > 0 ? join(top, v, fill) : Math.max(top, v);
                        }
                    }
                }
                h[k] = h[k]! + top * m;
            });
            return;
        }
        case 'coast': {
            if (source.sea === undefined) throw new LandBuildError('a coast runs down to the sea: give the source a `sea` height');
            if (!step.outline && !(step.at && step.radius !== undefined)) throw new LandBuildError('a coast wants `at` and `radius`, or an `outline`');
            const sea = source.sea, ragged = step.ragged ?? 0, beach = Math.max(step.beach, g.cellX);
            const [shelfWide, shelfDeep] = step.shelf ?? [beach * 2, beach * 0.06];
            const coastD = g.field('coastD');
            each(whole, (i, j, k, x, z) => {
                let s = step.outline ? insideOutline(step.outline, x, z) : step.radius! - Math.hypot(x - step.at![0], z - step.at![1]);
                if (ragged > 0) s += ragged * 2 * (landNoise(x / (ragged * 4), z / (ragged * 4), seed, 4) - 0.5) + ragged * 0.5 * (landNoise(x / (ragged * 0.7), z / (ragged * 0.7), seed + 3, 2) - 0.5);
                coastD[k] = s;
                const m = mask(i, j);
                if (m <= 0) return;
                let to: number;
                if (s > 0) {
                    if (s >= beach) return;
                    const t = s / beach;
                    // High ground stays a cliff, its foot in the water; the rest comes down to a beach.
                    if (step.cliffs !== undefined && h[k]! - sea > step.cliffs) to = mix(sea - shelfDeep, h[k]!, smooth(0, 0.12, t));
                    else to = mix(sea - beach * 0.01 + beach * 0.05 * t, h[k]!, smooth(0.2, 1, t));
                } else {
                    to = sea - shelfDeep * smooth(0, shelfWide, -s) - (step.floor - shelfDeep) * smooth(shelfWide, shelfWide * 4, -s);
                }
                h[k] = mix(h[k]!, to, m);
            });
            return;
        }
        case 'smooth': {
            // A blur as wide as the radius asked, by three runs of a box along each axis (which is very nearly a bell): what is
            // narrower than the radius is rounded off, and what is broader keeps its shape. The mask is read from the ground as it
            // stood, so "gentler than 40 degrees" means the slopes that were, not the ones the blur is making.
            const passes = clamp(Math.round(step.passes ?? 1), 1, 16);
            const reachX = Math.max(1, Math.round((step.radius ?? g.cellX * 3) / g.cellX / 2)), reachZ = Math.max(1, Math.round((step.radius ?? g.cellZ * 3) / g.cellZ / 2));
            const may = new Float32Array(n * n), from = new Float32Array(n * n), to = new Float32Array(n * n), original = new Float32Array(n * n);
            each(whole, (i, j, k) => { may[k] = mask(i, j); });
            const run = (src: Float32Array, dst: Float32Array, stride: number, reach: number): void => {
                for (let line = 0; line < n; line++) {
                    const base = stride === 1 ? line * n : line;
                    let sum = 0;
                    for (let o = -reach; o <= reach; o++) sum += src[base + clamp(o, 0, n - 1) * stride]!;
                    for (let p = 0; p < n; p++) {
                        dst[base + p * stride] = sum / (reach * 2 + 1);
                        sum += src[base + clamp(p + reach + 1, 0, n - 1) * stride]! - src[base + clamp(p - reach, 0, n - 1) * stride]!;
                    }
                }
            };
            // Where it applies fades in over the same width, or the line between ground that was rounded and ground that was not
            // would be a new crease of its own, all the way round every cliff.
            if (step.where) {
                from.set(may);
                for (let box = 0; box < 3; box++) { run(from, to, 1, reachX * 2); run(to, from, n, reachZ * 2); }
                may.set(from);
            }
            for (let pass = 0; pass < passes; pass++) {
                original.set(h);
                from.set(h);
                for (let box = 0; box < 3; box++) { run(from, to, 1, reachX); run(to, from, n, reachZ); }
                for (let k = 0; k < h.length; k++) if (may[k]! > 0) h[k] = mix(original[k]!, from[k]!, may[k]!);
            }
            return;
        }
        case 'erode': {
            let lo = Infinity, hi = -Infinity;
            for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
            const span = Math.max(hi - lo, 1e-6), data = new Float32Array(n * n);
            for (let k = 0; k < data.length; k++) data[k] = (h[k]! - lo) / span;
            const worn = erodeHeightfield({ width: n, height: n, data }, { amount: clamp(step.amount, 0, 4), seed, sizeX: g.sx, sizeZ: g.sz, height: span });
            each(whole, (i, j, k) => { const m = mask(i, j); if (m > 0) h[k] = mix(h[k]!, lo + worn.field.data[k]! * span, m); });
            return;
        }
        case 'valley': {
            const bent = step.straight ? step.path.map((p) => [...p] as (number | undefined)[]) : rounded(step.path.map((p) => [p[0], p[1], p.length >= 3 ? p[2] : undefined] as const), step.width, step.width);
            const line = lineOf(bent as number[][]);
            const said: (number | undefined)[] = bent.map((p) => p[2]);
            const depth = step.depth ?? step.width * 0.5;
            // Where no height is said the floor lies `depth` under the ground as it was.
            const ys: number[] = [];
            for (let i = 0; i < line.xs.length; i++) ys.push(said[i] ?? g.at(line.xs[i]!, line.zs[i]!) - depth);
            const half = (step.floor ?? step.width * 0.3) / 2, walls = Math.max(step.walls ?? 0.8, 0.02);
            let top = -Infinity, low = Infinity, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (const v of h) if (v > top) top = v;
            for (const v of ys) if (v < low) low = v;
            for (let i = 0; i < line.xs.length; i++) { x0 = Math.min(x0, line.xs[i]!); x1 = Math.max(x1, line.xs[i]!); z0 = Math.min(z0, line.zs[i]!); z1 = Math.max(z1, line.zs[i]!); }
            const reach = half + Math.max(top - low, 0) / walls + 4 * g.cellX;
            each(g.box(x0 - reach, z0 - reach, x1 + reach, z1 + reach), (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                const near = nearest(line, x, z);
                const level = mix(ys[near.seg]!, ys[near.seg + 1]!, near.t);
                const beyond = Math.max(0, near.d - half * (1 + 0.5 * (landNoise(x / (step.width * 1.5), z / (step.width * 1.5), seed, 2) - 0.5)));
                // The ends of a valley open out: a cut that stopped dead would be a pit.
                const ends = smooth(0, step.width * 2, Math.min(near.along, line.length - near.along));
                const wall = level + walls * beyond * (0.75 + 0.5 * landNoise(x / (step.width * 3), z / (step.width * 3), seed + 4, 2)) + (1 - ends) * depth;
                h[k] = mix(h[k]!, Math.min(h[k]!, wall), m);
            });
            return;
        }
        case 'crater': {
            const rim = step.rim ?? step.depth * 0.25, reach = step.radius * 1.9;
            each(g.box(step.at[0] - reach, step.at[1] - reach, step.at[0] + reach, step.at[1] + reach), (i, j, k, x, z) => {
                const d = Math.hypot(x - step.at[0], z - step.at[1]);
                const bowl = -step.depth * smooth(step.radius, step.radius * 0.3, d);
                const lip = rim * Math.exp(-(((d - step.radius) / (step.radius * 0.28)) ** 2));
                h[k] = h[k]! + (bowl + lip) * mask(i, j);
            });
            return;
        }
        case 'dunes': {
            const heading = ((step.heading ?? 0) * Math.PI) / 180, cos = Math.cos(heading), sin = Math.sin(heading);
            each(whole, (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                // Crests are not ruled lines: they bow and fork by a noise across the wind.
                const u = (x * cos + z * sin) / step.length + 1.4 * (landNoise(x / (step.length * 3), z / (step.length * 3), seed, 3) - 0.5);
                const p = u - Math.floor(u);
                // A dune has a long gentle back and a short steep face.
                const shape = p < 0.72 ? smooth(0, 0.72, p) : 1 - smooth(0.72, 1, p);
                h[k] = h[k]! + step.height * shape * (0.35 + 1.04 * landNoise(x / (step.length * 5), z / (step.length * 5), seed + 3, 2)) * m;
            });
            return;
        }
        case 'talus': {
            // The gentlest ground that is nowhere steeper than the angle: half way between the highest such ground that lies under
            // what is there (the cliff cut back) and the lowest that lies over it (its foot filled), each found in two sweeps over the
            // grid, the way a distance is. What a pile of rock does: the top of a face comes down and gathers at its foot.
            const most = Math.tan((clamp(step.angle, 1, 89) * Math.PI) / 180), passes = clamp(Math.round(step.passes ?? 2), 1, 8);
            const dx = most * g.cellX, dz = most * g.cellZ, dd = most * Math.hypot(g.cellX, g.cellZ);
            const under = new Float32Array(n * n), over = new Float32Array(n * n);
            const sweep = (f: Float32Array, sign: 1 | -1): void => {
                // sign 1 holds f down to its neighbours plus the allowed rise (the ground under); -1 holds it up (the ground over).
                const hold = (k: number, other: number, run: number): void => {
                    const bound = f[other]! + sign * run;
                    if (sign === 1 ? f[k]! > bound : f[k]! < bound) f[k] = bound;
                };
                for (let pass = 0; pass < passes; pass++) {
                    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
                        const k = j * n + i;
                        if (i > 0) hold(k, k - 1, dx);
                        if (j > 0) { hold(k, k - n, dz); if (i > 0) hold(k, k - n - 1, dd); if (i < n - 1) hold(k, k - n + 1, dd); }
                    }
                    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
                        const k = j * n + i;
                        if (i < n - 1) hold(k, k + 1, dx);
                        if (j < n - 1) { hold(k, k + n, dz); if (i < n - 1) hold(k, k + n + 1, dd); if (i > 0) hold(k, k + n - 1, dd); }
                    }
                }
            };
            under.set(h); over.set(h);
            sweep(under, 1); sweep(over, -1);
            each(whole, (i, j, k) => { const m = mask(i, j); if (m > 0) h[k] = mix(h[k]!, (under[k]! + over[k]!) / 2, m); });
            return;
        }
        case 'sculpt': {
            step.strokes.forEach((stroke, s) => {
                if (!Array.isArray(stroke.points) || stroke.points.length === 0 || !(stroke.radius > 0)) throw new LandBuildError(`stroke ${s} wants points and a radius above 0`);
                const soft = clamp(stroke.soft ?? 0.7, 0, 1), line = lineOf(stroke.points);
                const spacing = stroke.radius * 0.25, dabs = Math.max(1, Math.ceil(line.length / spacing) + 1);
                const level = stroke.height ?? g.at(line.xs[0]!, line.zs[0]!);
                for (let d = 0; d < dabs; d++) {
                    const along = dabs === 1 ? 0 : (d / (dabs - 1)) * line.length;
                    let seg = 0;
                    while (seg + 2 < line.at.length && line.at[seg + 1]! < along) seg++;
                    const many = line.xs.length > 1;
                    const t = many ? clamp((along - line.at[seg]!) / Math.max(line.at[seg + 1]! - line.at[seg]!, 1e-9), 0, 1) : 0;
                    const cx = many ? mix(line.xs[seg]!, line.xs[seg + 1]!, t) : line.xs[0]!, cz = many ? mix(line.zs[seg]!, line.zs[seg + 1]!, t) : line.zs[0]!;
                    // A stroke moves the ground by `by` at its middle once it has passed: a place under it takes about four dabs.
                    const per = dabs === 1 ? 1 : 0.25;
                    each(g.box(cx - stroke.radius, cz - stroke.radius, cx + stroke.radius, cz + stroke.radius), (i, j, k, x, z) => {
                        const w = smooth(stroke.radius, stroke.radius * (1 - soft), Math.hypot(x - cx, z - cz)) * mask(i, j);
                        if (w <= 0) return;
                        if (stroke.brush === 'raise') h[k] = h[k]! + (stroke.by ?? stroke.radius * 0.2) * per * w;
                        else if (stroke.brush === 'lower') h[k] = h[k]! - (stroke.by ?? stroke.radius * 0.2) * per * w;
                        else if (stroke.brush === 'flatten') h[k] = mix(h[k]!, level, clamp(stroke.by ?? 0.5, 0, 1) * w);
                        else if (stroke.brush === 'roughen') h[k] = h[k]! + (stroke.by ?? stroke.radius * 0.1) * per * w * 2 * (landNoise(x / (stroke.radius * 0.3), z / (stroke.radius * 0.3), seed + s, 3) - 0.5);
                        else if (stroke.brush === 'smooth') {
                            if (i < 1 || j < 1 || i > n - 2 || j > n - 2) return;
                            h[k] = mix(h[k]!, (h[k - 1]! + h[k + 1]! + h[k - n]! + h[k + n]!) / 4, clamp(stroke.by ?? 0.5, 0, 1) * w);
                        } else throw new LandBuildError(`stroke ${s} has no brush "${String(stroke.brush)}"; there are raise, lower, smooth, flatten, roughen`);
                    });
                }
            });
            return;
        }
        case 'stream': {
            // Water finds its own way: from where it rises, always to the lowest ground a stride away, and where a hollow holds
            // it, toward the nearest ground lower than it stands on, which its bed is then cut through to.
            const stride = g.cellX * 2, sea = source.sea ?? -Infinity, label = step.name ?? `stream${out.rivers.length + 1}`;
            const path: [number, number, number, number][] = [];
            let x = step.from[0], z = step.from[1], level = g.at(x, z), heading: [number, number] | null = null, run = 0;
            const x0 = g.x(0), x1 = g.x(n - 1), z0 = g.z(0), z1 = g.z(n - 1);
            const inside = (px: number, pz: number): boolean => px > x0 + stride && px < x1 - stride && pz > z0 + stride && pz < z1 - stride;
            const reached = (px: number, pz: number): boolean => {
                const k = clamp(Math.round((pz - g.cz) / g.sz * (n - 1) + (n - 1) / 2), 0, n - 1) * n + clamp(Math.round((px - g.cx) / g.sx * (n - 1) + (n - 1) / 2), 0, n - 1);
                return (g.lakeD !== null && g.lakeD[k]! < 0) || (g.riverD !== null && g.riverD[k]! < 0);
            };
            if (!inside(x, z)) throw new LandBuildError(`stream "${label}" rises at [${x}, ${z}], which is not on the land`);
            path.push([x, z, level, step.width]);
            for (let guard = 0; guard < 6000; guard++) {
                let bx = x, bz = z, bh = Infinity;
                for (let a = 0; a < 16; a++) {
                    const dx = Math.cos((a / 16) * Math.PI * 2), dz = Math.sin((a / 16) * Math.PI * 2);
                    if (heading && dx * heading[0] + dz * heading[1] < -0.2) continue;                 // water does not turn back on itself
                    const px = x + dx * stride, pz = z + dz * stride;
                    const ph = inside(px, pz) ? g.at(px, pz) : -Infinity;
                    if (ph < bh) { bh = ph; bx = px; bz = pz; }
                }
                if (bh >= level) {
                    let found = false;
                    for (let ring = 2; ring <= 60 && !found; ring++) {
                        let fh = level - 1e-3, fx = 0, fz = 0;
                        for (let a = 0; a < ring * 8; a++) {
                            const px = x + Math.cos((a / (ring * 8)) * Math.PI * 2) * stride * ring, pz = z + Math.sin((a / (ring * 8)) * Math.PI * 2) * stride * ring;
                            const ph = inside(px, pz) ? g.at(px, pz) : -Infinity;
                            if (ph < fh) { fh = ph; fx = px; fz = pz; found = true; }
                        }
                        if (found) { const len = Math.hypot(fx - x, fz - z); bx = x + ((fx - x) / len) * stride; bz = z + ((fz - z) / len) * stride; bh = Math.min(g.at(bx, bz), level); }
                    }
                    if (!found) { out.warnings.push(`stream "${label}" stopped in a hollow at [${x.toFixed(0)}, ${z.toFixed(0)}] with no lower ground within reach`); break; }
                }
                const len = Math.hypot(bx - x, bz - z) || 1;
                heading = [(bx - x) / len, (bz - z) / len];
                x = bx; z = bz; run += len;
                level = Math.min(level - 1e-4 * len, bh);
                const done = !inside(x, z) || level <= sea || reached(x, z);
                if (done || guard % 3 === 2) path.push([x, z, done ? Math.max(level, sea - 0.01) : level, step.width + (step.grow ?? 0) * run]);
                if (done) break;
            }
            if (path.length < 2) throw new LandBuildError(`stream "${label}" has nowhere to run from [${step.from[0]}, ${step.from[1]}]`);
            runStep(g, { op: 'river', name: label, path, width: step.width, ...(step.depth !== undefined ? { depth: step.depth } : {}), valley: step.valley ?? 1.4, plain: step.width * 0.3, ...(step.seed !== undefined ? { seed: step.seed } : {}), ...(step.where ? { where: step.where } : {}) }, index, source, out, range);
            return;
        }
        case 'image': {
            const picture = out.inputs?.[step.file];
            if (!picture) throw new LandBuildError(`the heightmap "${step.file}" is not a picture in the project`);
            const at = step.at ?? [g.cx, g.cz], size = step.size ?? [g.sx, g.sz], blend = step.blend ?? 'set';
            each(g.box(at[0] - size[0] / 2, at[1] - size[1] / 2, at[0] + size[0] / 2, at[1] + size[1] / 2), (i, j, k, x, z) => {
                const m = mask(i, j);
                if (m <= 0) return;
                const u = clamp((x - at[0]) / size[0] + 0.5, 0, 1) * (picture.width - 1), v = clamp((z - at[1]) / size[1] + 0.5, 0, 1) * (picture.height - 1);
                const a = Math.min(Math.floor(u), picture.width - 2), b = Math.min(Math.floor(v), picture.height - 2), o = b * picture.width + a;
                const val = mix(mix(picture.data[o]!, picture.data[o + 1]!, u - a), mix(picture.data[o + picture.width]!, picture.data[o + picture.width + 1]!, u - a), v - b);
                const to = mix(step.low, step.high, val);
                const next = blend === 'add' ? h[k]! + to : blend === 'max' ? Math.max(h[k]!, to) : blend === 'min' ? Math.min(h[k]!, to) : to;
                h[k] = mix(h[k]!, next, m);
            });
            return;
        }
        case 'clamp':
            each(whole, (i, j, k) => { const m = mask(i, j); if (m > 0) h[k] = mix(h[k]!, clamp(h[k]!, step.min ?? -Infinity, step.max ?? Infinity), m); });
            return;
        default:
            throw new LandBuildError(`there is no op "${String((step as { op: string }).op)}"`);
    }
}

function layWeights(g: Grid, layers: readonly LandLayer[], range: number): { weights: Map<string, Float32Array>; order: string[] } {
    const weights = new Map<string, Float32Array>(), order: string[] = [];
    layers.forEach((layer, index) => {
        const w = new Float32Array(g.n * g.n);
        const mask = index === 0 && !layer.where ? ALL : maskOf(g, layer.where, range, weights);
        const amount = clamp(layer.amount ?? 1, 0, 1);
        for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
            const k = j * g.n + i, a = index === 0 && !layer.where ? 1 : mask(i, j) * amount;
            if (a <= 0) continue;
            w[k] = a;
            // Laid over what is there: every layer before it gives way by as much.
            for (const name of order) { const under = weights.get(name)!; under[k] = under[k]! * (1 - a); }
        }
        weights.set(layer.name, w);
        order.push(layer.name);
    });
    return { weights, order };
}

/** The heightmap pictures a source's steps name, for whoever runs it to read first. */
export function landPictures(source: LandSource): string[] {
    return [...new Set(source.steps.flatMap((s) => (s.op === 'image' ? [s.file] : [])))];
}

/** Runs a source. Throws {@link LandBuildError}, naming the step, when one cannot run. `inputs` are the pictures its `image` steps name. */
export function bakeLand(raw: unknown, inputs?: Readonly<Record<string, LandPicture>>): BakedLand {
    // Worked from in world units, whatever unit it was written in.
    const source = landInWorldUnits(validateLandSource(raw));
    const n = source.resolution, center = source.center ?? [0, 0];
    const g = new Grid(n, source.size[0], source.size[1], center[0], center[1]);
    const out: StepOut = { rivers: [], roads: [], lakes: [], warnings: [], ...(inputs ? { inputs } : {}) };
    const steps: LandReport['steps'] = [];
    const before = new Float32Array(n * n);
    let range = 1;
    source.steps.forEach((step, index) => {
        before.set(g.h);
        try {
            runStep(g, step, index, source, out, range);
        } catch (e) {
            if (e instanceof LandBuildError && e.stepIndex === null) throw new LandBuildError(e.message, index, step.id ?? null, step.op);
            throw e;
        }
        let raised = 0, lowered = 0, lo = Infinity, hi = -Infinity;
        for (let k = 0; k < g.h.length; k++) {
            const v = g.h[k]!, d = v - before[k]!;
            if (!Number.isFinite(v)) throw new LandBuildError(`step ${index} (${step.op}) made a height that is not a number: check its fields`, index, step.id ?? null, step.op);
            if (d > raised) raised = d; else if (-d > lowered) lowered = -d;
            if (v < lo) lo = v; if (v > hi) hi = v;
        }
        range = Math.max(hi - lo, 1);
        steps.push({ index, op: step.op, ...(step.id ? { id: step.id } : {}), raised: +raised.toFixed(2), lowered: +lowered.toFixed(2) });
        if ((step.op === 'river' || step.op === 'stream') && raised > step.width) {
            out.warnings.push(`step ${index} (${step.op}${step.name ? ` "${step.name}"` : ''}) banks the ground up by ${raised.toFixed(0)} to carry its water: somewhere its heights run that far above the ground it crosses. Look at a profile along it, and give it heights at or under the ground`);
        }
        if (raised === 0 && lowered === 0 && step.op !== 'fill') out.warnings.push(`step ${index} (${step.op}${step.id ? ` "${step.id}"` : ''}) changed nothing: it lies outside the land, or its \`where\` matches no ground`);
    });
    let min = Infinity, max = -Infinity;
    for (const v of g.h) { if (v < min) min = v; if (v > max) max = v; }
    // How steep the ground is, of what stands above the sea.
    let walk = 0, steep = 0, cliff = 0, creases = 0;
    for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) {
        if (source.sea !== undefined && g.h[j * n + i]! < source.sea) continue;
        if (landBend(g.h, n, g.cellX, g.cellZ, i, j) > 25) creases++;
        const s = g.slope(i, j);
        if (s < 25) walk++; else if (s < 45) steep++; else cliff++;
    }
    const dry = Math.max(walk + steep + cliff, 1);
    const layers = source.layers ?? [];
    const laidLayers = layWeights(g, layers, max - min);
    const m = n - 1;
    const pack = (w: Float32Array): Uint8Array => {
        const bytes = new Uint8Array(m * m);
        for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) bytes[j * m + i] = Math.round(clamp(w[j * n + i]!, 0, 1) * 255);
        return bytes;
    };
    const weights = layers.map((layer) => ({ name: layer.name, ...(layer.file ? { file: layer.file } : {}), values: pack(laidLayers.weights.get(layer.name)!) }));
    const maps = (source.maps ?? []).map((map: LandMap) => {
        const mask = maskOf(g, map.where, max - min, laidLayers.weights), amount = clamp(map.amount ?? 1, 0, 1);
        const w = new Float32Array(n * n);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) w[j * n + i] = mask(i, j) * amount;
        return { name: map.name, values: pack(w) };
    });
    // What stands on it: a place in every cell the mask lets one stand in, and the places written by hand.
    const stands: BakedStand[] = (source.stands ?? []).map((stand: LandStand) => {
        const seed = Math.round(stand.seed ?? 1) * 7919 + 13, clear = clamp(stand.clearings ?? 0, 0, 1);
        const [lo, hi] = stand.scale ?? [1, 1], sink = stand.sink ?? 0, lean = clamp(stand.lean ?? 0, 0, 45);
        const foot = Math.max(stand.foot ?? 0, 0);
        const mask = maskOf(g, stand.where, max - min, laidLayers.weights);
        const index = (x: number, z: number): [number, number] => [
            clamp(Math.round((x - g.cx) / g.sx * (n - 1) + (n - 1) / 2), 0, n - 1), clamp(Math.round((z - g.cz) / g.sz * (n - 1) + (n - 1) / 2), 0, n - 1)];
        // The lowest ground under its foot: it stands in a slope, not on the high corner of one.
        const ground = (x: number, z: number, reach: number): number => {
            let low = g.at(x, z);
            if (reach > 0) for (let a = 0; a < 8; a++) low = Math.min(low, g.at(x + Math.cos(a * Math.PI / 4) * reach, z + Math.sin(a * Math.PI / 4) * reach));
            return low;
        };
        const places: StandPlace[] = [];
        const put = (x: number, z: number, key: number, scale?: number, turn?: number): void => {
            if (Math.abs(x - g.cx) > g.sx / 2 || Math.abs(z - g.cz) > g.sz / 2) return;
            const size = scale ?? mix(lo, hi, hash(key, 3, seed));
            places.push({
                model: Math.min(stand.models.length - 1, Math.floor(hash(key, 4, seed) * stand.models.length)),
                x: +x.toFixed(2), y: +(ground(x, z, foot * size) - sink * size).toFixed(2), z: +z.toFixed(2), scale: +size.toFixed(3),
                turn: +(turn ?? hash(key, 5, seed) * 360).toFixed(1), lean: +(lean * hash(key, 6, seed)).toFixed(1), leanToward: +(hash(key, 7, seed) * 360).toFixed(1),
            });
        };
        if (Number(stand.spacing) > 0) {
            const cell = stand.spacing!, x0 = g.cx - g.sx / 2, z0 = g.cz - g.sz / 2;
            const nx = Math.ceil(g.sx / cell), nz = Math.ceil(g.sz / cell);
            if (nx * nz > 4_000_000) throw new LandBuildError(`stand "${stand.name}" has a spacing of ${cell} on a land ${g.sx} wide: that is ${nx * nz} cells; a stand is counted in hundreds, plants are a Foliage's`);
            for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
                if (hash(cx, cz, seed) < clear) continue;
                const x = x0 + (cx + 0.15 + 0.7 * hash(cx, cz, seed + 1)) * cell, z = z0 + (cz + 0.15 + 0.7 * hash(cx, cz, seed + 2)) * cell;
                const [i, j] = index(x, z);
                if (hash(cx, cz, seed + 8) >= mask(i, j)) continue;
                put(x, z, cx * 131 + cz * 7919);
            }
        }
        (stand.at ?? []).forEach((p, at) => { if (p.length >= 2) put(p[0]!, p[1]!, 100000 + at, p[2], p[3]); });
        return { name: stand.name, models: stand.models.map((m) => ({ mesh: m.mesh, ...(m.material ? { material: m.material } : {}), ...(m.texture ? { texture: m.texture } : {}) })), collide: stand.collide !== false, places };
    });
    // The plants placed one by one: `count` tries to a cell, each kept as often as its map is white there, on ground level enough to grow it.
    const groves: BakedGrove[] = (source.plants ?? []).filter((plant) => plant.mesh && plant.lods?.length).map((plant) => {
        const values = maps.find((map) => map.name === plant.map)?.values;
        const places: number[] = [];
        if (!values) return { plant: plant.name, places };
        const seed = Math.round(plant.seed ?? 1) * 104729 + 71, cell = plant.cell ?? Math.max(g.sx, g.sz) / 256;
        const [lo, hi] = plant.scale ?? [0.8, 1.25], sink = plant.sink ?? 0, leastUp = plant.minUp ?? 0.8;
        const x0 = g.cx - g.sx / 2, z0 = g.cz - g.sz / 2, nx = Math.ceil(g.sx / cell), nz = Math.ceil(g.sz / cell);
        const whole = Math.floor(plant.count), part = plant.count - whole;
        for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
            const tries = whole + (hash(cx, cz, seed + 9) < part ? 1 : 0);
            for (let t = 0; t < tries; t++) {
                const key = (cz * nx + cx) * 31 + t;
                const x = x0 + (cx + hash(key, 1, seed)) * cell, z = z0 + (cz + hash(key, 2, seed)) * cell;
                if (x > g.cx + g.sx / 2 || z > g.cz + g.sz / 2) continue;
                const i = clamp(Math.round((x - x0) / g.sx * (n - 1)), 0, n - 1), j = clamp(Math.round((z - z0) / g.sz * (n - 1)), 0, n - 1);
                const weight = values[Math.min(j, m - 1) * m + Math.min(i, m - 1)]! / 255;
                if (hash(key, 3, seed) >= weight) continue;
                if (Math.cos(g.slope(i, j) * Math.PI / 180) < leastUp) continue;
                const size = mix(lo, hi, hash(key, 4, seed));
                places.push(+x.toFixed(1), +(g.at(x, z) - sink * size).toFixed(1), +z.toFixed(1), +(hash(key, 5, seed) * Math.PI * 2).toFixed(3), +size.toFixed(3));
            }
        }
        return { plant: plant.name, places };
    });
    for (const grove of groves) {
        if (grove.places.length === 0) out.warnings.push(`plant "${grove.plant}" stands nowhere: its map is black wherever the ground is level enough for it`);
        if (grove.places.length / 5 > 120000) out.warnings.push(`plant "${grove.plant}" is ${grove.places.length / 5} plants placed one by one: past a hundred thousand, lower its \`count\` or widen its \`cell\``);
    }
    for (const stand of stands) {
        if (stand.places.length === 0) out.warnings.push(`stand "${stand.name}" stands nowhere: its \`where\` matches no ground, or its \`clearings\` leave none`);
        if (stand.places.length > 4000) out.warnings.push(`stand "${stand.name}" is ${stand.places.length} models, each an entity of its own: past a few thousand, scatter them as a Foliage or a PlacedFoliage instead`);
    }
    // The wash: each tint over those before it, its colour kept linear until it is written.
    let tint: Uint8Array | null = null;
    if (source.tints?.length) {
        const rgb = new Float32Array(n * n * 3), laid = new Float32Array(n * n);
        for (const t of source.tints) {
            const mask = maskOf(g, t.where, max - min, laidLayers.weights), amount = clamp(t.amount ?? 1, 0, 1);
            for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
                const k = j * n + i, a = mask(i, j) * amount;
                if (a <= 0) continue;
                // The first colour laid on a place is that colour whole: there is nothing under it to mix with.
                const under = laid[k]! > 0 ? 1 : 0;
                for (let c = 0; c < 3; c++) rgb[k * 3 + c] = mix(under ? rgb[k * 3 + c]! : t.color[c]!, t.color[c]!, a);
                laid[k] = laid[k]! + a * (1 - laid[k]!);
            }
        }
        const toSrgb = (v: number): number => Math.round(255 * clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055, 0, 1));
        tint = new Uint8Array(m * m * 4);
        for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
            const k = j * n + i, o = (j * m + i) * 4;
            tint[o] = toSrgb(rgb[k * 3]!); tint[o + 1] = toSrgb(rgb[k * 3 + 1]!); tint[o + 2] = toSrgb(rgb[k * 3 + 2]!); tint[o + 3] = Math.round(clamp(laid[k]!, 0, 1) * 255);
        }
    }
    const cover = weights.map((w) => { let sum = 0; for (const v of w.values) sum += v; return { name: w.name, cover: +(sum / 255 / (m * m)).toFixed(3) }; });
    for (const c of cover) if (c.cover === 0) out.warnings.push(`layer "${c.name}" lies nowhere: its \`where\` matches no ground`);
    for (const river of out.rivers) {
        const end = river.points[river.points.length - 1]!;
        if (source.sea !== undefined && end.y > source.sea + 1 && !out.lakes.some((l) => Math.hypot(l.at[0] - end.x, l.at[1] - end.z) < l.radius * 1.3) && !out.rivers.some((o) => o !== river && o.points.some((p) => Math.hypot(p.x - end.x, p.z - end.z) < Math.max(p.width, end.width) * 1.5))) {
            out.warnings.push(`river "${river.name}" ends at height ${end.y.toFixed(1)}, above the sea and in no lake or other river: its water has nowhere to go`);
        }
    }
    return {
        source, n, size: [source.size[0], source.size[1]], center: [center[0], center[1]], heights: g.h, m, weights, maps, tint, stands, groves,
        fields: { river: g.riverD, road: g.roadD, lake: g.lakeD, coast: g.coastD },
        report: {
            resolution: n, cell: +g.cellX.toFixed(3), min: +min.toFixed(2), max: +max.toFixed(2), sea: source.sea ?? null,
            slopes: { walkable: +(walk / dry).toFixed(3), steep: +(steep / dry).toFixed(3), cliff: +(cliff / dry).toFixed(3) },
            creased: +(creases / dry).toFixed(3),
            steps, rivers: out.rivers, roads: out.roads, lakes: out.lakes, layers: cover, stands: stands.map((stand) => ({ name: stand.name, count: stand.places.length })), groves: groves.map((grove) => ({ plant: grove.plant, count: grove.places.length / 5 })), warnings: out.warnings,
        },
    };
}

/**
 * How sharply the ground bends at a sample, in degrees: the most its slope turns across it, along x or along z. A smooth hill is a
 * degree or two, a crease between two facets is the angle between them.
 */
export function landBend(h: Float32Array, n: number, cellX: number, cellZ: number, i: number, j: number): number {
    if (i < 1 || j < 1 || i > n - 2 || j > n - 2) return 0;
    const k = j * n + i, deg = 180 / Math.PI;
    const bx = Math.abs(Math.atan((h[k + 1]! - h[k]!) / cellX) - Math.atan((h[k]! - h[k - 1]!) / cellX));
    const bz = Math.abs(Math.atan((h[k + n]! - h[k]!) / cellZ) - Math.atan((h[k]! - h[k - n]!) / cellZ));
    return Math.max(bx, bz) * deg;
}

/** The ground of a baked land at a world place, between samples. */
export function landHeightAt(land: BakedLand, x: number, z: number): number {
    const n = land.n;
    const fi = clamp((x - land.center[0]) / land.size[0] * (n - 1) + (n - 1) / 2, 0, n - 1.001);
    const fj = clamp((z - land.center[1]) / land.size[1] * (n - 1) + (n - 1) / 2, 0, n - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * n + i;
    return mix(mix(land.heights[k]!, land.heights[k + 1]!, u), mix(land.heights[k + n]!, land.heights[k + n + 1]!, u), v);
}
