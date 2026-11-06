// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  subdivide.ts — Catmull-Clark: a cage of a few polygons becomes a smooth surface.
 *
 *        It acts on whole shells, because the new vertices on a shell's edges would
 *        leave cracks against any neighbour left out. `crease` keeps edges sharper
 *        than that angle hard, so a rounded body can keep a panel line.
 */
import {
    add, collectEdges, compact, dot, edgeKey, faceCenter, faceNormal, scale, selectFaces,
    type Face, type FaceSelector, type PolyMesh, type Vec3,
} from './polyMesh';
import { MAX_FACES } from './modelOps';

export interface SubdivideParams {
    faces?: FaceSelector;
    levels?: number;
    /** Degrees: edges sharper than this stay hard. Default none, everything rounds. */
    crease?: number;
}

function shellsOf(mesh: PolyMesh): number[] {
    const parent = mesh.positions.map((_, i) => i);
    const find = (i: number): number => {
        let at = i;
        while (parent[at] !== at) { parent[at] = parent[parent[at]!]!; at = parent[at]!; }
        return at;
    };
    for (const face of mesh.faces) for (let i = 1; i < face.v.length; i++) parent[find(face.v[i]!)] = find(face.v[0]!);
    return mesh.faces.map((f) => find(f.v[0]!));
}

function once(mesh: PolyMesh, chosen: ReadonlySet<number>, creaseCos: number | null): { mesh: PolyMesh; chosen: Set<number> } {
    const edges = collectEdges(mesh);
    const facePoints = new Map<number, Vec3>();
    const positions = mesh.positions.slice();
    const faceIndex = new Map<number, number>();
    for (const f of chosen) {
        const c = faceCenter(mesh, mesh.faces[f]!);
        facePoints.set(f, c);
        faceIndex.set(f, positions.length);
        positions.push(c);
    }

    // An edge is hard where it is a rim, or sharper than the crease: it then stays on its own line.
    const hard = new Set<string>();
    const edgePoint = new Map<string, number>();
    for (const [key, edge] of edges) {
        if (!edge.faces.some((f) => chosen.has(f))) continue;
        const [pa, pb] = [mesh.positions[edge.a]!, mesh.positions[edge.b]!];
        const mid = scale(add(pa, pb), 0.5);
        const sharp = edge.faces.length !== 2
            || (creaseCos !== null && dot(faceNormal(mesh, mesh.faces[edge.faces[0]!]!), faceNormal(mesh, mesh.faces[edge.faces[1]!]!)) < creaseCos);
        if (sharp) hard.add(key);
        const point = sharp ? mid : scale(add(add(pa, pb), add(facePoints.get(edge.faces[0]!)!, facePoints.get(edge.faces[1]!)!)), 0.25);
        edgePoint.set(key, positions.length);
        positions.push(point);
    }

    // Moved originals: the usual average where everything round it is smooth, along the line where it sits on one hard run, fixed at a corner.
    const facesAt = new Map<number, number[]>();
    const edgesAt = new Map<number, string[]>();
    for (const f of chosen) {
        for (const v of mesh.faces[f]!.v) {
            const at = facesAt.get(v);
            if (at) at.push(f); else facesAt.set(v, [f]);
        }
    }
    for (const [key, edge] of edges) {
        if (!edgePoint.has(key)) continue;
        for (const v of [edge.a, edge.b]) {
            const at = edgesAt.get(v);
            if (at) at.push(key); else edgesAt.set(v, [key]);
        }
    }
    for (const [v, around] of facesAt) {
        const p = mesh.positions[v]!;
        const keys = edgesAt.get(v)!;
        const hardHere = keys.filter((k) => hard.has(k));
        const midOf = (k: string): Vec3 => {
            const e = edges.get(k)!;
            return scale(add(mesh.positions[e.a]!, mesh.positions[e.b]!), 0.5);
        };
        if (hardHere.length > 2) continue;
        if (hardHere.length === 2) {
            positions[v] = add(scale(p, 0.5), scale(add(midOf(hardHere[0]!), midOf(hardHere[1]!)), 0.25));
            continue;
        }
        if (hardHere.length === 1) continue;
        const n = around.length;
        let f: Vec3 = [0, 0, 0];
        for (const g of around) f = add(f, facePoints.get(g)!);
        let r: Vec3 = [0, 0, 0];
        for (const k of keys) r = add(r, midOf(k));
        positions[v] = add(add(scale(f, 1 / (n * n)), scale(r, 2 / (n * keys.length))), scale(p, (n - 3) / n));
    }

    const faces: Face[] = [];
    const nextChosen = new Set<number>();
    mesh.faces.forEach((face, f) => {
        if (!chosen.has(f)) { faces.push(face); return; }
        face.v.forEach((v, i) => {
            const next = face.v[(i + 1) % face.v.length]!, prev = face.v[(i + face.v.length - 1) % face.v.length]!;
            nextChosen.add(faces.length);
            faces.push({ ...face, smooth: true, v: [v, edgePoint.get(edgeKey(v, next))!, faceIndex.get(f)!, edgePoint.get(edgeKey(prev, v))!] });
        });
    });
    if (faces.length > MAX_FACES) throw new Error(`this would make ${faces.length} faces; a model holds at most ${MAX_FACES}. Use fewer levels`);
    return { mesh: { positions, faces }, chosen: nextChosen };
}

export function subdivide(mesh: PolyMesh, p: SubdivideParams): PolyMesh {
    const levels = p.levels ?? 2;
    if (!Number.isInteger(levels) || levels < 1 || levels > 5) throw new Error(`levels ${levels} must be a whole number, 1..5`);
    if (p.crease !== undefined && (p.crease <= 0 || p.crease >= 180)) throw new Error(`crease ${p.crease} must be degrees, between 0 and 180`);
    const selector = p.faces ?? 'all';
    const hit = selectFaces(mesh, selector);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(selector)} matched no face`);
    const shells = shellsOf(mesh);
    const wanted = new Set(hit.map((f) => shells[f]!));
    let chosen = new Set(mesh.faces.flatMap((_, f) => (wanted.has(shells[f]!) ? [f] : [])));
    const creaseCos = p.crease === undefined ? null : Math.cos((p.crease * Math.PI) / 180);
    let out = mesh;
    for (let level = 0; level < levels; level++) ({ mesh: out, chosen } = once(out, chosen, creaseCos));
    return compact(out);
}
