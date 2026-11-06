// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  displace.ts — the `displace` step: small detail pushed out of the surface along its normal.
 *
 *        A pattern is a function of where a point is, not of a UV, so it runs across a
 *        model with no seams and survives any edit further up. It can only show where
 *        there are vertices to move, so the step first splits what it acts on until the
 *        pattern's finest feature has triangles to land on. That count is what a
 *        `decimate` and a `normalBake` afterwards exist to pay back.
 */
import { boundsOf, compact, dot, faceArea, faceNormal, length, normalize, selectFaces, sub, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';
import { hash3 } from './organic';
import { triangulateFace } from './triangulate';

export const DISPLACE_PATTERNS = ['bumps', 'wrinkles', 'cracks', 'scales', 'pores', 'ribs', 'weave', 'scratches'] as const;
export type DisplacePattern = typeof DISPLACE_PATTERNS[number];

export interface DisplaceParams {
    faces?: FaceSelector;
    /** Only around here, fading to nothing at `radius`. */
    near?: { at: Vec3; radius: number };
    pattern: DisplacePattern;
    /** How far the pattern moves the surface. Negative turns it over: a crease becomes a ridge. */
    amplitude: number;
    /** The size of one feature, in model units. */
    scale: number;
    /** Layers of finer detail, each half the size of the last. bumps and wrinkles. Default 3. */
    octaves?: number;
    seed?: number;
    /** Multiplies `scale` along each axis: [4, 1, 1] draws a pattern out along x, as wrinkles across a forehead. */
    stretch?: Vec3;
    /** Bends the pattern's lines, as a share of `scale`, so they stop looking drawn with a ruler. Default 0. */
    warp?: number;
    /** How wide a line or dot is, as a share of a feature: cracks, pores, scratches. */
    width?: number;
    /** The axis ribs run across. Default y. */
    axis?: 'x' | 'y' | 'z';
    /** The same pattern on both sides of this axis, as a face wants. */
    mirror?: 'x' | 'y' | 'z';
    /** The longest edge to leave. Default a third of the pattern's finest feature. */
    detail?: number;
}

/** What one step may grow a model to. A dense model is a stage on the way to a decimate, and a model this size takes a few seconds a step. */
export const MAX_DISPLACE_TRIANGLES = 1_500_000;

const GRADIENTS: readonly Vec3[] = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
    [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (lo: number, hi: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};
/** A hash in 0..1. */
const unit = (x: number, y: number, z: number, seed: number): number => hash3(x, y, z, seed) * 0.5 + 0.5;

/**
 * Gradient noise, near -1..1. Not organic's value noise: where this one crosses zero it draws a line that wanders
 * freely, and those lines are what a wrinkle is. Value noise's run along its grid.
 */
function gradientNoise(x: number, y: number, z: number, seed: number): number {
    const [ix, iy, iz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
    const [fx, fy, fz] = [x - ix, y - iy, z - iz];
    const corner = (dx: number, dy: number, dz: number): number => {
        const g = GRADIENTS[Math.floor(unit(ix + dx, iy + dy, iz + dz, seed) * 11.999)]!;
        return g[0] * (fx - dx) + g[1] * (fy - dy) + g[2] * (fz - dz);
    };
    const [u, v, w] = [fade(fx), fade(fy), fade(fz)];
    return mix(
        mix(mix(corner(0, 0, 0), corner(1, 0, 0), u), mix(corner(0, 1, 0), corner(1, 1, 0), u), v),
        mix(mix(corner(0, 0, 1), corner(1, 0, 1), u), mix(corner(0, 1, 1), corner(1, 1, 1), u), v),
        w,
    ) * 1.1;
}

/** The distance to the nearest and second-nearest scattered point, and which cell the nearest is in. */
function scattered(x: number, y: number, z: number, seed: number): { f1: number; f2: number; cell: number } {
    const [ix, iy, iz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
    let f1 = Infinity, f2 = Infinity, cell = 0;
    for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const [cx, cy, cz] = [ix + dx, iy + dy, iz + dz];
                const d = Math.hypot(cx + unit(cx, cy, cz, seed) - x, cy + unit(cx, cy, cz, seed + 1) - y, cz + unit(cx, cy, cz, seed + 2) - z);
                if (d < f1) { f2 = f1; f1 = d; cell = unit(cx, cy, cz, seed + 3); } else if (d < f2) f2 = d;
            }
        }
    }
    return { f1, f2, cell };
}

const SCRATCH_LAYERS = 3;
/** How much longer than wide a scratch's cell is. */
const SCRATCH_LENGTH = 8;

function scratches(x: number, y: number, z: number, seed: number, width: number, n: Vec3): number {
    let deepest = 0;
    for (let layer = 0; layer < SCRATCH_LAYERS; layer++) {
        const s = seed + layer * 7;
        // A way for this layer's scratches to run, and two more square to it.
        const along = normalize([hash3(1, layer, 3, s), hash3(5, layer, 7, s), hash3(11, layer, 13, s)]);
        const side = normalize(Math.abs(along[1]) < 0.9 ? [along[2], 0, -along[0]] : [0, -along[2], along[1]]);
        const up: Vec3 = [along[1] * side[2] - along[2] * side[1], along[2] * side[0] - along[0] * side[2], along[0] * side[1] - along[1] * side[0]];
        const p: Vec3 = [x, y, z];
        // A thin sheet and not a thin line: a line in space meets a surface at a point, and a sheet meets it along a curve.
        const b = dot(p, side);
        const ib = Math.floor(b);
        const a = dot(p, along) / SCRATCH_LENGTH + unit(ib, 0, 0, s + 1) * 13;
        const c = dot(p, up) / SCRATCH_LENGTH + unit(ib, 1, 0, s + 1) * 13;
        const [ia, ic] = [Math.floor(a), Math.floor(c)];
        // Each slice across holds one sheet, and most patches of it are missing.
        if (unit(ib, ia, ic, s + 2) < 0.65) continue;
        const dist = Math.abs(b - ib - 0.2 - unit(ib, ia, ic, s + 3) * 0.6);
        // Tapers toward its ends, as something dragged across a surface does.
        const taper = Math.sin(Math.PI * (a - ia)) * Math.sin(Math.PI * (c - ic));
        // Where the sheet lies along the surface it would cut a wide patch and not a line, so it fades there.
        const across = 1 - smooth(0.4, 0.75, Math.abs(dot(n, side)));
        deepest = Math.max(deepest, (1 - smooth(0, width, dist)) * Math.min(1, taper * 3) * across);
    }
    return -deepest;
}

function weaveAt(u: number, v: number): number {
    const [iu, iv] = [Math.floor(u), Math.floor(v)];
    const [a, b] = [Math.sin(Math.PI * (u - iu)), Math.sin(Math.PI * (v - iv))];
    // A thread rises over its crossing and dives under the next, and the two directions take turns.
    return (iu + iv) % 2 === 0 ? b * (0.55 + 0.45 * a) : a * (0.55 + 0.45 * b);
}

/** The pattern at a point of pattern space, where one unit is one feature. Up to about 1 either way. */
function patternAt(p: DisplaceParams, x: number, y: number, z: number, n: Vec3): number {
    const seed = p.seed ?? 1;
    const octaves = p.octaves ?? 3;
    switch (p.pattern) {
        case 'bumps': {
            let sum = 0, amp = 1, total = 0, f = 1;
            for (let o = 0; o < octaves; o++) {
                sum += amp * gradientNoise(x * f, y * f, z * f, seed + o);
                total += amp;
                amp *= 0.5;
                f *= 2;
            }
            return (sum / total) * 1.6;
        }
        case 'wrinkles': {
            // Each layer's zero crossings are its creases; the finer ones weigh less and break up the long ones.
            let sum = 0, amp = 1, total = 0, f = 1;
            for (let o = 0; o < octaves; o++) {
                const ridge = 1 - Math.min(1, Math.abs(gradientNoise(x * f, y * f, z * f, seed + o)) * 2.5);
                sum += amp * ridge * ridge * ridge;
                total += amp;
                amp *= 0.45;
                f *= 2.1;
            }
            return -Math.min(1, (sum / total) * 1.5);
        }
        case 'cracks': {
            const { f1, f2 } = scattered(x, y, z, seed);
            return smooth(0, p.width ?? 0.08, f2 - f1) - 1;
        }
        case 'scales': {
            const { f1, f2 } = scattered(x, y, z, seed);
            // A dome on each cell, falling to a groove where two cells meet.
            return smooth(0, 0.12, f2 - f1) * (1 - Math.min(1, f1 * f1 * 1.2)) - 0.5;
        }
        case 'pores': {
            const { f1, cell } = scattered(x, y, z, seed);
            const w = p.width ?? 0.25;
            // Not every cell has one: an even field of dots reads as a pattern and not as skin.
            return cell < 0.55 ? 0 : -Math.pow(1 - Math.min(1, f1 / w), 2);
        }
        case 'ribs': {
            const across = p.axis === 'x' ? x : p.axis === 'z' ? z : y;
            return Math.sin(2 * Math.PI * across);
        }
        case 'weave': {
            // Three projections, each weighted by how squarely the surface faces it: no axis to stretch along and no seam.
            const w: Vec3 = [Math.pow(Math.abs(n[0]), 4), Math.pow(Math.abs(n[1]), 4), Math.pow(Math.abs(n[2]), 4)];
            const total = w[0] + w[1] + w[2] || 1;
            return ((w[0] * weaveAt(y, z) + w[1] * weaveAt(x, z) + w[2] * weaveAt(x, y)) / total) * 2 - 1;
        }
        case 'scratches':
            return scratches(x, y, z, seed, p.width ?? 0.12, n);
    }
}

/** The longest edge that still draws the pattern, as a share of one feature: a rise and fall needs several points, and a line needs some across its width. */
function finestShare(p: DisplaceParams): number {
    const layers = 2 ** ((p.octaves ?? 3) - 1);
    switch (p.pattern) {
        case 'bumps': return 1 / (4 * layers);
        case 'wrinkles': return 1 / (6 * layers);
        case 'cracks': return (p.width ?? 0.08) / 2;
        case 'scales': return 0.06;
        case 'pores': return (p.width ?? 0.25) / 4;
        case 'ribs': return 1 / 8;
        case 'weave': return 1 / 6;
        case 'scratches': return (p.width ?? 0.12) / 2;
    }
}

/**
 * Splits the faces in @p chosen until no edge of theirs is longer than @p longest. An edge a face outside shares is split
 * like any other, and the new vertex joins that face's outline: it keeps its shape and no gap opens. Left whole, such an edge
 * could never get short, and the triangles against it would go on splitting for as long as there was budget.
 */
function refine(mesh: PolyMesh, chosen: ReadonlySet<number>, longest: number): { mesh: PolyMesh; short: boolean } {
    const positions: Vec3[] = [...mesh.positions];
    // Room for every vertex the budget could make, in a number that stays exact.
    const keyOf = (a: number, b: number): number => (a < b ? a * 67108864 + b : b * 67108864 + a);
    /** Every edge ever split, and the vertex in its middle: what a face outside reads its new outline from. */
    const middles = new Map<number, number>();
    let tris: number[] = [];
    let from: Face[] = [];
    mesh.faces.forEach((face, f) => {
        if (!chosen.has(f)) return;
        for (const [a, b, c] of triangulateFace(mesh, face)) { tris.push(a, b, c); from.push(face); }
    });
    const outside = mesh.faces.length - chosen.size;
    const limit = longest * longest;
    let short = false;
    let moved = false;
    for (;;) {
        const made = new Map<number, number>();
        const wants = (a: number, b: number): boolean => {
            const key = keyOf(a, b);
            if (made.has(key)) return true;
            const [p, q] = [positions[a]!, positions[b]!];
            const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
            if (d <= limit) return false;
            made.set(key, -1);
            return true;
        };
        let after = 0;
        const count = from.length;
        const split = new Uint8Array(count);
        for (let t = 0; t < count; t++) {
            const [a, b, c] = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
            const mask = (wants(a, b) ? 1 : 0) | (wants(b, c) ? 2 : 0) | (wants(c, a) ? 4 : 0);
            split[t] = mask;
            after += 1 + (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
        }
        if (made.size === 0) break;
        if (after + outside > MAX_DISPLACE_TRIANGLES) { short = true; break; }
        moved = true;
        const middle = (a: number, b: number): number => {
            const key = keyOf(a, b);
            let m = made.get(key)!;
            if (m < 0) {
                const [p, q] = [positions[a]!, positions[b]!];
                m = positions.length;
                positions.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
                made.set(key, m);
                middles.set(key, m);
            }
            return m;
        };
        const nextTris: number[] = [];
        const nextFrom: Face[] = [];
        const out = (a: number, b: number, c: number, face: Face): void => { nextTris.push(a, b, c); nextFrom.push(face); };
        for (let t = 0; t < count; t++) {
            const [a, b, c] = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
            const face = from[t]!;
            const mask = split[t]!;
            if (mask === 0) { out(a, b, c, face); continue; }
            if (mask === 7) {
                const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)];
                out(a, ab, ca, face); out(ab, b, bc, face); out(ca, bc, c, face); out(ab, bc, ca, face);
                continue;
            }
            // One or two edges: turn the triangle so the first is a-b, and the second, if any, is b-c.
            const single = mask === 1 || mask === 2 || mask === 4;
            const turn = single ? (mask === 1 ? 0 : mask === 2 ? 1 : 2) : (mask === 3 ? 0 : mask === 6 ? 1 : 2);
            const [p, q, r] = turn === 0 ? [a, b, c] : turn === 1 ? [b, c, a] : [c, a, b];
            const pq = middle(p, q);
            if (single) { out(p, pq, r, face); out(pq, q, r, face); continue; }
            const qr = middle(q, r);
            out(pq, q, qr, face); out(p, pq, qr, face); out(p, qr, r, face);
        }
        tris = nextTris;
        from = nextFrom;
    }
    if (!moved) return { mesh, short };
    const outline = (a: number, b: number, into: number[]): void => {
        const m = middles.get(keyOf(a, b));
        if (m === undefined) { into.push(a); return; }
        outline(a, m, into);
        outline(m, b, into);
    };
    const faces: Face[] = [];
    mesh.faces.forEach((face, f) => {
        if (chosen.has(f)) return;
        const v: number[] = [];
        for (let i = 0; i < face.v.length; i++) outline(face.v[i]!, face.v[(i + 1) % face.v.length]!, v);
        faces.push(v.length === face.v.length ? face : { ...face, v });
    });
    for (let t = 0; t < from.length; t++) faces.push({ ...from[t]!, v: [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!] });
    return { mesh: { positions, faces }, short };
}

export function displace(mesh: PolyMesh, p: DisplaceParams): PolyMesh {
    if (!DISPLACE_PATTERNS.includes(p.pattern)) throw new Error(`pattern ${JSON.stringify(p.pattern)} must be one of ${DISPLACE_PATTERNS.join(', ')}`);
    if (!(p.scale > 0)) throw new Error(`scale ${p.scale} must be positive`);
    if (p.octaves !== undefined && !(p.octaves >= 1 && p.octaves <= 6)) throw new Error(`octaves ${p.octaves} must be 1..6`);
    if (p.detail !== undefined && !(p.detail > 0)) throw new Error(`detail ${p.detail} must be positive`);
    if (p.width !== undefined && !(p.width > 0)) throw new Error(`width ${p.width} must be positive`);
    if (p.stretch && !p.stretch.every((s) => s > 0)) throw new Error(`stretch ${JSON.stringify(p.stretch)} must be positive`);
    if (p.near && !(p.near.radius > 0)) throw new Error(`near.radius ${p.near.radius} must be positive`);

    const selector = p.faces ?? 'all';
    let hit = selectFaces(mesh, selector);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(selector)} matched no face`);
    if (p.near) {
        const { at, radius } = p.near;
        // By the box round a face: one large face can cross the ball with every corner far outside it.
        hit = hit.filter((f) => {
            const { min, max } = boundsOf(mesh, mesh.faces[f]!.v);
            const gap = [0, 1, 2].map((k) => Math.max(min[k]! - at[k]!, 0, at[k]! - max[k]!));
            return Math.hypot(gap[0]!, gap[1]!, gap[2]!) < radius;
        });
        if (hit.length === 0) throw new Error(`no surface of \`faces\` within ${radius} of ${JSON.stringify(at)}`);
    }

    const smallest = Math.min(...(p.stretch ?? [1, 1, 1])) * p.scale;
    const longest = p.detail ?? smallest * finestShare(p);
    const { mesh: fine, short } = refine(mesh, new Set(hit), longest);

    // Splitting puts the step's faces last, in place of the ones it was given; with nothing to split they are where they were.
    const chosen = new Set(hit);
    const isChosen = (f: number): boolean => (fine === mesh ? chosen.has(f) : f >= mesh.faces.length - hit.length);
    const inside = new Uint8Array(fine.positions.length);
    fine.faces.forEach((face, f) => {
        if (isChosen(f)) for (const v of face.v) inside[v] = 1;
    });
    // A vertex a face outside also uses stays put, or the surface opens.
    fine.faces.forEach((face, f) => {
        if (!isChosen(f)) for (const v of face.v) inside[v] = 0;
    });

    const normals = new Float64Array(fine.positions.length * 3);
    for (const face of fine.faces) {
        const n = faceNormal(fine, face);
        const area = faceArea(fine, face);
        for (const v of face.v) {
            normals[v * 3]! += n[0] * area;
            normals[v * 3 + 1]! += n[1] * area;
            normals[v * 3 + 2]! += n[2] * area;
        }
    }
    const stretch = p.stretch ?? [1, 1, 1];
    const [sx, sy, sz] = [p.scale * stretch[0], p.scale * stretch[1], p.scale * stretch[2]];
    const seed = p.seed ?? 1;
    const warp = p.warp ?? 0;
    const positions: Vec3[] = fine.positions.map((at, v) => {
        if (!inside[v]) return at;
        let weight = 1;
        if (p.near) {
            const t = 1 - length(sub(at, p.near.at)) / p.near.radius;
            if (t <= 0) return at;
            weight = t * t * (3 - 2 * t);
        }
        const n = normalize([normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!]);
        let [x, y, z] = [at[0], at[1], at[2]];
        if (p.mirror === 'x') x = Math.abs(x);
        if (p.mirror === 'y') y = Math.abs(y);
        if (p.mirror === 'z') z = Math.abs(z);
        x /= sx; y /= sy; z /= sz;
        if (warp > 0) {
            const [wx, wy, wz] = [
                gradientNoise(x * 0.7 + 3.1, y * 0.7, z * 0.7, seed + 40),
                gradientNoise(x * 0.7, y * 0.7 + 5.7, z * 0.7, seed + 41),
                gradientNoise(x * 0.7, y * 0.7, z * 0.7 + 9.3, seed + 42),
            ];
            x += wx * warp; y += wy * warp; z += wz * warp;
        }
        const push = patternAt(p, x, y, z, n) * p.amplitude * weight;
        return [at[0] + n[0] * push, at[1] + n[1] * push, at[2] + n[2] * push];
    });

    const out = compact({ positions, faces: fine.faces });
    return short ? { ...out, notes: [`this pattern wants edges of ${longest.toPrecision(3)} and stopped at ${MAX_DISPLACE_TRIANGLES} triangles, so its finest detail is lost: raise \`scale\`, narrow it with \`faces\` or \`near\`, or give a larger \`detail\``] } : out;
}
