// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    globalSdf.ts
 * @brief   The scene's distance field: mesh fields composed into clipmaps that follow the camera (docs/GI_LUMEN_DESIGN.md, 3.2).
 *
 * @details Each level is a cube of cells addressed toroidally, so when the window moves only the slabs that came into it are rebuilt.
 *          A cell holds the distance from its centre to the nearest surface, negative inside, clamped to +-`reach` (a cell further
 *          than that from everything is "empty for `reach`", which is all a trace needs of it and is why the cube can be small).
 *
 *          The composition is CPU work on the cells an instance touches. A static scene pays it once, at load; a moved instance pays
 *          the cells under its old and new boxes. Its result is one `Float32Array` per level, laid out for a storage buffer; the
 *          trace in {@link GLOBAL_SDF_WGSL} reads that and `sphereTrace` below is its twin, so the same rays can be checked on the CPU.
 *
 *          An instance is uniformly scaled: the field is a distance, and a non-uniform scale does not preserve one.
 */
import { sampleMeshSdf, type MeshSdf } from './meshSdfFormat';

export interface SdfInstance {
    /** Stable identity: moving an instance is `update` with the same id. */
    id: number;
    sdf: MeshSdf;
    /** Column-major 4x4, local to world. Rotation, translation and one uniform scale. */
    worldFromLocal: ArrayLike<number>;
}

export interface GlobalSdfLevel {
    /** Cells along each axis (a power of two). */
    dim: number;
    /** World size of one cell. */
    cell: number;
}

interface Placed {
    instance: SdfInstance;
    scale: number;
    /** World from local, and its inverse (rigid, so a transpose and a negated translation, over the scale). */
    inverse: Float64Array;
    min: [number, number, number];
    max: [number, number, number];
}

interface Level {
    dim: number;
    cell: number;
    /** The window's first cell, in whole cells of the level. */
    origin: [number, number, number];
    data: Float32Array;
    /** Per cell, 1 + the id of the instance nearest to it (127 for an id past 125), 0 where nothing is within reach. */
    owner: Uint8Array;
}

export class GlobalSdf {
    readonly levels: Level[];
    /** How far a cell remembers a surface: +-reach cells of the level. */
    static readonly REACH_CELLS = 6;
    private placed_ = new Map<number, Placed>();

    constructor(levels: readonly GlobalSdfLevel[]) {
        this.levels = levels.map((l) => {
            if ((l.dim & (l.dim - 1)) !== 0 || l.dim < 2) throw new Error(`a clipmap level is a power of two cells across, got ${l.dim}`);
            const level: Level = { dim: l.dim, cell: l.cell, origin: [0, 0, 0], data: new Float32Array(l.dim ** 3), owner: new Uint8Array(l.dim ** 3) };
            level.data.fill(l.cell * GlobalSdf.REACH_CELLS);
            return level;
        });
    }

    reach(level: Level): number { return level.cell * GlobalSdf.REACH_CELLS; }

    /** Moves every window so it is centred on `p`, to whole cells: only the slabs that came into view are rebuilt. */
    setCenter(p: readonly [number, number, number]): void {
        for (const level of this.levels) {
            const target = [0, 1, 2].map((k) => Math.floor(p[k]! / level.cell) - level.dim / 2) as [number, number, number];
            const move = [0, 1, 2].map((k) => target[k]! - level.origin[k]!);
            if (move.every((m) => m === 0)) continue;
            const old = level.origin;
            level.origin = target;
            if (move.some((m) => Math.abs(m) >= level.dim)) { this.rebuild_(level, [target[0]!, target[1]!, target[2]!], [target[0]! + level.dim, target[1]! + level.dim, target[2]! + level.dim]); continue; }
            // One slab per axis that moved: [new edge].
            for (let k = 0; k < 3; k++) {
                const m = move[k]!;
                if (m === 0) continue;
                const lo = [...target] as [number, number, number], hi = [target[0]! + level.dim, target[1]! + level.dim, target[2]! + level.dim] as [number, number, number];
                if (m > 0) lo[k] = old[k]! + level.dim; else hi[k] = old[k]!;
                lo[k] = Math.max(lo[k]!, target[k]!); hi[k] = Math.min(hi[k]!, target[k]! + level.dim);
                this.rebuild_(level, lo, hi);
            }
        }
    }

    /** Adds an instance, or moves/replaces the one with its id. */
    update(instance: SdfInstance): void {
        const previous = this.placed_.get(instance.id);
        const placed = this.place_(instance);
        this.placed_.set(instance.id, placed);
        for (const level of this.levels) {
            if (previous) this.rebuildBox_(level, previous.min, previous.max);
            this.rebuildBox_(level, placed.min, placed.max);
        }
    }

    remove(id: number): void {
        const previous = this.placed_.get(id);
        if (!previous) return;
        this.placed_.delete(id);
        for (const level of this.levels) this.rebuildBox_(level, previous.min, previous.max);
    }

    /** The finest level that holds `p` away from its border, or null. */
    levelAt(p: readonly [number, number, number], margin = 2): Level | null {
        for (const level of this.levels) {
            let inside = true;
            for (let k = 0; k < 3; k++) {
                const c = p[k]! / level.cell - level.origin[k]!;
                if (c < margin || c > level.dim - margin) { inside = false; break; }
            }
            if (inside) return level;
        }
        return null;
    }

    /** The field at a world point: trilinear in the finest level that holds it; null outside every window. */
    sample(p: readonly [number, number, number]): number | null {
        const level = this.levelAt(p, 1);
        return level ? this.sampleLevel_(level, p) : null;
    }

    /**
     * Sphere trace from `origin` along unit `dir`. Returns the distance to the first surface within `maxT`, or null when the ray reaches
     * `maxT` (or leaves every window) without one. A step is the field's value, never less than a fraction of a cell, so a ray
     * grazing a surface still moves; a hit is a value under `hitFraction` of the cell.
     */
    sphereTrace(origin: readonly [number, number, number], dir: readonly [number, number, number], maxT: number, hitFraction = 0.25): number | null {
        let t = 0;
        for (let i = 0; i < 256 && t < maxT; i++) {
            const p: [number, number, number] = [origin[0]! + dir[0]! * t, origin[1]! + dir[1]! * t, origin[2]! + dir[2]! * t];
            const level = this.levelAt(p, 1);
            if (!level) return null;
            const d = this.sampleLevel_(level, p);
            if (d < level.cell * hitFraction) return t;
            t += Math.max(d, level.cell * 0.25);
        }
        return null;
    }

    /** Whether anything stands between two points (a short hop back from the target, so the surface the target is on does not count). */
    occluded(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
        const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], length = Math.hypot(...d);
        if (length < 1e-6) return false;
        const hit = this.sphereTrace(a, d.map((v) => v / length) as [number, number, number], length * 0.98);
        return hit !== null;
    }

    private place_(instance: SdfInstance): Placed {
        const m = instance.worldFromLocal;
        const scale = Math.hypot(m[0]!, m[1]!, m[2]!);
        // Rigid part: columns / scale. Inverse = [R^T | -R^T t] / scale.
        const r = [0, 1, 2].map((c) => [0, 1, 2].map((row) => m[c * 4 + row]! / scale));
        const t = [m[12]!, m[13]!, m[14]!];
        const inverse = new Float64Array(16);
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) inverse[col * 4 + row] = r[row]![col]! / scale;
            inverse[12 + row] = -(r[row]![0]! * t[0]! + r[row]![1]! * t[1]! + r[row]![2]! * t[2]!) / scale;
        }
        inverse[15] = 1;
        const { sdf } = instance;
        const lo = sdf.origin, hi = [0, 1, 2].map((k) => sdf.origin[k]! + sdf.dims[k]! * sdf.cell);
        const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 8; c++) {
            const local = [c & 1 ? hi[0]! : lo[0], c & 2 ? hi[1]! : lo[1], c & 4 ? hi[2]! : lo[2]];
            for (let k = 0; k < 3; k++) {
                const w = m[k]! * local[0]! + m[4 + k]! * local[1]! + m[8 + k]! * local[2]! + m[12 + k]!;
                min[k] = Math.min(min[k], w); max[k] = Math.max(max[k], w);
            }
        }
        return { instance, scale, inverse, min, max };
    }

    private distanceTo_(placed: Placed, p: readonly [number, number, number]): number {
        const i = placed.inverse;
        const local: [number, number, number] = [
            i[0]! * p[0]! + i[4]! * p[1]! + i[8]! * p[2]! + i[12]!,
            i[1]! * p[0]! + i[5]! * p[1]! + i[9]! * p[2]! + i[13]!,
            i[2]! * p[0]! + i[6]! * p[1]! + i[10]! * p[2]! + i[14]!,
        ];
        return sampleMeshSdf(placed.instance.sdf, local) * placed.scale;
    }

    private rebuildBox_(level: Level, min: readonly number[], max: readonly number[]): void {
        const reach = this.reach(level);
        const lo = [0, 1, 2].map((k) => Math.floor((min[k]! - reach) / level.cell)) as [number, number, number];
        const hi = [0, 1, 2].map((k) => Math.ceil((max[k]! + reach) / level.cell)) as [number, number, number];
        this.rebuild_(level, lo, hi);
    }

    /** Rebuilds the cells [lo, hi) (in level cells) that are inside the window from every instance that reaches them. */
    private rebuild_(level: Level, lo: [number, number, number], hi: [number, number, number]): void {
        const a = [0, 1, 2].map((k) => Math.max(lo[k]!, level.origin[k]!)), b = [0, 1, 2].map((k) => Math.min(hi[k]!, level.origin[k]! + level.dim));
        if (a.some((v, k) => v >= b[k]!)) return;
        const reach = this.reach(level);
        const near: Placed[] = [];
        for (const placed of this.placed_.values()) {
            let overlaps = true;
            for (let k = 0; k < 3; k++) {
                if (placed.max[k]! + reach < a[k]! * level.cell || placed.min[k]! - reach > b[k]! * level.cell) { overlaps = false; break; }
            }
            if (overlaps) near.push(placed);
        }
        const mask = level.dim - 1;
        for (let z = a[2]!; z < b[2]!; z++) for (let y = a[1]!; y < b[1]!; y++) for (let x = a[0]!; x < b[0]!; x++) {
            const p: [number, number, number] = [(x + 0.5) * level.cell, (y + 0.5) * level.cell, (z + 0.5) * level.cell];
            let d = reach, owner = 0;
            for (const placed of near) {
                const v = this.distanceTo_(placed, p);
                if (v < d) { d = v; owner = placed.instance.id < 126 ? placed.instance.id + 1 : 127; }
            }
            const at = (x & mask) + (y & mask) * level.dim + (z & mask) * level.dim * level.dim;
            level.data[at] = Math.max(d, -reach);
            level.owner[at] = owner;
        }
    }

    private sampleLevel_(level: Level, p: readonly [number, number, number]): number {
        const mask = level.dim - 1;
        const g = [0, 1, 2].map((k) => p[k]! / level.cell - 0.5);
        const i0 = g.map(Math.floor), f = g.map((v, k) => v - i0[k]!);
        let sum = 0;
        for (let c = 0; c < 8; c++) {
            const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
            const w = (dx ? f[0]! : 1 - f[0]!) * (dy ? f[1]! : 1 - f[1]!) * (dz ? f[2]! : 1 - f[2]!);
            sum += w * level.data[((i0[0]! + dx) & mask) + ((i0[1]! + dy) & mask) * level.dim + ((i0[2]! + dz) & mask) * level.dim * level.dim]!;
        }
        return sum;
    }
}

/**
 * The trace as the GPU runs it: the same walk as `GlobalSdf.sphereTrace`, over the levels as one storage array (each level's cells in
 * toroidal order, one after another). `sdfLevels[i]` says where level i starts and how it is addressed. Included by a kernel that
 * declares `sdfData : array<f32>` and `sdfParams`.
 */
export const GLOBAL_SDF_WGSL = /* wgsl */ `
struct SdfLevel {
    origin : vec3i,    // the window's first cell
    dim : u32,         // cells per axis, a power of two
    cell : f32,        // world size of one cell
    offset : u32,      // where this level starts in sdfData
    pad0 : u32,
    pad1 : u32,
};
struct SdfParams {
    count : u32,
    pad0 : u32,
    pad1 : u32,
    pad2 : u32,
    levels : array<SdfLevel, 4>,
};

fn sdfCell(level : SdfLevel, c : vec3i) -> f32 {
    let m = vec3i(i32(level.dim) - 1);
    let w = c & m;
    return sdfData[level.offset + u32(w.x) + u32(w.y) * level.dim + u32(w.z) * level.dim * level.dim];
}

fn sdfLevelSample(level : SdfLevel, p : vec3f) -> f32 {
    let g = p / level.cell - vec3f(0.5);
    let i0 = vec3i(floor(g));
    let f = g - vec3f(i0);
    let c000 = sdfCell(level, i0);
    let c100 = sdfCell(level, i0 + vec3i(1, 0, 0));
    let c010 = sdfCell(level, i0 + vec3i(0, 1, 0));
    let c110 = sdfCell(level, i0 + vec3i(1, 1, 0));
    let c001 = sdfCell(level, i0 + vec3i(0, 0, 1));
    let c101 = sdfCell(level, i0 + vec3i(1, 0, 1));
    let c011 = sdfCell(level, i0 + vec3i(0, 1, 1));
    let c111 = sdfCell(level, i0 + vec3i(1, 1, 1));
    return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y), mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}

// The finest level holding p at least one cell from its border, or -1.
fn sdfLevelAt(p : vec3f) -> i32 {
    for (var i = 0u; i < sdfParams.count; i = i + 1u) {
        let level = sdfParams.levels[i];
        let c = p / level.cell - vec3f(level.origin);
        if (all(c >= vec3f(1.0)) && all(c <= vec3f(f32(level.dim) - 1.0))) { return i32(i); }
    }
    return -1;
}

// Distance along dir to the first surface within maxT, or -1.
fn sdfTrace(origin : vec3f, dir : vec3f, maxT : f32) -> f32 {
    var t = 0.0;
    for (var i = 0; i < 128; i = i + 1) {
        if (t >= maxT) { return -1.0; }
        let p = origin + dir * t;
        let li = sdfLevelAt(p);
        if (li < 0) { return -1.0; }
        let level = sdfParams.levels[li];
        let d = sdfLevelSample(level, p);
        if (d < level.cell * 0.25) { return t; }
        t = t + max(d, level.cell * 0.25);
    }
    return -1.0;
}
`;
