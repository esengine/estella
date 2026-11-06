// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  organic.ts — a body from its parts: the `organic` step.
 *
 *        Living shapes are what steps on polygons cannot say: a shoulder has no edges
 *        to select. So this describes volumes instead, the way a person sketching a
 *        creature does, as a torso, limbs running from a joint to a joint, a skull. Each
 *        part melts into those before it by `blend`, or carves into them, and the skin
 *        is found afterwards. Nothing needs its topology thought about, and moving a
 *        shoulder is one number, which is what makes this something an agent can steer.
 *
 *        The volume is a signed distance field; the skin is Naive Surface Nets over a
 *        grid of it, with each vertex then settled onto the true surface. The result
 *        is one more shell of quads, so every later step can act on it. Its faces are
 *        marked smooth, and each carries the tag and colour of the part nearest it.
 */
import { add, type Face, type PolyMesh, type Vec3 } from './polyMesh';

export type OrganicShape = 'sphere' | 'ellipsoid' | 'box' | 'torus' | 'chain';

export interface OrganicNoise {
    /** How far the surface moves, in and out. */
    amplitude: number;
    /** Size of the bumps, in world units. */
    scale: number;
    octaves?: number;
    seed?: number;
}

export interface OrganicPart {
    shape: OrganicShape;
    tag?: string;
    at?: Vec3;
    /** Degrees, X then Y then Z: for ellipsoid, box and torus. */
    rotate?: Vec3;
    /** sphere; torus's ring. */
    radius?: number;
    /** ellipsoid's three half-axes. */
    radii?: Vec3;
    /** box's whole size. */
    size?: Vec3;
    /** box's corners. */
    rounding?: number;
    /** torus's thickness. */
    tube?: number;
    /** chain: a limb, a tail, a branch, as [x, y, z, radius] along its length. */
    points?: readonly (readonly [number, number, number, number])[];
    /** How far this melts into what is before it; 0 is a hard crease. Defaults to the step's. */
    blend?: number;
    /** Carves this volume out of what is before it: an eye socket, a mouth. */
    subtract?: boolean;
    /** Also exists reflected across this axis's zero plane: the other arm. */
    mirror?: 'x' | 'y' | 'z';
    color?: readonly number[];
    noise?: OrganicNoise;
}

export interface OrganicParams {
    parts: readonly OrganicPart[];
    /** Grid cells along the longest side. More resolves more detail, at the cost of triangles. */
    resolution?: number;
    blend?: number;
    noise?: OrganicNoise;
    at?: Vec3;
    tag?: string;
    color?: readonly number[];
}

export const ORGANIC_DEFAULT_RESOLUTION = 64;
export const ORGANIC_MAX_RESOLUTION = 160;
const DEG = Math.PI / 180;

type Color = readonly [number, number, number, number];
type Eval = (x: number, y: number, z: number) => number;

// ---- Noise: value noise, seeded and platform-independent, so a bake is the same everywhere ----

function hash3(x: number, y: number, z: number, seed: number): number {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647 - 1274126177) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function valueNoise(x: number, y: number, z: number, seed: number): number {
    const [ix, iy, iz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
    const [u, v, w] = [fade(x - ix), fade(y - iy), fade(z - iz)];
    const at = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
    return mix(
        mix(mix(at(0, 0, 0), at(1, 0, 0), u), mix(at(0, 1, 0), at(1, 1, 0), u), v),
        mix(mix(at(0, 0, 1), at(1, 0, 1), u), mix(at(0, 1, 1), at(1, 1, 1), u), v),
        w,
    );
}

function noiseField(n: OrganicNoise): Eval {
    const octaves = n.octaves ?? 3;
    const seed = n.seed ?? 1;
    return (x, y, z) => {
        let sum = 0, amp = 1, total = 0, f = 1 / n.scale;
        for (let o = 0; o < octaves; o++) {
            sum += amp * valueNoise(x * f, y * f, z * f, seed + o);
            total += amp;
            amp *= 0.5;
            f *= 2;
        }
        return (sum / total) * n.amplitude;
    };
}

// ---- Shapes ---------------------------------------------------------------------

/** World to part space: the inverse of rotating X, then Y, then Z. */
function inverseRotation(degrees: Vec3): (x: number, y: number, z: number, out: number[]) => void {
    const [cx, sx] = [Math.cos(degrees[0] * DEG), Math.sin(degrees[0] * DEG)];
    const [cy, sy] = [Math.cos(degrees[1] * DEG), Math.sin(degrees[1] * DEG)];
    const [cz, sz] = [Math.cos(degrees[2] * DEG), Math.sin(degrees[2] * DEG)];
    return (x, y, z, out) => {
        const ax = cz * x + sz * y, ay = -sz * x + cz * y;
        const bx = cy * ax - sy * z, bz = sy * ax + cy * z;
        out[0] = bx;
        out[1] = cx * ay + sx * bz;
        out[2] = -sx * ay + cx * bz;
    };
}

/** The part's distance function in its own frame, and how far from `at` it can reach. */
function shapeField(part: OrganicPart): { field: Eval; reach: number; thinnest: number } {
    const need = (name: keyof OrganicPart): void => {
        if (part[name] === undefined) throw new Error(`a ${part.shape} part needs \`${name}\``);
    };
    switch (part.shape) {
        case 'sphere': {
            need('radius');
            const r = part.radius!;
            if (r <= 0) throw new Error('radius must be positive');
            return { field: (x, y, z) => Math.sqrt(x * x + y * y + z * z) - r, reach: r, thinnest: r };
        }
        case 'ellipsoid': {
            need('radii');
            const [a, b, c] = part.radii!;
            if (a <= 0 || b <= 0 || c <= 0) throw new Error('radii must be positive');
            return {
                field: (x, y, z) => {
                    const k0 = Math.sqrt((x * x) / (a * a) + (y * y) / (b * b) + (z * z) / (c * c));
                    const k1 = Math.sqrt((x * x) / a ** 4 + (y * y) / b ** 4 + (z * z) / c ** 4);
                    return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
                },
                reach: Math.max(a, b, c),
                thinnest: Math.min(a, b, c),
            };
        }
        case 'box': {
            need('size');
            const [hx, hy, hz] = [part.size![0] / 2, part.size![1] / 2, part.size![2] / 2];
            if (hx <= 0 || hy <= 0 || hz <= 0) throw new Error('size must be positive');
            const r = Math.min(part.rounding ?? 0, hx, hy, hz);
            return {
                field: (x, y, z) => {
                    const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
                    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
                    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
                },
                reach: Math.hypot(hx, hy, hz),
                thinnest: Math.min(hx, hy, hz),
            };
        }
        case 'torus': {
            need('radius');
            need('tube');
            const [ring, tube] = [part.radius!, part.tube!];
            if (ring <= 0 || tube <= 0) throw new Error('radius and tube must be positive');
            return {
                field: (x, y, z) => {
                    const q = Math.sqrt(x * x + z * z) - ring;
                    return Math.sqrt(q * q + y * y) - tube;
                },
                reach: ring + tube,
                thinnest: tube,
            };
        }
        case 'chain': {
            need('points');
            const pts = part.points!;
            if (pts.length < 2) throw new Error(`a chain needs at least 2 points, not ${pts.length}`);
            if (pts.some((p) => p[3] <= 0)) throw new Error('every chain point needs a positive radius, its fourth number');
            return {
                field: (x, y, z) => {
                    let best = Infinity;
                    for (let i = 0; i + 1 < pts.length; i++) {
                        const a = pts[i]!, b = pts[i + 1]!;
                        const [bx, by, bz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                        const [px, py, pz] = [x - a[0], y - a[1], z - a[2]];
                        const len2 = bx * bx + by * by + bz * bz;
                        const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / len2)) : 0;
                        const [dx, dy, dz] = [px - bx * t, py - by * t, pz - bz * t];
                        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (a[3] + (b[3] - a[3]) * t);
                        if (d < best) best = d;
                    }
                    return best;
                },
                reach: Math.max(...pts.map((p) => Math.hypot(p[0], p[1], p[2]) + p[3])),
                // Its widest: a limb tapering to a point past the grid is a limb, and only one wholly under it goes missing.
                thinnest: Math.max(...pts.map((p) => p[3])),
            };
        }
        default:
            throw new Error(`unknown shape ${JSON.stringify(part.shape)}; there are sphere, ellipsoid, box, torus, chain`);
    }
}

interface CompiledPart {
    distance: Eval;
    blend: number;
    subtract: boolean;
    tag: string;
    color: Color | null;
    min: Vec3;
    max: Vec3;
    thinnest: number;
    label: string;
}

const toColor = (c: readonly number[] | undefined): Color | null => {
    if (!c) return null;
    if ((c.length !== 3 && c.length !== 4) || c.some((v) => v < 0 || v > 1)) {
        throw new Error(`color ${JSON.stringify(c)} must be [r, g, b] or [r, g, b, a], each 0..1 (linear)`);
    }
    return [c[0]!, c[1]!, c[2]!, c[3] ?? 1];
};

function compilePart(part: OrganicPart, index: number, params: OrganicParams): CompiledPart {
    const { field, reach, thinnest } = shapeField(part);
    const at = part.at ?? [0, 0, 0];
    const noise = part.noise ? noiseField(part.noise) : null;
    const rotate = part.rotate && part.shape !== 'sphere' && part.shape !== 'chain' ? inverseRotation(part.rotate) : null;
    const local = [0, 0, 0];
    const axis = part.mirror === undefined ? -1 : { x: 0, y: 1, z: 2 }[part.mirror];
    const label = part.tag ? `"${part.tag}"` : `${index}`;
    if (part.rotate && !rotate) throw new Error(`part ${label}: rotate means nothing on a ${part.shape}`);

    const distance: Eval = (wx, wy, wz) => {
        let x = wx, y = wy, z = wz;
        // Folded across the plane: both halves of a symmetric pair are one evaluation, and meet without a seam of their own.
        if (axis === 0) x = Math.abs(x);
        else if (axis === 1) y = Math.abs(y);
        else if (axis === 2) z = Math.abs(z);
        x -= at[0]; y -= at[1]; z -= at[2];
        if (rotate) { rotate(x, y, z, local); x = local[0]!; y = local[1]!; z = local[2]!; }
        const d = field(x, y, z);
        return noise ? d + noise(wx, wy, wz) : d;
    };

    const margin = part.noise?.amplitude ?? 0;
    const extent = reach + margin;
    let min: Vec3, max: Vec3;
    if (part.shape === 'chain') {
        // A chain's points are already placed by `at`'s offset.
        const pts = part.points!;
        min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]! - p[3])) + at[k]! - margin) as unknown as Vec3;
        max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]! + p[3])) + at[k]! + margin) as unknown as Vec3;
    } else {
        min = [at[0] - extent, at[1] - extent, at[2] - extent];
        max = [at[0] + extent, at[1] + extent, at[2] + extent];
    }
    if (axis >= 0) {
        // The reflection is in the bounds too.
        const lo = [...min], hi = [...max];
        lo[axis] = Math.min(min[axis]!, -max[axis]!);
        hi[axis] = Math.max(max[axis]!, -min[axis]!);
        min = lo as unknown as Vec3;
        max = hi as unknown as Vec3;
    }
    const blend = part.blend ?? params.blend ?? 0;
    if (blend < 0) throw new Error(`part ${label}: blend ${blend} must not be negative`);
    return {
        distance, blend, subtract: part.subtract === true, tag: part.tag ?? params.tag ?? '',
        color: toColor(part.color), min, max, thinnest, label,
    };
}

// ---- The whole body ------------------------------------------------------------

/** Folds the parts in order. `h` is how much of the running result survives the part, 0..1: smooth min's own weight. */
function bodyField(parts: readonly CompiledPart[], noise: Eval | null): Eval {
    return (x, y, z) => {
        let d = Infinity;
        for (const part of parts) {
            const p = part.distance(x, y, z);
            if (part.subtract) {
                const k = part.blend;
                if (k <= 0) { d = Math.max(d, -p); continue; }
                const h = Math.min(1, Math.max(0, 0.5 - (0.5 * (d + p)) / k));
                d = mix(d, -p, h) + k * h * (1 - h);
            } else {
                const k = part.blend;
                if (k <= 0 || d === Infinity) { d = Math.min(d, p); continue; }
                const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (p - d)) / k));
                d = mix(p, d, h) - k * h * (1 - h);
            }
        }
        return noise ? d + noise(x, y, z) : d;
    };
}

/** Which part owns a point on the skin, and the colour there: the same fold, tracking what each step's weight kept. */
function paintAt(parts: readonly CompiledPart[], base: Color | null, x: number, y: number, z: number): { tag: string; color: Color | null } {
    let d = Infinity;
    let tag = '';
    let color: Color | null = base;
    const take = (part: CompiledPart, weight: number): void => {
        // `weight` is how much the part shows here.
        if (weight > 0.5) tag = part.tag;
        const c = part.color ?? base;
        if (c && color && c !== color) color = [0, 1, 2, 3].map((i) => mix(color![i]!, c[i]!, weight)) as unknown as Color;
        else if (c && !color && weight > 0.5) color = c;
    };
    for (const part of parts) {
        const p = part.distance(x, y, z);
        const k = Math.max(part.blend, 1e-5);
        if (part.subtract) {
            const h = Math.min(1, Math.max(0, 0.5 - (0.5 * (d + p)) / k));
            d = mix(d, -p, h) + k * h * (1 - h);
            if (part.color) take(part, h);
        } else if (d === Infinity) {
            d = p;
            tag = part.tag;
            color = part.color ?? base;
        } else {
            const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (p - d)) / k));
            d = mix(p, d, h) - k * h * (1 - h);
            take(part, 1 - h);
        }
    }
    return { tag, color };
}

/** Under this many quads, a separate piece of skin is the grid losing a thin tip, never a part: a part is refused long before it is this small. */
const SPECK_QUADS = 24;

/** The quads without the specks a taper past the grid's resolution leaves floating off its end. */
function keepLargeIslands(quads: readonly number[][], vertices: number): number[][] {
    const parent = Array.from({ length: vertices }, (_, i) => i);
    const find = (i: number): number => {
        let at = i;
        while (parent[at] !== at) { parent[at] = parent[parent[at]!]!; at = parent[at]!; }
        return at;
    };
    for (const q of quads) for (let i = 1; i < 4; i++) parent[find(q[i]!)] = find(q[0]!);
    const size = new Map<number, number>();
    for (const q of quads) size.set(find(q[0]!), (size.get(find(q[0]!)) ?? 0) + 1);
    return quads.filter((q) => size.get(find(q[0]!))! >= SPECK_QUADS);
}

/** One more shell: the skin of @p params' parts, in the steps' usual outward winding. */
export function organic(mesh: PolyMesh, params: OrganicParams): PolyMesh {
    if (!params.parts?.length) throw new Error('`parts` names nothing to build');
    const resolution = params.resolution ?? ORGANIC_DEFAULT_RESOLUTION;
    if (!Number.isInteger(resolution) || resolution < 8 || resolution > ORGANIC_MAX_RESOLUTION) {
        throw new Error(`resolution ${resolution} must be a whole number, 8..${ORGANIC_MAX_RESOLUTION}`);
    }
    const parts = params.parts.map((p, i) => {
        try {
            return compilePart(p, i, params);
        } catch (e) {
            throw new Error(`part ${p.tag ? `"${p.tag}"` : i}: ${(e as Error).message}`);
        }
    });
    if (parts[0]!.subtract) throw new Error('the first part cannot subtract: there is nothing yet to carve');
    const adding = parts.filter((p) => !p.subtract);

    const noise = params.noise ? noiseField(params.noise) : null;
    const field = bodyField(parts, noise);
    const margin = (params.noise?.amplitude ?? 0) + Math.max(...adding.map((p) => p.blend));
    const min = [0, 1, 2].map((k) => Math.min(...adding.map((p) => p.min[k]!)) - margin);
    const max = [0, 1, 2].map((k) => Math.max(...adding.map((p) => p.max[k]!)) + margin);
    const longest = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
    const cell = longest / resolution;

    // A part the grid cannot see simply is not in the result, and it reads as a model that ignored the request.
    for (const part of parts) {
        if (part.thinnest * 2 < cell * 1.5) {
            const needed = Math.ceil((longest * 1.5) / (part.thinnest * 2));
            throw new Error(`part ${part.label} is ${(part.thinnest * 2).toFixed(4)} across, too thin for the grid's cell of ${cell.toFixed(4)}, so it would vanish; `
                + (needed <= ORGANIC_MAX_RESOLUTION
                    ? `make it thicker or raise resolution to at least ${needed}`
                    : `make it at least ${((longest / ORGANIC_MAX_RESOLUTION) * 1.5).toFixed(4)} across, or build this body smaller and separate from its small details`));
        }
    }

    const pad = 2;
    const [nx, ny, nz] = [0, 1, 2].map((k) => Math.ceil((max[k]! - min[k]!) / cell) + pad * 2 + 1) as [number, number, number];
    const ox = min[0]! - pad * cell, oy = min[1]! - pad * cell, oz = min[2]! - pad * cell;
    const values = new Float32Array(nx * ny * nz);
    const idx = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
    // Most of the grid is nowhere near the skin and only its sign is ever read. A block whose centre is clearly further
    // from the surface than the block is wide takes that one value. Doubled, as an ellipsoid's distance is an estimate.
    const BLOCK = 4;
    const clear = Math.sqrt(3) * BLOCK * cell;
    for (let bk = 0; bk < nz; bk += BLOCK) {
        for (let bj = 0; bj < ny; bj += BLOCK) {
            for (let bi = 0; bi < nx; bi += BLOCK) {
                const centre = field(ox + (bi + BLOCK / 2) * cell, oy + (bj + BLOCK / 2) * cell, oz + (bk + BLOCK / 2) * cell);
                const far = Math.abs(centre) > clear;
                for (let k = bk; k < Math.min(nz, bk + BLOCK); k++) {
                    for (let j = bj; j < Math.min(ny, bj + BLOCK); j++) {
                        for (let i = bi; i < Math.min(nx, bi + BLOCK); i++) {
                            values[idx(i, j, k)] = far ? centre : field(ox + i * cell, oy + j * cell, oz + k * cell);
                        }
                    }
                }
            }
        }
    }

    // Surface Nets: one vertex per cell the surface passes through, at the mean of where it crosses that cell's edges.
    const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
    const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
    const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
    const positions: Vec3[] = [];
    const corner = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) {
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                let inside = 0;
                for (let c = 0; c < 8; c++) {
                    const v = values[idx(i + CORNERS[c]![0], j + CORNERS[c]![1], k + CORNERS[c]![2])]!;
                    corner[c] = v;
                    if (v < 0) inside++;
                }
                if (inside === 0 || inside === 8) continue;
                let sx = 0, sy = 0, sz = 0, count = 0;
                for (const [a, b] of EDGES) {
                    const va = corner[a]!, vb = corner[b]!;
                    if ((va < 0) === (vb < 0)) continue;
                    const t = va / (va - vb);
                    const A = CORNERS[a]!, B = CORNERS[b]!;
                    sx += A[0] + (B[0] - A[0]) * t;
                    sy += A[1] + (B[1] - A[1]) * t;
                    sz += A[2] + (B[2] - A[2]) * t;
                    count++;
                }
                cellVertex[idx(i, j, k)] = positions.length;
                positions.push([ox + (i + sx / count) * cell, oy + (j + sy / count) * cell, oz + (k + sz / count) * cell]);
            }
        }
    }
    if (positions.length === 0) throw new Error('these parts leave no surface: everything was carved away');

    // Settled onto the true surface: the mean of the crossings is only near it, and that is what makes a grid show through as terracing.
    const e = cell * 0.25;
    for (let n = 0; n < positions.length; n++) {
        let [x, y, z] = positions[n]!;
        for (let step = 0; step < 2; step++) {
            const d = field(x, y, z);
            const gx = field(x + e, y, z) - field(x - e, y, z);
            const gy = field(x, y + e, z) - field(x, y - e, z);
            const gz = field(x, y, z + e) - field(x, y, z - e);
            const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
            if (g2 < 1e-8) break;
            // Bounded, so a crease's bad gradient cannot throw a vertex across the cell.
            const s = Math.max(-cell * 0.5, Math.min(cell * 0.5, d / Math.sqrt(g2)));
            const n2 = Math.sqrt(g2) * 2 * e;
            x -= (s * gx) / n2; y -= (s * gy) / n2; z -= (s * gz) / n2;
        }
        positions[n] = [x, y, z];
    }

    // A quad across every grid edge the surface crosses, wound by which end is inside.
    const quads: number[][] = [];
    const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        quads.push(flip ? [d, c, b, a] : [a, b, c, d]);
    };
    for (let k = 1; k < nz - 1; k++) {
        for (let j = 1; j < ny - 1; j++) {
            for (let i = 1; i < nx - 1; i++) {
                const here = values[idx(i, j, k)]! < 0;
                if (here !== (values[idx(i + 1, j, k)]! < 0)) {
                    quad(cellVertex[idx(i, j - 1, k - 1)]!, cellVertex[idx(i, j, k - 1)]!, cellVertex[idx(i, j, k)]!, cellVertex[idx(i, j - 1, k)]!, !here);
                }
                if (here !== (values[idx(i, j + 1, k)]! < 0)) {
                    quad(cellVertex[idx(i - 1, j, k - 1)]!, cellVertex[idx(i - 1, j, k)]!, cellVertex[idx(i, j, k)]!, cellVertex[idx(i, j, k - 1)]!, !here);
                }
                if (here !== (values[idx(i, j, k + 1)]! < 0)) {
                    quad(cellVertex[idx(i - 1, j - 1, k)]!, cellVertex[idx(i, j - 1, k)]!, cellVertex[idx(i, j, k)]!, cellVertex[idx(i - 1, j, k)]!, !here);
                }
            }
        }
    }

    const base = toColor(params.color);
    const at = params.at ?? [0, 0, 0];
    const start = mesh.positions.length;
    const faces: Face[] = keepLargeIslands(quads, positions.length).map((loop) => {
        let cx = 0, cy = 0, cz = 0;
        for (const v of loop) {
            cx += positions[v]![0]; cy += positions[v]![1]; cz += positions[v]![2];
        }
        const { tag, color } = paintAt(parts, base, cx / 4, cy / 4, cz / 4);
        return { v: loop.map((v) => v + start), tag: tag || params.tag || '', smooth: true, ...(color ? { color } : {}) };
    });
    return {
        positions: [...mesh.positions, ...positions.map((p) => add(p, at))],
        faces: [...mesh.faces, ...faces],
    };
}
