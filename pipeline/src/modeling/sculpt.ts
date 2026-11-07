// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sculpt.ts — the `sculpt` step: a surface worked by hand, stroke by stroke.
 *
 *        A pattern is good for what repeats and says nothing of where one particular fold goes: the crease
 *        from a shoulder to an elbow, the hollow of an eye. A stroke names that place. Each works on a surface already
 *        made and needs no thought of its topology: it splits the faces it reaches as far as it needs, and moves
 *        them. With `from`, places are given in the two axes of a view, so a line read off a picture can be written down.
 */
import { MAX_DISPLACE_TRIANGLES, refine } from './displace';
import { boundsOf, compact, faceArea, faceNormal, selectFaces, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';
import { facesInView, lineMeasure, seenFrom, viewOf, type View, type ViewName } from './surfaceLine';

/** A place: [x, y, z], or with `from` the two axes of the view. */
type Place = readonly number[];

export interface PressStroke {
    brush: 'press';
    /** The line of the fold. */
    points: readonly Place[];
    /** How far to either side it reaches. */
    width: number;
    /** How deep, into the surface; negative raises a ridge. */
    depth: number;
    /** Puts the weight to one side, -1..1: a fold falls away steeply on one side and slowly on the other. Positive widens the side to the left of the line's direction. */
    lean?: number;
    /** A soft swell or trough with no crease along its middle. */
    round?: boolean;
    /** The share of its length each end fades over, 0..0.5. Default 0.25; 0 for a seam, which stops dead. */
    taper?: number;
}

export interface MoveStroke {
    brush: 'move';
    at: Place;
    radius: number;
    /** Where the middle goes, the rest following by how near it is. */
    by: Vec3;
}

export interface InflateStroke {
    brush: 'inflate';
    at: Place;
    radius: number;
    /** How far out along the surface's own direction; negative hollows it: a cheek, an eye socket. */
    by: number;
}

export interface SmoothStroke {
    brush: 'smooth';
    at: Place;
    radius: number;
    /** How many times over. Default 3. */
    passes?: number;
}

export type SculptStroke = PressStroke | MoveStroke | InflateStroke | SmoothStroke;

export interface SculptParams {
    /** Only these faces move. */
    faces?: FaceSelector;
    /** The view the places are given in: "+z" is seen from +z, each place being [x, y], and a stroke lands on what that view sees. */
    from?: ViewName;
    strokes: readonly SculptStroke[];
    /** The longest edge to leave where a stroke acts. Default what its size wants. */
    detail?: number;
}

/** How far a surface has to face a view, as a cosine, before its strokes act in full. */
const RIM_FADE = 0.45;

const smooth01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function vertexNormals(mesh: PolyMesh): Float64Array {
    const normals = new Float64Array(mesh.positions.length * 3);
    for (const face of mesh.faces) {
        const n = faceNormal(mesh, face);
        const area = faceArea(mesh, face);
        for (const v of face.v) { normals[v * 3]! += n[0] * area; normals[v * 3 + 1]! += n[1] * area; normals[v * 3 + 2]! += n[2] * area; }
    }
    for (let v = 0; v < mesh.positions.length; v++) {
        const l = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!) || 1;
        normals[v * 3]! /= l; normals[v * 3 + 1]! /= l; normals[v * 3 + 2]! /= l;
    }
    return normals;
}

/** How long an edge a stroke wants, and how far it reaches past what it names. */
function needs(stroke: SculptStroke): { longest: number; reach: number; places: readonly Place[] } {
    if (stroke.brush === 'press') return { longest: stroke.width / 4, reach: stroke.width * (1 + Math.abs(stroke.lean ?? 0)), places: stroke.points };
    return { longest: stroke.radius / 6, reach: stroke.radius, places: [stroke.at] };
}

function checkStroke(stroke: SculptStroke, view: View | null): void {
    const size = view ? 2 : 3;
    const place = (p: unknown, name: string): void => {
        if (!Array.isArray(p) || p.length !== size || !p.every(Number.isFinite)) throw new Error(`${name} must be ${view ? `two numbers, as \`from\` gives the view` : '[x, y, z]'}`);
    };
    if (stroke.brush === 'press') {
        if (!(stroke.points?.length >= 2)) throw new Error('press needs `points`, two or more');
        stroke.points.forEach((p) => place(p, 'a point'));
        if (!(stroke.width > 0)) throw new Error(`width ${stroke.width} must be positive`);
        if (!Number.isFinite(stroke.depth)) throw new Error('press needs `depth`');
        if (stroke.lean !== undefined && !(Math.abs(stroke.lean) < 1)) throw new Error(`lean ${stroke.lean} must be between -1 and 1`);
        if (stroke.taper !== undefined && !(stroke.taper >= 0 && stroke.taper <= 0.5)) throw new Error(`taper ${stroke.taper} must be 0..0.5`);
        return;
    }
    if (stroke.brush !== 'move' && stroke.brush !== 'inflate' && stroke.brush !== 'smooth') throw new Error(`unknown brush ${JSON.stringify((stroke as { brush?: unknown }).brush)}; there are press, move, inflate, smooth`);
    place(stroke.at, '`at`');
    if (!(stroke.radius > 0)) throw new Error(`radius ${stroke.radius} must be positive`);
}

function applyStroke(mesh: PolyMesh, stroke: SculptStroke, selected: ReadonlySet<number>, view: View | null, detail: number | undefined, notes: string[]): PolyMesh {
    const { longest, reach, places } = needs(stroke);
    const dims = view ? 2 : 3;
    const lo = Array.from({ length: dims }, (_, k) => Math.min(...places.map((p) => p[k]!)) - reach);
    const hi = Array.from({ length: dims }, (_, k) => Math.max(...places.map((p) => p[k]!)) + reach);
    const inSelection = [...selected];
    const hit = view
        ? facesInView(mesh, inSelection, view, [lo[0]!, lo[1]!], [hi[0]!, hi[1]!])
        : inSelection.filter((f) => {
            const { min, max } = boundsOf(mesh, mesh.faces[f]!.v);
            return [0, 1, 2].every((k) => max[k as 0] >= lo[k]! && min[k as 0] <= hi[k]!);
        });
    if (hit.length === 0) throw new Error(`${stroke.brush} near ${JSON.stringify(places[0])} reaches no surface`);

    const hitSet = new Set(hit);
    // A smoothing makes nothing finer than what it is given, and has nothing to land on any finer.
    const { mesh: fine, short } = stroke.brush === 'smooth' ? { mesh, short: false } : refine(mesh, hitSet, detail ?? longest, MAX_DISPLACE_TRIANGLES);
    if (short) notes.push(`a ${stroke.brush} wanted edges of ${(detail ?? longest).toPrecision(3)} and stopped at ${MAX_DISPLACE_TRIANGLES} triangles, so it is coarser than asked`);

    // Splitting keeps the faces it left alone in their order, then those it split. A vertex a face outside the selection also uses stays put, or the surface opens.
    const held = new Uint8Array(fine.positions.length);
    const active: number[] = [];
    if (fine === mesh) {
        mesh.faces.forEach((face, f) => {
            if (hitSet.has(f)) { for (const v of face.v) active.push(v); } else if (!selected.has(f)) for (const v of face.v) held[v] = 1;
        });
    } else {
        const outside: number[] = [];
        mesh.faces.forEach((_, f) => { if (!hitSet.has(f)) outside.push(f); });
        fine.faces.forEach((face, f) => {
            if (f >= outside.length) { for (const v of face.v) active.push(v); } else if (!selected.has(outside[f]!)) for (const v of face.v) held[v] = 1;
        });
    }
    const vertices = [...new Set(active)].filter((v) => !held[v]);
    const normals = vertexNormals(fine);
    const planar = (at: Vec3): number[] => (view ? [at[view.u], at[view.v]] : [at[0], at[1], at[2]]);
    const positions: Vec3[] = [...fine.positions];

    if (stroke.brush === 'smooth') {
        const faceOf = new Set(vertices);
        const links = new Map<number, Set<number>>();
        for (const face of fine.faces) {
            for (let i = 0; i < face.v.length; i++) {
                const [a, b] = [face.v[i]!, face.v[(i + 1) % face.v.length]!];
                if (faceOf.has(a)) (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
                if (faceOf.has(b)) (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
            }
        }
        for (let pass = 0; pass < (stroke.passes ?? 3); pass++) {
            const moved = new Map<number, Vec3>();
            for (const v of vertices) {
                const at = positions[v]!;
                const w = 1 - Math.hypot(...planar(at).map((c, k) => c - stroke.at[k]!)) / stroke.radius;
                if (w <= 0) continue;
                const around = [...links.get(v)!];
                const mean = [0, 1, 2].map((k) => around.reduce((sum, n) => sum + positions[n]![k]!, 0) / around.length);
                const share = smooth01(w);
                moved.set(v, [at[0] + (mean[0]! - at[0]) * share, at[1] + (mean[1]! - at[1]) * share, at[2] + (mean[2]! - at[2]) * share]);
            }
            for (const [v, at] of moved) positions[v] = at;
        }
        return { positions, faces: fine.faces };
    }

    if (stroke.brush === 'move') {
        for (const v of vertices) {
            const at = positions[v]!;
            const w = smooth01(1 - Math.hypot(...planar(at).map((c, k) => c - stroke.at[k]!)) / stroke.radius);
            if (w > 0) positions[v] = [at[0] + stroke.by[0] * w, at[1] + stroke.by[1] * w, at[2] + stroke.by[2] * w];
        }
        return { positions, faces: fine.faces };
    }

    const seen = view ? seenFrom(fine, normals, view, vertices, Math.max(reach / 2, averageEdge(fine, vertices))) : null;
    // A view's stroke fades out as the surface turns from it. At full strength up to the rim, each vertex there is pushed sideways along a normal that swings
    // from one to the next, and the outline tears into a saw edge.
    const facing = (v: number): number => (view ? smooth01((normals[v * 3 + view.axis]! * view.sign) / RIM_FADE) : 1);
    if (stroke.brush === 'inflate') {
        for (const v of vertices) {
            if (seen && !seen[v]) continue;
            const at = positions[v]!;
            const w = smooth01(1 - Math.hypot(...planar(at).map((c, k) => c - stroke.at[k]!)) / stroke.radius) * facing(v);
            if (w > 0) {
                const push = stroke.by * w;
                positions[v] = [at[0] + normals[v * 3]! * push, at[1] + normals[v * 3 + 1]! * push, at[2] + normals[v * 3 + 2]! * push];
            }
        }
        return { positions, faces: fine.faces };
    }

    const measure = lineMeasure(stroke.points);
    const lean = stroke.lean ?? 0;
    const taper = stroke.taper ?? 0.25;
    for (const v of vertices) {
        if (seen && !seen[v]) continue;
        const at = positions[v]!;
        const n: Vec3 = [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!];
        const hitLine = measure(planar(at), n);
        const u = hitLine.distance / (stroke.width * (1 + lean * hitLine.side));
        if (u >= 1) continue;
        const fade = taper > 0 ? smooth01(hitLine.along / taper) * smooth01((1 - hitLine.along) / taper) : 1;
        if (fade <= 0) continue;
        // A crease comes to an edge along its middle, which is what catches the light; a swell does not.
        const shape = stroke.round ? (1 - u * u) ** 2 : (1 - u) ** 2;
        const push = -stroke.depth * shape * fade * facing(v);
        positions[v] = [at[0] + n[0] * push, at[1] + n[1] * push, at[2] + n[2] * push];
    }
    return { positions, faces: fine.faces };
}

function averageEdge(mesh: PolyMesh, vertices: readonly number[]): number {
    const wanted = new Set(vertices);
    let total = 0, count = 0;
    for (const face of mesh.faces) {
        if (!wanted.has(face.v[0]!)) continue;
        const [p, q] = [mesh.positions[face.v[0]!]!, mesh.positions[face.v[1]!]!];
        total += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        count++;
    }
    return count ? (total / count) * 2 : 0;
}

export function sculpt(mesh: PolyMesh, p: SculptParams): PolyMesh {
    if (!p.strokes?.length) throw new Error('`strokes` names nothing to do');
    if (p.detail !== undefined && !(p.detail > 0)) throw new Error(`detail ${p.detail} must be positive`);
    const view = p.from ? viewOf(p.from) : null;
    p.strokes.forEach((stroke, i) => {
        try { checkStroke(stroke, view); } catch (e) { throw new Error(`stroke ${i}: ${(e as Error).message}`); }
    });
    const selector = p.faces ?? 'all';
    let current = mesh;
    const notes: string[] = [];
    if (selectFaces(current, selector).length === 0) throw new Error(`\`faces\` ${JSON.stringify(selector)} matched no face`);
    p.strokes.forEach((stroke, i) => {
        // Asked again each time, as a stroke splits and reorders the faces and a selector asks by what a face is.
        const selected = new Set(selectFaces(current, selector));
        try {
            current = applyStroke(current, stroke, selected, view, p.detail, notes);
        } catch (e) {
            throw new Error(`stroke ${i}: ${(e as Error).message}`);
        }
    });
    const out = compact(current);
    return notes.length ? { ...out, notes } : out;
}
