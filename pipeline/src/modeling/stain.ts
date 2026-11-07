// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  stain.ts — the `stain` step: colour laid over a surface by what is there, in place of one flat paint.
 *
 *        Where it lands comes from up to four things multiplied together: a pattern, how the surface
 *        is shaped there, which way it faces, and a spot. It works on faces, as all paint here does, so
 *        how fine it can be is how fine the faces are: it splits them as far as its pattern needs, and a
 *        normalBake with `color` carries the result onto a thin mesh.
 */
import { DISPLACE_PATTERNS, finestShare, mirroredPoint, nearWeight, patternField, reachedFaces, refine, MAX_DISPLACE_TRIANGLES, type DisplaceParams, type DisplacePattern } from './displace';
import { compact, faceArea, faceNormal, normalize, selectFaces, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';
import { drawnLine, facesInView, lineMeasure, seenFrom, viewOf, type ViewName } from './surfaceLine';

/** How far a mirrored point is from a line of points. */
function toLine(points: readonly Vec3[], mirror: StainParams['mirror'], x: number, y: number, z: number): number {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
        const a = mirroredPoint(mirror, points[i - 1]!), b = mirroredPoint(mirror, points[i]!);
        const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const span = dx * dx + dy * dy + dz * dz;
        const t = span > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / span)) : 0;
        best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t, z - a[2] - dz * t));
    }
    return best;
}

export interface StainParams {
    faces?: FaceSelector;
    /** Only around here. Fades to its edge, or with `hard` stops there: a pupil. */
    near?: { at: Vec3; radius: number };
    /** Only along a line drawn on the surface, its points on or near it: an eyelid, a lip, a seam. Fades to `width` either side, or with `hard` stops there. With `from: "+z"` its points are [x, y], and it lands on what that view sees. */
    line?: { points: readonly (readonly number[])[]; width: number; from?: ViewName; curve?: number };
    hard?: boolean;
    /** Linear [r, g, b], over what is there. */
    color?: readonly number[];
    /** How rough to make it, 0..1: moss and dust dull a surface, wear polishes it. */
    roughness?: number;
    /** How much metal to make it, 0..1: bare steel where the paint has worn off. */
    metallic?: number;
    /** How solid to make it, 0..1: 0 is a hole, under a material with `alpha`. */
    alpha?: number;
    /** How strongly, 0..1, where the rest say all the way. Default 1. */
    amount?: number;
    pattern?: DisplacePattern;
    scale?: number;
    octaves?: number;
    seed?: number;
    stretch?: Vec3;
    warp?: number;
    width?: number;
    axis?: 'x' | 'y' | 'z';
    mirror?: 'x' | 'y' | 'z';
    /** How much of the pattern it takes, 0..1, higher being less of it. Default 0.5. */
    threshold?: number;
    /** How gradually it starts, around the threshold. Default 0.15. */
    softness?: number;
    /** Dirt in what is sunken, or wear on what stands out. */
    where?: 'cavity' | 'edges';
    /** How wide a dip or a ridge counts, in model units. Default about eight edges. */
    reach?: number;
    /** Only where the surface faces this way: moss on top, damp below. */
    facing?: Vec3;
    /** The longest edge to leave. */
    detail?: number;
}

const smooth = (lo: number, hi: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};

const MAX_SMOOTHING = 40;
/** Shape is judged against the steepest few percent: a model's own depth decides what counts as deep, whatever its units. */
const SHAPE_PERCENTILE = 0.95;
/** Patterns that are dents (0 and below) rather than a rise and fall about 0. */
const DENTS: ReadonlySet<DisplacePattern> = new Set(['wrinkles', 'cracks', 'pores', 'scratches']);

/**
 * How far each vertex sits below (positive) or above its surroundings, in shares of the model's deepest: the surface
 * against a smoothed copy of itself, along the normal.
 */
function relief(mesh: PolyMesh, normals: Float64Array, reach: number | undefined): Float32Array {
    const count = mesh.positions.length;
    const smoothed = new Float64Array(count * 3);
    mesh.positions.forEach((p, v) => { smoothed[v * 3] = p[0]; smoothed[v * 3 + 1] = p[1]; smoothed[v * 3 + 2] = p[2]; });
    let edgeCount = 0;
    for (const face of mesh.faces) edgeCount += face.v.length;
    const from = new Int32Array(edgeCount), to = new Int32Array(edgeCount);
    let n = 0, total = 0;
    for (const face of mesh.faces) {
        for (let i = 0; i < face.v.length; i++) {
            const [a, b] = [face.v[i]!, face.v[(i + 1) % face.v.length]!];
            from[n] = a; to[n] = b; n++;
            const [p, q] = [mesh.positions[a]!, mesh.positions[b]!];
            total += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        }
    }
    const edge = total / Math.max(1, n);
    // Averaging spreads about one edge per pass squared, so the passes go with the square of how far it should reach.
    const passes = Math.max(1, Math.min(MAX_SMOOTHING, Math.round(((reach ?? edge * 8) / edge) ** 2)));
    const sum = new Float64Array(count * 3);
    const links = new Int32Array(count);
    for (let e = 0; e < n; e++) { links[from[e]!]!++; links[to[e]!]!++; }
    for (let pass = 0; pass < passes; pass++) {
        sum.fill(0);
        for (let e = 0; e < n; e++) {
            const [a, b] = [from[e]! * 3, to[e]! * 3];
            for (let k = 0; k < 3; k++) { sum[a + k]! += smoothed[b + k]!; sum[b + k]! += smoothed[a + k]!; }
        }
        for (let v = 0; v < count; v++) {
            if (links[v] === 0) continue;
            for (let k = 0; k < 3; k++) smoothed[v * 3 + k] = sum[v * 3 + k]! / links[v]!;
        }
    }
    const out = new Float32Array(count);
    mesh.positions.forEach((p, v) => {
        out[v] = (smoothed[v * 3]! - p[0]) * normals[v * 3]! + (smoothed[v * 3 + 1]! - p[1]) * normals[v * 3 + 1]! + (smoothed[v * 3 + 2]! - p[2]) * normals[v * 3 + 2]!;
    });
    const sorted = Float32Array.from(out, Math.abs).sort();
    const deep = sorted[Math.floor((sorted.length - 1) * SHAPE_PERCENTILE)]! || 1;
    for (let v = 0; v < count; v++) out[v]! /= deep;
    return out;
}

export function stain(mesh: PolyMesh, p: StainParams, budget = MAX_DISPLACE_TRIANGLES, surfaceDefaults?: { roughness: number; metallic: number }): PolyMesh {
    if (p.color === undefined && p.roughness === undefined && p.metallic === undefined && p.alpha === undefined) throw new Error('give at least one of color, roughness, metallic, alpha');
    if (p.color !== undefined && p.color.length < 3) throw new Error('color must be [r, g, b]');
    for (const [name, v] of [['roughness', p.roughness], ['metallic', p.metallic], ['alpha', p.alpha]] as const) {
        if (v !== undefined && !(v >= 0 && v <= 1)) throw new Error(`${name} ${v} must be 0..1`);
    }
    if (p.pattern !== undefined && !DISPLACE_PATTERNS.includes(p.pattern)) throw new Error(`pattern ${JSON.stringify(p.pattern)} must be one of ${DISPLACE_PATTERNS.join(', ')}`);
    if (p.pattern !== undefined && !(p.scale! > 0)) throw new Error('a pattern needs a positive `scale`');
    if (p.amount !== undefined && !(p.amount >= 0 && p.amount <= 1)) throw new Error(`amount ${p.amount} must be 0..1`);
    if (p.softness !== undefined && !(p.softness > 0)) throw new Error(`softness ${p.softness} must be positive`);
    if (p.near && !(p.near.radius > 0)) throw new Error(`near.radius ${p.near.radius} must be positive`);
    if (p.line && !(p.line.width > 0)) throw new Error(`line.width ${p.line.width} must be positive`);
    if (p.line && p.line.points.length < 2) throw new Error('line.points needs two points or more');
    if (p.pattern === undefined && p.where === undefined && p.facing === undefined && p.near === undefined && p.line === undefined) throw new Error('say where: give at least one of pattern, where, facing, near, line; `paint` is for all of a set of faces');

    const selector = p.faces ?? 'all';
    let hit = selectFaces(mesh, selector);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(selector)} matched no face`);
    if (p.near) {
        hit = reachedFaces(mesh, hit, p.near, p.mirror);
        if (hit.length === 0) throw new Error(`no surface of \`faces\` within ${p.near.radius} of ${JSON.stringify(p.near.at)}`);
    }
    const lineView = p.line?.from ? viewOf(p.line.from) : null;
    if (p.line && lineView) {
        const { points, width } = p.line;
        hit = facesInView(mesh, hit, lineView, [Math.min(...points.map((q) => q[0]!)) - width, Math.min(...points.map((q) => q[1]!)) - width], [Math.max(...points.map((q) => q[0]!)) + width, Math.max(...points.map((q) => q[1]!)) + width]);
        if (hit.length === 0) throw new Error(`no surface of \`faces\` within ${width} of the line, seen from ${p.line.from}`);
    } else if (p.line) {
        const { points, width } = p.line;
        const [lo, hi] = [[0, 1, 2].map((k) => Math.min(...points.map((q) => q[k]!))), [0, 1, 2].map((k) => Math.max(...points.map((q) => q[k]!)))];
        const around = { at: [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as unknown as Vec3, radius: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2 + width };
        hit = reachedFaces(mesh, hit, around, p.mirror);
        if (hit.length === 0) throw new Error(`no surface of \`faces\` within ${width} of the line`);
    }
    const asPattern = { ...p, pattern: p.pattern ?? 'bumps', amplitude: 1, scale: p.scale ?? 1 } as DisplaceParams;
    const longest = p.detail
        ?? (p.pattern ? Math.min(...(p.stretch ?? [1, 1, 1])) * p.scale! * finestShare(asPattern)
            // A hard edge is as clean as the faces it runs along.
            : p.near && p.hard ? p.near.radius / 8
                // A line is as fine as the faces under it, whatever those happen to be.
                : p.line ? p.line.width / 3 : null);
    const { mesh: fine, short } = longest === null ? { mesh, short: false } : refine(mesh, new Set(hit), longest, budget);

    const chosen = new Set(hit);
    const isChosen = (f: number): boolean => (fine === mesh ? chosen.has(f) : f >= mesh.faces.length - hit.length);
    const normals = new Float64Array(fine.positions.length * 3);
    for (const face of fine.faces) {
        const n = faceNormal(fine, face);
        const area = faceArea(fine, face);
        for (const v of face.v) { normals[v * 3]! += n[0] * area; normals[v * 3 + 1]! += n[1] * area; normals[v * 3 + 2]! += n[2] * area; }
    }
    for (let v = 0; v < fine.positions.length; v++) {
        const l = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!) || 1;
        normals[v * 3]! /= l; normals[v * 3 + 1]! /= l; normals[v * 3 + 2]! /= l;
    }
    const shape = p.where ? relief(fine, normals, p.reach) : null;
    let lineSeen: Float32Array | null = null;
    const drawn = p.line ? drawnLine(p.line.points, p.line.curve) : null;
    const measured = drawn && lineView ? lineMeasure(drawn) : null;
    if (p.line && lineView) {
        const vertices: number[] = [];
        fine.faces.forEach((face, f) => { if (isChosen(f)) vertices.push(...face.v); });
        lineSeen = seenFrom(fine, normals, lineView, vertices, p.line.width * 2);
    }
    const facing = p.facing ? normalize(p.facing) : null;
    const field = p.pattern ? patternField(asPattern) : null;
    const threshold = p.threshold ?? 0.5, softness = p.softness ?? 0.15;
    const amount = p.amount ?? 1;
    const color = p.color ? [p.color[0]!, p.color[1]!, p.color[2]!] as const : null;
    const defaults = surfaceDefaults ?? { roughness: 1, metallic: 0 };

    const maskAt = (v: number): number => {
        let m = 1;
        const at = fine.positions[v]!;
        const [x, y, z] = mirroredPoint(p.mirror, at);
        if (p.near) {
            const w = nearWeight(p.near, p.mirror, x, y, z);
            m *= p.hard ? (w > 0 ? 1 : 0) : w;
            if (m === 0) return 0;
        }
        if (p.line) {
            if (lineSeen && !lineSeen[v]) return 0;
            const t = 1 - (measured && lineView ? measured([at[lineView.u], at[lineView.v]], null).distance : toLine(drawn as readonly Vec3[], p.mirror, x, y, z)) / p.line.width;
            m *= t <= 0 ? 0 : p.hard ? 1 : t * t * (3 - 2 * t);
            if (lineSeen) m *= lineSeen[v]!;
            if (m === 0) return 0;
        }
        const n: Vec3 = [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!];
        if (facing) {
            m *= smooth(0.2, 0.75, n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2]);
            if (m === 0) return 0;
        }
        if (shape) {
            const sunk = p.where === 'cavity' ? shape[v]! : -shape[v]!;
            m *= smooth(threshold * 0.4 - softness, threshold * 0.4 + softness, sunk);
            if (m === 0) return 0;
        }
        if (field) {
            const value = field(x, y, z, n);
            const share = DENTS.has(p.pattern!) ? Math.max(0, -value) : value * 0.5 + 0.5;
            m *= smooth(threshold - softness, threshold + softness, share);
        }
        return m;
    };
    const masks = new Float32Array(fine.positions.length).fill(-1);
    const faces: Face[] = fine.faces.map((face, f) => {
        if (!isChosen(f)) return face;
        let sum = 0;
        for (const v of face.v) {
            if (masks[v]! < 0) masks[v] = maskAt(v);
            sum += masks[v]!;
        }
        const m = (sum / face.v.length) * amount;
        if (m <= 0) return face;
        const was = face.color ?? [1, 1, 1, 1];
        return {
            ...face,
            ...(color || p.alpha !== undefined ? {
                color: [
                    was[0] + ((color?.[0] ?? was[0]) - was[0]) * m, was[1] + ((color?.[1] ?? was[1]) - was[1]) * m, was[2] + ((color?.[2] ?? was[2]) - was[2]) * m,
                    was[3] + ((p.alpha ?? was[3]) - was[3]) * m,
                ] as const,
            } : {}),
            ...(p.roughness !== undefined ? { roughness: (face.roughness ?? defaults.roughness) + (p.roughness - (face.roughness ?? defaults.roughness)) * m } : {}),
            ...(p.metallic !== undefined ? { metallic: (face.metallic ?? defaults.metallic) + (p.metallic - (face.metallic ?? defaults.metallic)) * m } : {}),
        };
    });
    const out = compact({ positions: fine.positions, faces });
    return short ? { ...out, notes: [`this stain wants edges of ${longest!.toPrecision(3)} and stopped at ${budget} triangles, so it is coarser than asked: narrow it with \`faces\` or \`near\`, or give a larger \`detail\``] } : out;
}
