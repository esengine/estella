// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  scatter.ts — the `scatter` step: many copies of a shape, across a surface, along a path or through a box.
 *
 *        Feathers along a limb, rivets on a plate, the lights of a far city: each is one small shape and a rule for where
 *        the rest go, where writing them out step by step would run to hundreds. The same seed lays them out the same way.
 */
import { hash3 } from './hash';
import { triangulateFace } from './triangulate';
import { freezeFaceUv } from './modelUv';
import { add, boundsOf, compact, cross, dot, faceNormal, length, normalize, scale, selectFaces, sub, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export interface ScatterParams {
    /** The shape to copy, which goes on standing as one of nothing: it is taken away unless `keep`. Its lowest point sits on the place it lands, and its +y points away. */
    source: FaceSelector;
    /** How many copies. */
    count: number;
    /** Across a surface, by area, each standing on it. */
    faces?: FaceSelector;
    /** Along a line of points, evenly with a little jitter, each pointing along it. */
    path?: readonly Vec3[];
    /** Through a box [min, max], upright. */
    within?: readonly Vec3[];
    /** Size of a copy, or [smallest, largest]. Default 1. */
    scale?: number | readonly number[];
    /** Along a `path`, the size at its end as a share of its start. Default 1. */
    taper?: number;
    /** How far each is turned about its own +y at random, in degrees. Default 180. */
    spin?: number;
    /** How far each leans off where it would point at random, in degrees. Default 0. */
    tilt?: number;
    /** Each copy takes one of these at random, in place of its own paint. */
    colors?: readonly (readonly number[])[];
    keep?: boolean;
    seed?: number;
    tag?: string;
}

const MAX_COPIES = 20000;
const unit = (a: number, b: number, seed: number): number => hash3(a, b, 37, seed) * 0.5 + 0.5;

/** Turns about an axis through the origin. */
function turned(v: Vec3, axis: Vec3, radians: number): Vec3 {
    const [c, s] = [Math.cos(radians), Math.sin(radians)];
    return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/** A frame whose +y is @p up, as the shortest turn from upright. */
function frameFor(up: Vec3): (v: Vec3) => Vec3 {
    const axis = cross([0, 1, 0], up);
    const size = length(axis);
    if (size < 1e-6) return up[1] > 0 ? (v) => v : (v) => [v[0], -v[1], -v[2]];
    const unitAxis = scale(axis, 1 / size);
    const angle = Math.atan2(size, up[1]);
    return (v) => turned(v, unitAxis, angle);
}

interface Spot { at: Vec3; up: Vec3; along: number }

function surfaceSpots(mesh: PolyMesh, picked: readonly number[], count: number, seed: number): Spot[] {
    const pieces: { a: Vec3; b: Vec3; c: Vec3; n: Vec3 }[] = [];
    const running: number[] = [];
    let total = 0;
    for (const f of picked) {
        const face = mesh.faces[f]!;
        const n = faceNormal(mesh, face);
        for (const [a, b, c] of triangulateFace(mesh, face)) {
            const [pa, pb, pc] = [mesh.positions[a]!, mesh.positions[b]!, mesh.positions[c]!];
            total += length(cross(sub(pb, pa), sub(pc, pa))) / 2;
            pieces.push({ a: pa, b: pb, c: pc, n });
            running.push(total);
        }
    }
    if (!(total > 0)) throw new Error('`faces` have no area to scatter over');
    return Array.from({ length: count }, (_, i) => {
        const wanted = unit(i, 0, seed) * total;
        let lo = 0, hi = pieces.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (running[m]! < wanted) lo = m + 1; else hi = m; }
        const p = pieces[lo]!;
        let [u, v] = [unit(i, 1, seed), unit(i, 2, seed)];
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        return { at: add(add(scale(p.a, 1 - u - v), scale(p.b, u)), scale(p.c, v)), up: p.n, along: 0 };
    });
}

function pathSpots(path: readonly Vec3[], count: number, seed: number): Spot[] {
    if (path.length < 2) throw new Error('`path` needs two points or more');
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + length(sub(path[i]!, path[i - 1]!)));
    const whole = lengths.at(-1)!;
    if (!(whole > 0)) throw new Error('`path` has no length');
    return Array.from({ length: count }, (_, i) => {
        const t = count === 1 ? 0.5 : Math.min(1, Math.max(0, (i + (unit(i, 1, seed) - 0.5) * 0.4) / (count - 1)));
        let k = 1;
        while (k < path.length - 1 && lengths[k]! < t * whole) k++;
        const span = lengths[k]! - lengths[k - 1]!;
        const w = span > 0 ? (t * whole - lengths[k - 1]!) / span : 0;
        return { at: add(scale(path[k - 1]!, 1 - w), scale(path[k]!, w)), up: normalize(sub(path[k]!, path[k - 1]!)), along: t };
    });
}

export function scatter(mesh: PolyMesh, p: ScatterParams): PolyMesh {
    if (!Number.isInteger(p.count) || p.count < 1 || p.count > MAX_COPIES) throw new Error(`count ${p.count} must be 1..${MAX_COPIES}`);
    const places = [p.faces, p.path, p.within].filter((v) => v !== undefined).length;
    if (places !== 1) throw new Error('say where they go with one of `faces`, `path` or `within`');
    const taken = selectFaces(mesh, p.source);
    if (taken.length === 0) throw new Error(`\`source\` ${JSON.stringify(p.source)} matched no face`);
    const seed = p.seed ?? 1;
    const isTaken = new Set(taken);
    const shape = taken.map((f) => freezeFaceUv(mesh, mesh.faces[f]!));
    const { min, max } = boundsOf(mesh, shape.flatMap((f) => [...f.v]));
    const foot: Vec3 = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];

    let spots: Spot[];
    if (p.faces !== undefined) {
        const picked = selectFaces(mesh, p.faces).filter((f) => !isTaken.has(f));
        if (picked.length === 0) throw new Error(`\`faces\` ${JSON.stringify(p.faces)} matched nothing but the source`);
        spots = surfaceSpots(mesh, picked, p.count, seed);
    } else if (p.path !== undefined) {
        spots = pathSpots(p.path, p.count, seed);
    } else {
        const [lo, hi] = p.within as readonly [Vec3, Vec3];
        if (!lo || !hi || p.within!.length !== 2) throw new Error('`within` must be [min, max]');
        spots = Array.from({ length: p.count }, (_, i) => ({
            at: [0, 1, 2].map((k) => lo[k]! + (hi[k]! - lo[k]!) * unit(i, 3 + k, seed)) as unknown as Vec3,
            up: [0, 1, 0] as Vec3,
            along: 0,
        }));
    }

    const [smallest, largest] = typeof p.scale === 'number' ? [p.scale, p.scale] : p.scale ? [p.scale[0] ?? 1, p.scale[1] ?? p.scale[0] ?? 1] : [1, 1];
    const spin = ((p.spin ?? 180) * Math.PI) / 180;
    const tilt = ((p.tilt ?? 0) * Math.PI) / 180;
    const keep = mesh.faces.filter((_, f) => p.keep || !isTaken.has(f));
    const positions: Vec3[] = [...mesh.positions];
    const faces: Face[] = [...keep];
    spots.forEach((spot, i) => {
        const size = (smallest + (largest - smallest) * unit(i, 6, seed)) * (1 + ((p.taper ?? 1) - 1) * spot.along);
        const lean = (unit(i, 7, seed) - 0.5) * 2 * tilt;
        const leanAbout = normalize(cross(spot.up, [unit(i, 8, seed) - 0.5, unit(i, 9, seed) - 0.5, unit(i, 10, seed) - 0.5 + 1e-3]));
        const up = lean === 0 ? spot.up : normalize(turned(spot.up, leanAbout, lean));
        const toFrame = frameFor(up);
        const about = (unit(i, 11, seed) - 0.5) * 2 * spin;
        const colour = p.colors?.length ? p.colors[Math.min(p.colors.length - 1, Math.floor(unit(i, 12, seed) * p.colors.length))] : undefined;
        const seen = new Map<number, number>();
        const place = (v: number): number => {
            const had = seen.get(v);
            if (had !== undefined) return had;
            const local = scale(sub(mesh.positions[v]!, foot), size);
            const spun: Vec3 = [local[0] * Math.cos(about) + local[2] * Math.sin(about), local[1], -local[0] * Math.sin(about) + local[2] * Math.cos(about)];
            positions.push(add(spot.at, toFrame(spun)));
            seen.set(v, positions.length - 1);
            return positions.length - 1;
        };
        for (const face of shape) {
            const copy: Face = { ...face, v: face.v.map(place) };
            delete copy.uv;
            if (p.tag) copy.tag = p.tag;
            if (colour) copy.color = [colour[0]!, colour[1]!, colour[2]!, face.color?.[3] ?? 1];
            faces.push(copy);
        }
    });
    return compact({ positions, faces });
}
