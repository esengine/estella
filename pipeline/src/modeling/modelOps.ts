// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelOps.ts — what a model's steps do to its mesh.
 *
 *        Each operation takes the mesh and answers a new one, and throws a sentence
 *        when it cannot: the caller is usually a model reading the reply, so "width
 *        0.6 overruns an edge 1 long" gets the next attempt right where a clamped
 *        shape would have passed silently and looked wrong.
 */
import {
    add, boundsOf, collectEdges, compact, cross, dot, edgeKey, faceCenter, faceNormal, length, normalize, scale,
    selectEdges, selectFaces, sub,
    type EdgeSelector, type Face, type FaceSelector, type PolyMesh, type Vec3,
} from './polyMesh';

const EPS = 1e-6;
const DEG = Math.PI / 180;
/** The most faces one model may hold: past this an `array` typo is a hang, not a model. */
export const MAX_FACES = 200000;

function guardSize(faces: number): void {
    if (faces > MAX_FACES) throw new Error(`this would make ${faces} faces; a model holds at most ${MAX_FACES}`);
}

/** Selection that found nothing is a mistake worth stopping for: every step below it would be working on the wrong thing. */
function requireFaces(mesh: PolyMesh, selector: FaceSelector, name = 'faces'): number[] {
    const hit = selectFaces(mesh, selector);
    if (hit.length === 0) {
        const tags = [...new Set(mesh.faces.map((f) => f.tag))].filter(Boolean);
        throw new Error(`\`${name}\` ${JSON.stringify(selector)} matched no face. Tags here: ${tags.length ? tags.join(', ') : '(none)'}; ${mesh.faces.length} faces in all`);
    }
    return hit;
}

const usedVertices = (mesh: PolyMesh, faces: readonly number[]): Set<number> => {
    const used = new Set<number>();
    for (const f of faces) for (const v of mesh.faces[f]!.v) used.add(v);
    return used;
};

// ---- Primitives: each appends a shell, leaving what is there alone ------------

export interface Placed { at?: Vec3; tag?: string; color?: readonly number[] }

/** A colour as a face holds it. Refused rather than clamped: past 1 is a sum gone wrong. */
function toColor(c: readonly number[]): NonNullable<Face['color']> {
    if ((c.length !== 3 && c.length !== 4) || c.some((v) => v < 0 || v > 1)) {
        throw new Error(`color ${JSON.stringify(c)} must be [r, g, b] or [r, g, b, a], each 0..1 (linear)`);
    }
    return [c[0]!, c[1]!, c[2]!, c[3] ?? 1];
}

export function append(mesh: PolyMesh, positions: readonly Vec3[], loops: readonly number[][], placed: Placed): PolyMesh {
    guardSize(mesh.faces.length + loops.length);
    const base = mesh.positions.length;
    const at = placed.at ?? [0, 0, 0];
    const color = placed.color ? toColor(placed.color) : null;
    return {
        positions: [...mesh.positions, ...positions.map((p) => add(p, at))],
        faces: [...mesh.faces, ...loops.map((loop) => ({
            v: loop.map((i) => i + base), tag: placed.tag ?? '', ...(color ? { color } : {}),
        }))],
    };
}

export function box(mesh: PolyMesh, p: Placed & { size: number | Vec3 }): PolyMesh {
    const s: Vec3 = typeof p.size === 'number' ? [p.size, p.size, p.size] : p.size;
    if (s.some((v) => v <= 0)) throw new Error(`size ${JSON.stringify(p.size)} must be positive on every axis`);
    const [x, y, z] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const positions: Vec3[] = [
        [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
        [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    ];
    return append(mesh, positions, [
        [0, 1, 2, 3], [5, 4, 7, 6], [1, 5, 6, 2], [4, 0, 3, 7], [3, 2, 6, 7], [4, 5, 1, 0],
    ], p);
}

export function plane(mesh: PolyMesh, p: Placed & { size: number | readonly [number, number] }): PolyMesh {
    const s: readonly [number, number] = typeof p.size === 'number' ? [p.size, p.size] : p.size;
    if (s.some((v) => v <= 0)) throw new Error(`size ${JSON.stringify(p.size)} must be positive`);
    const [x, z] = [s[0] / 2, s[1] / 2];
    return append(mesh, [[-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z]], [[0, 1, 2, 3]], p);
}

/** A cylinder, or with `radiusTop` a tapered one. */
export function cylinder(mesh: PolyMesh, p: Placed & { radius: number; height: number; radiusTop?: number; sides?: number }): PolyMesh {
    const sides = p.sides ?? 24;
    const top = p.radiusTop ?? p.radius;
    if (sides < 3 || !Number.isInteger(sides)) throw new Error(`sides ${sides} must be a whole number of at least 3`);
    if (p.radius <= 0 || p.height <= 0 || top < 0) throw new Error('radius and height must be positive, radiusTop at least 0');
    if (top === 0) return cone(mesh, { ...p, sides });
    const h = p.height / 2;
    const positions: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const s = Math.sin(t), c = Math.cos(t);
        positions.push([s * p.radius, -h, c * p.radius], [s * top, h, c * top]);
    }
    const loops: number[][] = [];
    for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        loops.push([i * 2, j * 2, j * 2 + 1, i * 2 + 1]);
    }
    loops.push(Array.from({ length: sides }, (_, i) => i * 2 + 1));
    loops.push(Array.from({ length: sides }, (_, i) => (sides - 1 - i) * 2));
    return append(mesh, positions, loops, p);
}

export function cone(mesh: PolyMesh, p: Placed & { radius: number; height: number; sides?: number }): PolyMesh {
    const sides = p.sides ?? 24;
    if (sides < 3 || !Number.isInteger(sides)) throw new Error(`sides ${sides} must be a whole number of at least 3`);
    if (p.radius <= 0 || p.height <= 0) throw new Error('radius and height must be positive');
    const h = p.height / 2;
    const positions: Vec3[] = [[0, h, 0]];
    for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        positions.push([Math.sin(t) * p.radius, -h, Math.cos(t) * p.radius]);
    }
    const loops: number[][] = [];
    for (let i = 0; i < sides; i++) loops.push([1 + i, 1 + (i + 1) % sides, 0]);
    loops.push(Array.from({ length: sides }, (_, i) => 1 + (sides - 1 - i)));
    return append(mesh, positions, loops, p);
}

export function sphere(mesh: PolyMesh, p: Placed & { radius: number; rings?: number; sides?: number }): PolyMesh {
    const rings = p.rings ?? 12, sides = p.sides ?? 24;
    if (rings < 2 || sides < 3 || !Number.isInteger(rings) || !Number.isInteger(sides)) {
        throw new Error(`rings ${rings} must be at least 2 and sides ${sides} at least 3, both whole`);
    }
    if (p.radius <= 0) throw new Error('radius must be positive');
    const positions: Vec3[] = [[0, p.radius, 0], [0, -p.radius, 0]];
    for (let r = 1; r < rings; r++) {
        const phi = (r / rings) * Math.PI;
        for (let i = 0; i < sides; i++) {
            const t = (i / sides) * Math.PI * 2;
            positions.push([Math.sin(phi) * Math.sin(t) * p.radius, Math.cos(phi) * p.radius, Math.sin(phi) * Math.cos(t) * p.radius]);
        }
    }
    const at = (r: number, i: number): number => 2 + (r - 1) * sides + (i % sides);
    const loops: number[][] = [];
    for (let i = 0; i < sides; i++) {
        loops.push([0, at(1, i), at(1, i + 1)]);
        loops.push([1, at(rings - 1, i + 1), at(rings - 1, i)]);
        for (let r = 1; r < rings - 1; r++) loops.push([at(r, i), at(r + 1, i), at(r + 1, i + 1), at(r, i + 1)]);
    }
    return append(mesh, positions, loops, p);
}

/** A floor plan `points` ([x, z], either winding) stood up `height`: an L-shaped room, a gable end laid flat, a star. */
export function prism(mesh: PolyMesh, p: Placed & { points: readonly (readonly [number, number])[]; height: number }): PolyMesh {
    if (p.points.length < 3) throw new Error(`a prism needs at least 3 points, not ${p.points.length}`);
    if (p.height <= 0) throw new Error('height must be positive');
    // Counter-clockwise seen from above, whichever way the caller walked it; in XZ, that is a negative shoelace.
    let area = 0;
    p.points.forEach((a, i) => {
        const b = p.points[(i + 1) % p.points.length]!;
        area += a[0] * b[1] - b[0] * a[1];
    });
    if (Math.abs(area) < EPS) throw new Error('the points enclose no area');
    const pts = area > 0 ? [...p.points].reverse() : p.points;
    const n = pts.length, h = p.height / 2;
    const positions: Vec3[] = [];
    for (const q of pts) positions.push([q[0], -h, q[1]], [q[0], h, q[1]]);
    const loops: number[][] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        loops.push([i * 2, j * 2, j * 2 + 1, i * 2 + 1]);
    }
    loops.push(Array.from({ length: n }, (_, i) => i * 2 + 1));
    loops.push(Array.from({ length: n }, (_, i) => (n - 1 - i) * 2));
    return append(mesh, positions, loops, p);
}

// ---- Moving and copying --------------------------------------------------------

function rotateVector(v: Vec3, degrees: Vec3): Vec3 {
    const [cx, sx] = [Math.cos(degrees[0] * DEG), Math.sin(degrees[0] * DEG)];
    const [cy, sy] = [Math.cos(degrees[1] * DEG), Math.sin(degrees[1] * DEG)];
    const [cz, sz] = [Math.cos(degrees[2] * DEG), Math.sin(degrees[2] * DEG)];
    // X, then Y, then Z.
    const a: Vec3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
    const b: Vec3 = [cy * a[0] + sy * a[2], a[1], -sy * a[0] + cy * a[2]];
    return [cz * b[0] - sz * b[1], sz * b[0] + cz * b[1], b[2]];
}

function pivotOf(mesh: PolyMesh, vertices: Iterable<number>, pivot: 'center' | 'base' | Vec3 | undefined): Vec3 {
    if (Array.isArray(pivot)) return pivot as Vec3;
    const { min, max } = boundsOf(mesh, vertices);
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return pivot === 'base' ? [center[0], min[1], center[2]] : center;
}

/** Moves the vertices of the chosen faces: a whole shell moves, a top face scaled in makes a roof of the box under it. */
export function transform(mesh: PolyMesh, p: {
    faces?: FaceSelector; translate?: Vec3; rotate?: Vec3; scale?: number | Vec3; pivot?: 'center' | 'base' | Vec3;
}): PolyMesh {
    if (!p.translate && !p.rotate && p.scale === undefined) throw new Error('give at least one of translate, rotate, scale');
    const s: Vec3 = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale ?? [1, 1, 1];
    if (s.some((v) => v <= 0)) throw new Error(`scale ${JSON.stringify(p.scale)} must be positive; a negative one turns faces inside out, which is what \`mirror\` is for`);
    const vertices = usedVertices(mesh, requireFaces(mesh, p.faces ?? 'all'));
    const pivot = pivotOf(mesh, vertices, p.pivot);
    const positions = mesh.positions.slice();
    for (const i of vertices) {
        let q = sub(positions[i]!, pivot);
        q = [q[0] * s[0], q[1] * s[1], q[2] * s[2]];
        if (p.rotate) q = rotateVector(q, p.rotate);
        positions[i] = add(add(q, pivot), p.translate ?? [0, 0, 0]);
    }
    return { ...mesh, positions };
}

/** A copy of the chosen faces with vertices of their own, each position put through @p move. */
function cloneFaces(mesh: PolyMesh, faces: readonly number[], move: (p: Vec3) => Vec3, flip = false): { positions: Vec3[]; faces: Face[] } {
    const remap = new Map<number, number>();
    const positions: Vec3[] = [];
    const base = mesh.positions.length;
    const out = faces.map((f) => {
        const face = mesh.faces[f]!;
        const v = face.v.map((i) => {
            let to = remap.get(i);
            if (to === undefined) {
                to = base + positions.length;
                remap.set(i, to);
                positions.push(move(mesh.positions[i]!));
            }
            return to;
        });
        return { ...face, v: flip ? v.reverse() : v };
    });
    return { positions, faces: out };
}

/** `count` copies in all, the original included: a row of windows, or with `rotate` a ring of columns. */
export function array(mesh: PolyMesh, p: {
    faces?: FaceSelector; count: number; offset?: Vec3; rotate?: Vec3; pivot?: 'center' | 'base' | Vec3; tag?: string;
}): PolyMesh {
    if (!Number.isInteger(p.count) || p.count < 2) throw new Error(`count ${p.count} must be a whole number of at least 2 (it includes the original)`);
    if (!p.offset && !p.rotate) throw new Error('give offset, rotate, or both');
    const hit = requireFaces(mesh, p.faces ?? 'all');
    guardSize(mesh.faces.length + hit.length * (p.count - 1));
    const vertices = usedVertices(mesh, hit);
    const pivot = p.rotate ? pivotOf(mesh, vertices, p.pivot) : [0, 0, 0] as Vec3;
    let out = mesh;
    for (let n = 1; n < p.count; n++) {
        const step = scale(p.offset ?? [0, 0, 0], n);
        const angle: Vec3 | null = p.rotate ? [p.rotate[0] * n, p.rotate[1] * n, p.rotate[2] * n] : null;
        const copy = cloneFaces({ ...mesh, positions: out.positions }, hit, (q) => {
            const turned = angle ? add(rotateVector(sub(q, pivot), angle), pivot) : q;
            return add(turned, step);
        });
        out = {
            positions: [...out.positions, ...copy.positions],
            faces: [...out.faces, ...copy.faces.map((f) => (p.tag ? { ...f, tag: p.tag } : f))],
        };
    }
    return out;
}

/** Mirror across the plane `axis = at`, adding the reflection (or with `keep: false`, replacing the original with it). */
export function mirror(mesh: PolyMesh, p: { faces?: FaceSelector; axis: 'x' | 'y' | 'z'; at?: number; keep?: boolean; tag?: string }): PolyMesh {
    const k = { x: 0, y: 1, z: 2 }[p.axis];
    const at = p.at ?? 0;
    const hit = requireFaces(mesh, p.faces ?? 'all');
    guardSize(mesh.faces.length + hit.length);
    const copy = cloneFaces(mesh, hit, (q) => {
        const r = [q[0], q[1], q[2]] as [number, number, number];
        r[k] = 2 * at - r[k];
        return r;
    }, true);
    const gone = p.keep === false ? new Set(hit) : null;
    return compact({
        positions: [...mesh.positions, ...copy.positions],
        faces: [...mesh.faces.filter((_, i) => !gone?.has(i)), ...copy.faces.map((f) => (p.tag ? { ...f, tag: p.tag } : f))],
    });
}

// ---- Changing the surface -------------------------------------------------------

/** Each chosen face (`individual`), or each connected run of them, pushed out with walls joining it to where it was. A negative distance recesses. */
export function extrude(mesh: PolyMesh, p: {
    faces: FaceSelector; distance: number; direction?: Vec3; individual?: boolean; tag?: string; sideTag?: string;
}): PolyMesh {
    if (p.distance === 0) throw new Error('distance must not be 0');
    const hit = requireFaces(mesh, p.faces);
    const groups = p.individual ? hit.map((f) => [f]) : [hit];
    const positions = mesh.positions.slice();
    const faces = mesh.faces.slice();
    const direction = p.direction ? normalize(p.direction) : null;
    if (p.direction && length(direction!) === 0) throw new Error('direction must not be zero');

    for (const group of groups) {
        const selected = new Set(group);
        const normals = new Map<number, Vec3[]>();
        for (const f of group) {
            const n = faceNormal(mesh, mesh.faces[f]!);
            for (const v of mesh.faces[f]!.v) {
                const at = normals.get(v) ?? [];
                if (!at.some((m) => dot(m, n) > 1 - 1e-9)) at.push(n);
                normals.set(v, at);
            }
        }
        const moved = new Map<number, number>();
        for (const [v, ns] of normals) {
            let offset: Vec3;
            if (direction) offset = scale(direction, p.distance);
            else {
                const mean = normalize(ns.reduce<Vec3>((a, b) => add(a, b), [0, 0, 0]));
                // Mitred: the shifted faces stay `distance` from where they were at a corner too.
                const lean = Math.max(dot(mean, ns[0]!), 0.25);
                offset = scale(mean, p.distance / lean);
            }
            moved.set(v, positions.length);
            positions.push(add(mesh.positions[v]!, offset));
        }
        const used = new Set<string>();
        for (const f of selected) {
            for (let i = 0; i < mesh.faces[f]!.v.length; i++) {
                used.add(`${mesh.faces[f]!.v[i]}>${mesh.faces[f]!.v[(i + 1) % mesh.faces[f]!.v.length]}`);
            }
        }
        for (const f of selected) {
            const face = mesh.faces[f]!;
            for (let i = 0; i < face.v.length; i++) {
                const a = face.v[i]!, b = face.v[(i + 1) % face.v.length]!;
                if (used.has(`${b}>${a}`)) continue; // its other side moved with it: no wall here
                faces.push({ ...face, v: [a, b, moved.get(b)!, moved.get(a)!], tag: p.sideTag ?? face.tag });
            }
            faces[f] = { ...face, v: face.v.map((v) => moved.get(v)!), tag: p.tag ?? face.tag };
        }
    }
    guardSize(faces.length);
    return compact({ positions, faces });
}

/** The point in the face's plane `amountNext` inside the edge leaving along @p toNext and `amountPrev` inside the one along @p toPrev. */
function offsetCorner(corner: Vec3, normal: Vec3, toNext: Vec3, toPrev: Vec3, amountNext: number, amountPrev: number): Vec3 {
    // Inward in the plane, for a counter-clockwise loop.
    const inNext = normalize(cross(normal, toNext));
    const inPrev = normalize(cross(toPrev, normal));
    const denom = 1 - dot(inNext, inPrev) ** 2;
    if (denom < 1e-9) return add(corner, scale(inNext, amountNext));
    const d = dot(inNext, inPrev);
    const a = (amountNext - amountPrev * d) / denom;
    const b = (amountPrev - amountNext * d) / denom;
    return add(add(corner, scale(inNext, a)), scale(inPrev, b));
}

/** A smaller copy of each chosen face inside it, tagged `tag`, joined to the old outline by quads tagged as the face was. */
export function inset(mesh: PolyMesh, p: { faces: FaceSelector; amount: number; tag?: string }): PolyMesh {
    if (p.amount <= 0) throw new Error(`amount ${p.amount} must be positive`);
    const hit = requireFaces(mesh, p.faces);
    const positions = mesh.positions.slice();
    const faces = mesh.faces.slice();
    for (const f of hit) {
        const face = mesh.faces[f]!;
        const n = faceNormal(mesh, face);
        const count = face.v.length;
        const ring = face.v.map((v, i) => {
            const at = mesh.positions[v]!;
            const next = mesh.positions[face.v[(i + 1) % count]!]!;
            const prev = mesh.positions[face.v[(i + count - 1) % count]!]!;
            return offsetCorner(at, n, normalize(sub(next, at)), normalize(sub(prev, at)), p.amount, p.amount);
        });
        // Each edge of the new outline must still run the way the old one did; past the face's own width it runs backwards.
        for (let i = 0; i < count; i++) {
            const was = sub(mesh.positions[face.v[(i + 1) % count]!]!, mesh.positions[face.v[i]!]!);
            const now = sub(ring[(i + 1) % count]!, ring[i]!);
            if (dot(was, now) <= 0) {
                throw new Error(`amount ${p.amount} is more than the face at ${JSON.stringify(roundVec(faceCenter(mesh, face)))} can hold (its edge ${roundNum(length(was))} long collapses)`);
            }
        }
        const base = positions.length;
        positions.push(...ring);
        for (let i = 0; i < count; i++) {
            const j = (i + 1) % count;
            faces.push({ ...face, v: [face.v[i]!, face.v[j]!, base + j, base + i] });
        }
        faces[f] = { ...face, v: ring.map((_, i) => base + i), tag: p.tag ?? face.tag };
    }
    guardSize(faces.length);
    return { positions, faces };
}

const roundNum = (v: number): number => Math.round(v * 1000) / 1000;
const roundVec = (v: Vec3): number[] => v.map(roundNum);

/**
 * Cuts faces across planes `axis = at`, so a wall gains the seams a window is placed
 * between. Faces outside `faces` are not cut, but take the new vertex on an edge they
 * share with one that was, so no crack opens along it.
 */
export function slice(mesh: PolyMesh, p: { faces?: FaceSelector; axis: 'x' | 'y' | 'z'; at: number | readonly number[] }): PolyMesh {
    const k = { x: 0, y: 1, z: 2 }[p.axis];
    const planes = typeof p.at === 'number' ? [p.at] : p.at;
    if (planes.length === 0) throw new Error('`at` names no plane');
    let out = mesh;
    for (const at of planes) {
        let cut = false;
        const targets = new Set(requireFaces(out, p.faces ?? 'all'));
        const positions = out.positions.slice();
        const crossing = new Map<string, number>();
        const side = (v: number): number => {
            const d = positions[v]![k]! - at;
            return Math.abs(d) < EPS ? 0 : d;
        };
        for (const f of targets) {
            const face = out.faces[f]!;
            for (let i = 0; i < face.v.length; i++) {
                const a = face.v[i]!, b = face.v[(i + 1) % face.v.length]!;
                const da = side(a), db = side(b);
                if (da * db >= 0) continue;
                const key = edgeKey(a, b);
                if (crossing.has(key)) continue;
                const t = da / (da - db);
                crossing.set(key, positions.length);
                positions.push(add(positions[a]!, scale(sub(positions[b]!, positions[a]!), t)));
            }
        }
        const faces: Face[] = [];
        out.faces.forEach((face, f) => {
            const loop: number[] = [];
            for (let i = 0; i < face.v.length; i++) {
                const a = face.v[i]!, b = face.v[(i + 1) % face.v.length]!;
                loop.push(a);
                const mid = crossing.get(edgeKey(a, b));
                if (mid !== undefined) loop.push(mid);
            }
            if (!targets.has(f)) { faces.push({ ...face, v: loop }); return; }
            const on: number[] = [];
            loop.forEach((v, i) => { if (Math.abs(positions[v]![k]! - at) < EPS) on.push(i); });
            const hasBothSides = loop.some((v) => positions[v]![k]! - at > EPS) && loop.some((v) => positions[v]![k]! - at < -EPS);
            if (!hasBothSides || on.length < 2) { faces.push({ ...face, v: loop }); return; }
            if (on.length !== 2) {
                throw new Error(`plane ${p.axis} = ${at} crosses the concave face at ${JSON.stringify(roundVec(faceCenter(out, face)))} more than once; slice it somewhere it crosses once, or build it from convex parts`);
            }
            const [i, j] = on as [number, number];
            faces.push({ ...face, v: loop.slice(i, j + 1) });
            faces.push({ ...face, v: [...loop.slice(j), ...loop.slice(0, i + 1)] });
            cut = true;
        });
        if (!cut) throw new Error(`no chosen face crosses ${p.axis} = ${at}; the mesh spans ${JSON.stringify(rangeOn(out, k))} on that axis`);
        guardSize(faces.length);
        out = { positions, faces };
    }
    return out;
}

const rangeOn = (mesh: PolyMesh, k: number): number[] => {
    const { min, max } = boundsOf(mesh);
    return [roundNum(min[k]!), roundNum(max[k]!)];
};

export function deleteFaces(mesh: PolyMesh, p: { faces: FaceSelector }): PolyMesh {
    const gone = new Set(requireFaces(mesh, p.faces));
    return compact({ positions: mesh.positions, faces: mesh.faces.filter((_, i) => !gone.has(i)) });
}

/** Recolours faces: linear RGB or RGBA in 0..1, multiplied into whatever material draws the mesh. */
export function paint(mesh: PolyMesh, p: { faces: FaceSelector; color: readonly number[] }): PolyMesh {
    const color = toColor(p.color);
    const hit = new Set(requireFaces(mesh, p.faces));
    return { ...mesh, faces: mesh.faces.map((f, i) => (hit.has(i) ? { ...f, color } : f)) };
}

/** Names faces, so later steps can ask for them by what they are. */
export function tagFaces(mesh: PolyMesh, p: { faces: FaceSelector; tag: string }): PolyMesh {
    const hit = new Set(requireFaces(mesh, p.faces));
    return { ...mesh, faces: mesh.faces.map((f, i) => (hit.has(i) ? { ...f, tag: p.tag } : f)) };
}

/**
 * Merges vertices closer than `distance`, then removes what that leaves meaningless:
 * edges of no length, faces of under three corners, and pairs of faces lying back to
 * back on each other, which is the wall a mirrored half leaves down its middle.
 */
export function weld(mesh: PolyMesh, p: { distance?: number }): PolyMesh {
    const distance = p.distance ?? 1e-4;
    if (distance <= 0) throw new Error(`distance ${distance} must be positive`);
    const cell = new Map<string, number[]>();
    const parent = mesh.positions.map((_, i) => i);
    const keyOf = (q: Vec3): number[] => q.map((v) => Math.floor(v / distance));
    mesh.positions.forEach((q, i) => {
        const [x, y, z] = keyOf(q) as [number, number, number];
        for (let dx = -1; dx <= 1 && parent[i] === i; dx++) {
            for (let dy = -1; dy <= 1 && parent[i] === i; dy++) {
                for (let dz = -1; dz <= 1 && parent[i] === i; dz++) {
                    for (const j of cell.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
                        if (length(sub(q, mesh.positions[j]!)) <= distance) { parent[i] = j; break; }
                    }
                }
            }
        }
        if (parent[i] === i) {
            const key = `${x},${y},${z}`;
            const at = cell.get(key);
            if (at) at.push(i); else cell.set(key, [i]);
        }
    });
    const faces: Face[] = [];
    for (const face of mesh.faces) {
        const v: number[] = [];
        for (const i of face.v) {
            const to = parent[i]!;
            if (v[v.length - 1] !== to) v.push(to);
        }
        while (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
        if (v.length >= 3 && new Set(v).size === v.length) faces.push({ ...face, v });
    }
    // Same corners, opposite way round: neither side can ever be seen.
    const signature = (v: readonly number[]): string => [...v].sort((a, b) => a - b).join(',');
    const bySet = new Map<string, number[]>();
    faces.forEach((f, i) => {
        const key = signature(f.v);
        const at = bySet.get(key);
        if (at) at.push(i); else bySet.set(key, [i]);
    });
    const hidden = new Set<number>();
    for (const group of bySet.values()) {
        if (group.length < 2) continue;
        for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
                if (hidden.has(group[a]!) || hidden.has(group[b]!)) continue;
                if (dot(faceNormal(mesh, faces[group[a]!]!), faceNormal(mesh, faces[group[b]!]!)) < -0.99) {
                    hidden.add(group[a]!);
                    hidden.add(group[b]!);
                }
            }
        }
    }
    return compact({ positions: mesh.positions, faces: faces.filter((_, i) => !hidden.has(i)) });
}

// ---- Bevel ----------------------------------------------------------------------

/**
 * Chamfers the chosen edges flat, `width` back on each side, mitring where they meet.
 * A corner between two chosen edges moves inside its face; one beside a single chosen
 * edge slides along the other. Three or more new vertices round a vertex close with a
 * cap; two are the edge the strips share, which is the mitre.
 */
export function bevel(mesh: PolyMesh, p: { edges: EdgeSelector | 'all'; width: number; tag?: string }): PolyMesh {
    if (p.width <= 0) throw new Error(`width ${p.width} must be positive`);
    const chosen = selectEdges(mesh, p.edges === 'all' ? {} : p.edges);
    if (chosen.length === 0) throw new Error(`\`edges\` ${JSON.stringify(p.edges)} matched no edge between two faces. Open rims cannot be bevelled, and edges closer to flat than \`sharp\` (default 10 degrees) are left out`);
    const edges = collectEdges(mesh);
    for (const edge of edges.values()) {
        if (edge.faces.length > 2) throw new Error(`an edge at ${JSON.stringify(roundVec(mesh.positions[edge.a]!))} is shared by ${edge.faces.length} faces; weld or separate them first`);
    }
    const isChosen = new Set(chosen.map((e) => edgeKey(e.a, e.b)));
    const positions = mesh.positions.slice();
    const width = p.width;

    // How far each end of an edge is eaten, to refuse a bevel wider than the edge. The most any face at that end asks: two faces share it.
    const eaten = new Map<string, number>();
    const eat = (v: number, far: number, t: number): void => {
        const key = `${v}>${far}`;
        eaten.set(key, Math.max(eaten.get(key) ?? 0, t));
    };

    // A corner is (face, position in loop). What it becomes is a run of new vertices.
    const corners = new Map<string, number[]>();
    const cornerKey = (f: number, i: number): string => `${f}/${i}`;
    /** Slid vertices, by (vertex, far end of the edge slid along): both faces beside that edge land on one. */
    const slides = new Map<string, number>();

    const touched = new Set<number>();
    for (const e of chosen) { touched.add(e.a); touched.add(e.b); }

    const slideOn = (v: number, far: number, along: Vec3, across: Vec3): number => {
        const key = `${v}>${far}`;
        const known = slides.get(key);
        if (known !== undefined) return known;
        const lean = dot(along, across);
        // An edge running away from the chamfer, or nearly along it, has no distance that is `width` across: fall back on `width`.
        const t = lean > 0.05 ? width / lean : width;
        eat(v, far, t);
        const at = positions.length;
        positions.push(add(mesh.positions[v]!, scale(along, t)));
        slides.set(key, at);
        return at;
    };

    mesh.faces.forEach((face, f) => {
        const n = faceNormal(mesh, face);
        const count = face.v.length;
        face.v.forEach((v, i) => {
            if (!touched.has(v)) return;
            const next = face.v[(i + 1) % count]!, prev = face.v[(i + count - 1) % count]!;
            const nextChosen = isChosen.has(edgeKey(v, next)), prevChosen = isChosen.has(edgeKey(v, prev));
            const at = mesh.positions[v]!;
            const toNext = normalize(sub(mesh.positions[next]!, at)), toPrev = normalize(sub(mesh.positions[prev]!, at));
            const inNext = normalize(cross(n, toNext)), inPrev = normalize(cross(toPrev, n));
            let run: number[];
            if (nextChosen && prevChosen) {
                const q = offsetCorner(at, n, toNext, toPrev, width, width);
                eat(v, next, dot(sub(q, at), toNext));
                eat(v, prev, dot(sub(q, at), toPrev));
                run = [positions.length];
                positions.push(q);
            } else if (nextChosen) {
                run = [slideOn(v, prev, toPrev, inNext)];
            } else if (prevChosen) {
                run = [slideOn(v, next, toNext, inPrev)];
            } else {
                run = []; // filled in below, once every chosen-side slide along its edges exists
            }
            corners.set(cornerKey(f, i), run);
        });
    });

    // Refused before any face is built: an overrun edge is a bow-tie, and it would look like a rendering bug.
    for (const [key, t] of eaten) {
        const [a, b] = key.split('>').map(Number) as [number, number];
        const needs = t + (eaten.get(`${b}>${a}`) ?? 0);
        const long = length(sub(mesh.positions[a]!, mesh.positions[b]!));
        if (needs >= long - 1e-9) {
            throw new Error(`width ${width} overruns the edge ${roundNum(long)} long at ${JSON.stringify(roundVec(mesh.positions[a]!))}; it would need ${roundNum(needs)}`);
        }
    }

    // A corner with no chosen edge beside it, at a vertex that has one elsewhere: take the slides its two edges got, or stay put on an edge that got none.
    const stay = new Map<number, number>();
    const stayAt = (v: number): number => {
        let at = stay.get(v);
        if (at === undefined) {
            at = positions.length;
            positions.push(mesh.positions[v]!);
            stay.set(v, at);
        }
        return at;
    };
    mesh.faces.forEach((face, f) => {
        const count = face.v.length;
        face.v.forEach((v, i) => {
            if (!touched.has(v)) return;
            const key = cornerKey(f, i);
            if (corners.get(key)!.length > 0) return;
            const next = face.v[(i + 1) % count]!, prev = face.v[(i + count - 1) % count]!;
            const a = slides.get(`${v}>${prev}`) ?? stayAt(v);
            const b = slides.get(`${v}>${next}`) ?? stayAt(v);
            corners.set(key, a === b ? [a] : [a, b]);
        });
    });

    const faces: Face[] = mesh.faces.map((face, f) => ({
        ...face,
        v: face.v.flatMap((v, i) => corners.get(cornerKey(f, i)) ?? [v]),
    }));

    const tagFor = (face: Face): Pick<Face, 'tag' | 'color'> => ({
        tag: p.tag ?? face.tag, ...(face.color ? { color: face.color } : {}),
    });

    // The strip along each chosen edge, joining what the two faces now leave open beside it. A face runs
    // last(corner) -> first(next corner) where the edge was; the strip runs that the other way, so all of it agrees on outside.
    const openSide = (face: number, from: number, to: number): { a: number; b: number } | null => {
        const v = mesh.faces[face]!.v;
        for (let i = 0; i < v.length; i++) {
            const j = (i + 1) % v.length;
            if (v[i] !== from || v[j] !== to) continue;
            const runA = corners.get(cornerKey(face, i))!, runB = corners.get(cornerKey(face, j))!;
            return { a: runA[runA.length - 1]!, b: runB[0]! };
        }
        return null;
    };
    for (const edge of chosen) {
        const [f, g] = edge.faces as [number, number];
        const forward = openSide(f, edge.a, edge.b);
        const first = forward ?? openSide(f, edge.b, edge.a)!;
        const second = forward ? openSide(g, edge.b, edge.a) : openSide(g, edge.a, edge.b);
        if (!second) {
            throw new Error(`the faces either side of the edge at ${JSON.stringify(roundVec(mesh.positions[edge.a]!))} are wound opposite ways, so one is inside out`);
        }
        const loop = [first.b, first.a, second.b, second.a].filter((q, i, all) => q !== all[(i + 1) % all.length]);
        if (loop.length >= 3) faces.push({ v: loop, ...tagFor(mesh.faces[f]!) });
    }

    // Round each vertex the strips leave a hole, which three or more new vertices make a face of. The walk
    // goes clockwise seen from outside, and a run is in its face's order, which is the same way: the cap is that loop reversed.
    for (const v of touched) {
        const around = faceFan(mesh, v);
        if (!around) continue; // on an open rim there is no hole to close
        const loop: number[] = [];
        for (const { face, index } of around) {
            for (const q of corners.get(cornerKey(face, index))!) {
                if (loop[loop.length - 1] !== q) loop.push(q);
            }
        }
        while (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
        if (loop.length >= 3) faces.push({ v: loop.reverse(), ...tagFor(mesh.faces[around[0]!.face]!) });
    }

    guardSize(faces.length);
    return compact({ positions, faces });
}

/** The faces round a vertex in order, or null when they do not close round it. */
function faceFan(mesh: PolyMesh, v: number): { face: number; index: number }[] | null {
    const byIncoming = new Map<number, { face: number; index: number }>();
    let total = 0;
    mesh.faces.forEach((face, f) => {
        const i = face.v.indexOf(v);
        if (i < 0) return;
        // A corner's face arrives along prev -> v, and leaves along v -> next. The face round the corner uses next -> v.
        byIncoming.set(face.v[(i + face.v.length - 1) % face.v.length]!, { face: f, index: i });
        total++;
    });
    if (total === 0) return null;
    const out: { face: number; index: number }[] = [];
    let at = byIncoming.values().next().value!;
    for (let n = 0; n < total; n++) {
        out.push(at);
        const face = mesh.faces[at.face]!;
        const next = face.v[(at.index + 1) % face.v.length]!;
        const round = byIncoming.get(next);
        if (!round) return null;
        at = round;
    }
    return at === out[0] ? out : null;
}

