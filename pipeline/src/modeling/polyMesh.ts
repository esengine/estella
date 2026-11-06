// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  polyMesh.ts — the polygon mesh a model's steps work on, and the vector
 *        arithmetic and selection they share.
 *
 *        Faces stay n-gons until the bake: an extrude's walls and a sliced wall are
 *        one polygon each, so a selector asks about the faces a person would name.
 *        Vertices are shared between faces, which is what makes an edge something
 *        two faces agree on (a bevel needs that; a triangle soup cannot say it).
 */

export type Vec3 = readonly [number, number, number];

export interface Face {
    /** Vertex indices, counter-clockwise seen from outside. */
    v: number[];
    tag: string;
    /** Linear RGBA, as MeshRenderer.color is; absent draws white. */
    color?: readonly [number, number, number, number];
    /** Part of a continuous skin: shaded smooth with its neighbours whatever the angle, and its edges are not features. */
    smooth?: boolean;
    /** How this face takes its texture, from a `uv` step; absent, a box projection at the source's uvScale. */
    uv?: FaceUv;
}

export interface FaceUv {
    mode: 'box' | 'planar' | 'cylinder' | 'sphere';
    /** planar: the way it faces. cylinder: the axis it wraps. */
    axis?: string;
    center: Vec3;
    /** What the curved modes stretch over: a cylinder's length along its axis. */
    extent: number;
    /** box, planar: world units one repeat covers. */
    scale: readonly [number, number];
    /** cylinder, sphere: repeats around and along. */
    repeat: readonly [number, number];
    offset: readonly [number, number];
    rotate: number;
}

export interface PolyMesh {
    positions: Vec3[];
    faces: Face[];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
    const l = length(a);
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Newell's normal, length twice the polygon's area: holds for a concave or slightly non-planar loop. */
function areaVector(mesh: PolyMesh, face: Face): Vec3 {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < face.v.length; i++) {
        const a = mesh.positions[face.v[i]!]!;
        const b = mesh.positions[face.v[(i + 1) % face.v.length]!]!;
        x += (a[1] - b[1]) * (a[2] + b[2]);
        y += (a[2] - b[2]) * (a[0] + b[0]);
        z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [x, y, z];
}

export const faceNormal = (mesh: PolyMesh, face: Face): Vec3 => normalize(areaVector(mesh, face));
export const faceArea = (mesh: PolyMesh, face: Face): number => length(areaVector(mesh, face)) / 2;

export function faceCenter(mesh: PolyMesh, face: Face): Vec3 {
    let c: Vec3 = [0, 0, 0];
    for (const i of face.v) c = add(c, mesh.positions[i]!);
    return scale(c, 1 / face.v.length);
}

export const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export interface Edge {
    a: number;
    b: number;
    /** Faces using it. Two on a closed surface, one on an open rim. */
    faces: number[];
}

export function collectEdges(mesh: PolyMesh): Map<string, Edge> {
    const edges = new Map<string, Edge>();
    mesh.faces.forEach((face, fi) => {
        for (let i = 0; i < face.v.length; i++) {
            const a = face.v[i]!, b = face.v[(i + 1) % face.v.length]!;
            const key = edgeKey(a, b);
            const edge = edges.get(key);
            if (edge) edge.faces.push(fi);
            else edges.set(key, { a, b, faces: [fi] });
        }
    });
    return edges;
}

/** Drops vertices no face uses, keeping every face's indices right. */
export function compact(mesh: PolyMesh): PolyMesh {
    const remap = new Map<number, number>();
    const positions: Vec3[] = [];
    const faces = mesh.faces.map((face) => ({
        ...face,
        v: face.v.map((i) => {
            let to = remap.get(i);
            if (to === undefined) {
                to = positions.length;
                remap.set(i, to);
                positions.push(mesh.positions[i]!);
            }
            return to;
        }),
    }));
    return { positions, faces };
}

/** The bounds of @p indices, or of every vertex. */
export function boundsOf(mesh: PolyMesh, indices?: Iterable<number>): { min: Vec3; max: Vec3 } {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const visit = (p: Vec3): void => {
        for (let k = 0; k < 3; k++) {
            if (p[k]! < min[k]!) min[k] = p[k]!;
            if (p[k]! > max[k]!) max[k] = p[k]!;
        }
    };
    if (indices) for (const i of indices) visit(mesh.positions[i]!);
    else mesh.positions.forEach(visit);
    return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

// ---- Selection ----------------------------------------------------------------

/** A box any axis of which may be left open with null. */
export interface SelectBox {
    min?: readonly (number | null)[];
    max?: readonly (number | null)[];
}

export type AxisName = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/**
 * Which faces a step acts on. Faces are asked for by what they ARE, never by index:
 * an index is the one thing a parameter edit further up changes under the steps below it.
 *
 * A string is `"all"`, an axis (`"+y"`: facing up) or a tag. In an object every key
 * present must hold.
 */
export type FaceSelector = string | {
    tag?: string | string[];
    /** Facing this axis or direction, within `tolerance` degrees (default 5). */
    facing?: AxisName | readonly [number, number, number];
    tolerance?: number;
    /** Centre inside this box. */
    within?: SelectBox;
    /** Of the faces the other keys let through, those furthest along this axis. */
    extreme?: AxisName;
    any?: FaceSelector[];
    not?: FaceSelector;
};

const AXES: Record<AxisName, Vec3> = {
    '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
};

export const isAxisName = (s: string): s is AxisName => s in AXES;
export const axisVector = (a: AxisName): Vec3 => AXES[a];

const inBox = (p: Vec3, box: SelectBox): boolean => {
    for (let k = 0; k < 3; k++) {
        const lo = box.min?.[k], hi = box.max?.[k];
        // A hair of slack: a face exactly on the box's wall is inside it, whatever the arithmetic that put it there.
        if (lo !== null && lo !== undefined && p[k]! < lo - 1e-6) return false;
        if (hi !== null && hi !== undefined && p[k]! > hi + 1e-6) return false;
    }
    return true;
};

/** Indices of the faces @p selector names. */
export function selectFaces(mesh: PolyMesh, selector: FaceSelector): number[] {
    if (typeof selector === 'string') {
        if (selector === 'all') return mesh.faces.map((_, i) => i);
        if (isAxisName(selector)) return selectFaces(mesh, { facing: selector });
        return selectFaces(mesh, { tag: selector });
    }
    const tags = selector.tag === undefined ? null : new Set([selector.tag].flat());
    const facing = selector.facing === undefined ? null
        : typeof selector.facing === 'string' ? AXES[selector.facing] : normalize(selector.facing);
    const cosine = Math.cos(((selector.tolerance ?? 5) * Math.PI) / 180);
    const any = selector.any?.map((s) => new Set(selectFaces(mesh, s)));
    const not = selector.not === undefined ? null : new Set(selectFaces(mesh, selector.not));

    let out: number[] = [];
    mesh.faces.forEach((face, i) => {
        if (tags && !tags.has(face.tag)) return;
        if (facing && dot(faceNormal(mesh, face), facing) < cosine) return;
        if (selector.within && !inBox(faceCenter(mesh, face), selector.within)) return;
        if (any && !any.some((set) => set.has(i))) return;
        if (not?.has(i)) return;
        out.push(i);
    });
    if (selector.extreme) {
        const axis = AXES[selector.extreme];
        const along = out.map((i) => dot(faceCenter(mesh, mesh.faces[i]!), axis));
        const top = Math.max(...along);
        out = out.filter((_, n) => along[n]! >= top - 1e-6);
    }
    return out;
}

/**
 * Which edges a bevel rounds off. Every key present must hold, and an edge between
 * two faces closer to flat than `sharp` degrees (default 10) is never one: it is the
 * seam a slice left across a wall, and nobody asking for "the top's edges" meant it.
 */
export interface EdgeSelector {
    /** Edges of these faces. */
    of?: FaceSelector;
    /** Edges with one of the first faces on one side and one of the second on the other. */
    between?: [FaceSelector, FaceSelector];
    /** Running along this axis. */
    along?: 'x' | 'y' | 'z';
    /** Both ends inside this box. */
    within?: SelectBox;
    sharp?: number;
}

const ALONG: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** The closed edges @p selector names, as their keys. */
export function selectEdges(mesh: PolyMesh, selector: EdgeSelector): Edge[] {
    const edges = collectEdges(mesh);
    const of = selector.of === undefined ? null : new Set(selectFaces(mesh, selector.of));
    const a = selector.between ? new Set(selectFaces(mesh, selector.between[0])) : null;
    const b = selector.between ? new Set(selectFaces(mesh, selector.between[1])) : null;
    const sharp = Math.cos(((selector.sharp ?? 10) * Math.PI) / 180);

    const out: Edge[] = [];
    for (const edge of edges.values()) {
        if (edge.faces.length !== 2) continue;
        const [f, g] = edge.faces as [number, number];
        if (dot(faceNormal(mesh, mesh.faces[f]!), faceNormal(mesh, mesh.faces[g]!)) > sharp) continue;
        if (of && !of.has(f) && !of.has(g)) continue;
        if (a && b && !((a.has(f) && b.has(g)) || (a.has(g) && b.has(f)))) continue;
        const pa = mesh.positions[edge.a]!, pb = mesh.positions[edge.b]!;
        if (selector.along && Math.abs(dot(normalize(sub(pb, pa)), ALONG[selector.along])) < 0.999) continue;
        if (selector.within && !(inBox(pa, selector.within) && inBox(pb, selector.within))) continue;
        out.push(edge);
    }
    return out;
}
