// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelBake.ts — from polygons to the `.esmesh` a scene draws, and the report
 *        that says what came out.
 *
 *        The report exists because the caller often cannot look: a model that says
 *        "2 open edges" or "this shell is inside out" gets fixed on the next call,
 *        where the same fault in a lit picture reads as a slightly odd shadow.
 */
import { MeshChannel, MeshChannelType, packChannels, unwrapLightmapUV, type MeshData } from 'esengine';
import { buildPolyMesh, validateModelSource, type ModelSource, type StepReport } from './modelSource';
import {
    boundsOf, collectEdges, cross, dot, faceArea, faceNormal, length, normalize, sub,
    type Face, type PolyMesh, type Vec3,
} from './polyMesh';

const DEFAULT_SMOOTH_ANGLE = 30;

export interface ModelReport {
    vertices: number;
    triangles: number;
    faces: number;
    /** Separate connected pieces. A building of a body and a roof that never share a vertex is two, and that is fine. */
    shells: number;
    bounds: { min: Vec3; max: Vec3; size: Vec3; center: Vec3 };
    /** How many faces carry each tag. */
    tags: Record<string, number>;
    /** Edges with one face: a hole you can see into. */
    openEdges: number;
    /** Edges with three or more faces: something a later bevel will refuse. */
    nonManifoldEdges: number;
    /** Faces with no area, which draw nothing and shade badly beside them. */
    degenerateFaces: number;
    /** Closed shells whose faces point inward, which render as their own inside. */
    insideOutShells: number;
    steps: StepReport[];
    /** The findings above that are worth stopping for, as sentences. */
    warnings: string[];
}

export interface BakedModel {
    poly: PolyMesh;
    data: MeshData;
    report: ModelReport;
    /** One triangle per entry: its three positions' indices, and the face it came from. */
    triangles: { v: [number, number, number]; face: number }[];
}

// ---- Triangulation ---------------------------------------------------------------

/** Ear clipping in the face's own plane: n-gons here can be concave (a prism's floor plan). */
function triangulateFace(mesh: PolyMesh, face: Face): [number, number, number][] {
    const count = face.v.length;
    if (count < 3) return [];
    if (count === 3) return [[face.v[0]!, face.v[1]!, face.v[2]!]];
    const n = faceNormal(mesh, face);
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] as Vec3 : [0, 1, 0] as Vec3;
    const u = normalize(cross(ref, n));
    const w = cross(n, u);
    const flat = face.v.map((i) => {
        const p = mesh.positions[i]!;
        return [dot(p, u), dot(p, w)] as const;
    });
    const area2 = (a: number, b: number, c: number): number => {
        const [ax, ay] = flat[a]!, [bx, by] = flat[b]!, [cx, cy] = flat[c]!;
        return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    };
    const span = Math.max(...flat.map((q) => Math.hypot(q[0] - flat[0]![0], q[1] - flat[0]![1])), 1e-9);
    const tiny = span * span * 1e-10;
    const out: [number, number, number][] = [];
    const loop = flat.map((_, i) => i);
    let guard = count * count + 8;
    while (loop.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[(i + loop.length - 1) % loop.length]!, b = loop[i]!, c = loop[(i + 1) % loop.length]!;
            if (area2(a, b, c) <= tiny) continue; // reflex, or a vertex lying on a straight run (kept: a neighbour may rely on it)
            let blocked = false;
            for (const q of loop) {
                if (q === a || q === b || q === c) continue;
                if (area2(a, b, q) >= -tiny && area2(b, c, q) >= -tiny && area2(c, a, q) >= -tiny) { blocked = true; break; }
            }
            if (blocked) continue;
            out.push([face.v[a]!, face.v[b]!, face.v[c]!]);
            loop.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break;
    }
    // What is left is a triangle, or a loop no ear could be cut from: a self-crossing face. Fanned, it still draws something to look at.
    for (let i = 1; i + 1 < loop.length; i++) {
        if (Math.abs(area2(loop[0]!, loop[i]!, loop[i + 1]!)) > tiny) {
            out.push([face.v[loop[0]!]!, face.v[loop[i]!]!, face.v[loop[i + 1]!]!]);
        }
    }
    return out;
}

// ---- Report -----------------------------------------------------------------------

/** Shells as lists of faces: faces sharing a vertex are one. */
function findShells(mesh: PolyMesh): number[][] {
    const parent = mesh.positions.map((_, i) => i);
    const find = (i: number): number => {
        let at = i;
        while (parent[at] !== at) { parent[at] = parent[parent[at]!]!; at = parent[at]!; }
        return at;
    };
    for (const face of mesh.faces) for (let i = 1; i < face.v.length; i++) parent[find(face.v[i]!)] = find(face.v[0]!);
    const shells = new Map<number, number[]>();
    mesh.faces.forEach((face, f) => {
        if (face.v.length === 0) return;
        const root = find(face.v[0]!);
        const at = shells.get(root);
        if (at) at.push(f); else shells.set(root, [f]);
    });
    return [...shells.values()];
}

function signedVolume(mesh: PolyMesh, faces: readonly number[], tris: readonly [number, number, number][][]): number {
    let v = 0;
    for (const f of faces) {
        for (const [a, b, c] of tris[f]!) v += dot(mesh.positions[a]!, cross(mesh.positions[b]!, mesh.positions[c]!));
    }
    return v / 6;
}

// ---- Bake -------------------------------------------------------------------------

/** Per-corner normals: each face's, averaged with those of the faces round that vertex within @p smoothAngle. */
function cornerNormals(mesh: PolyMesh, smoothAngle: number): Vec3[][] {
    const normals = mesh.faces.map((f) => faceNormal(mesh, f));
    const cosine = Math.cos((smoothAngle * Math.PI) / 180);
    const around = new Map<number, number[]>();
    mesh.faces.forEach((face, f) => {
        for (const v of face.v) {
            const at = around.get(v);
            if (at) at.push(f); else around.set(v, [f]);
        }
    });
    const areas = mesh.faces.map((f) => faceArea(mesh, f));
    return mesh.faces.map((face, f) => face.v.map((v) => {
        if (smoothAngle <= 0) return normals[f]!;
        let sum: Vec3 = [0, 0, 0];
        for (const g of around.get(v)!) {
            if (dot(normals[f]!, normals[g]!) < cosine) continue;
            const w = areas[g]!;
            sum = [sum[0] + normals[g]![0] * w, sum[1] + normals[g]![1] * w, sum[2] + normals[g]![2] * w];
        }
        return length(sum) > 0 ? normalize(sum) : normals[f]!;
    }));
}

/** A box projection, face by face: the same scale everywhere, so a tiling texture does not stretch. */
function projectUv(p: Vec3, n: Vec3, uvScale: number): [number, number] {
    const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    if (ay >= ax && ay >= az) return [p[0] / uvScale, (n[1] > 0 ? -p[2] : p[2]) / uvScale];
    if (ax >= az) return [(n[0] > 0 ? -p[2] : p[2]) / uvScale, p[1] / uvScale];
    return [(n[2] > 0 ? p[0] : -p[0]) / uvScale, p[1] / uvScale];
}

function toMeshData(mesh: PolyMesh, triangles: readonly [number, number, number][][], source: ModelSource): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const normals = cornerNormals(mesh, source.smoothAngle ?? DEFAULT_SMOOTH_ANGLE);
    const uvScale = source.uvScale ?? 1;
    const seen = new Map<string, number>();
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [];
    const indices: number[] = [];
    const vertexOf = (f: number, v: number): number => {
        const face = mesh.faces[f]!;
        const n = normals[f]![face.v.indexOf(v)]!;
        const flat = faceNormal(mesh, face);
        const p = mesh.positions[v]!;
        const [tu, tv] = projectUv(p, flat, uvScale);
        const color = (face.color ?? [1, 1, 1, 1]).map((c) => Math.round(c * 255));
        const key = `${v}|${n.map((x) => x.toFixed(4))}|${tu.toFixed(5)},${tv.toFixed(5)}|${color}`;
        let at = seen.get(key);
        if (at === undefined) {
            at = pos.length / 3;
            seen.set(key, at);
            pos.push(p[0], p[1], p[2]);
            nrm.push(n[0], n[1], n[2]);
            uv.push(tu, tv);
            col.push(...color);
        }
        return at;
    };
    triangles.forEach((tris, f) => {
        for (const [a, b, c] of tris) indices.push(vertexOf(f, a), vertexOf(f, b), vertexOf(f, c));
    });
    const vertexCount = pos.length / 3;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const offset = (semantic: number): number => channels.find((c) => c.semantic === semantic)!.offset;
    const [posAt, uvAt, colorAt, normalAt] = [
        offset(MeshChannel.Position), offset(MeshChannel.TexCoord0), offset(MeshChannel.Color), offset(MeshChannel.Normal),
    ];
    for (let i = 0; i < vertexCount; i++) {
        const at = i * vertexStride;
        for (let k = 0; k < 3; k++) {
            view.setFloat32(at + posAt + k * 4, pos[i * 3 + k]!, true);
            view.setFloat32(at + normalAt + k * 4, nrm[i * 3 + k]!, true);
        }
        view.setFloat32(at + uvAt, uv[i * 2]!, true);
        view.setFloat32(at + uvAt + 4, uv[i * 2 + 1]!, true);
        for (let k = 0; k < 4; k++) view.setUint8(at + colorAt + k, col[i * 4 + k]!);
    }
    const { min, max } = boundsOf(mesh);
    return {
        channels, vertexStride, vertexCount, vertices,
        indices: new Uint32Array(indices),
        aabbMin: [...min] as [number, number, number],
        aabbMax: [...max] as [number, number, number],
    };
}

/** Validates, builds and bakes @p raw. Throws a ModelBuildError naming the step that failed; writes nothing, so a failure leaves nothing half made. */
export function bakeModel(raw: unknown): BakedModel {
    const source = validateModelSource(raw);
    const { mesh, steps } = buildPolyMesh(source);
    if (mesh.faces.length === 0) throw new Error('the steps leave no faces; a model starts with a box, cylinder, cone, sphere, plane or prism');

    const triangles = mesh.faces.map((f) => triangulateFace(mesh, f));
    const unwrapped = unwrapLightmapUV(toMeshData(mesh, triangles, source)).mesh;

    const edges = [...collectEdges(mesh).values()];
    const openEdges = edges.filter((e) => e.faces.length === 1).length;
    const nonManifoldEdges = edges.filter((e) => e.faces.length > 2).length;
    const degenerateFaces = mesh.faces.filter((f) => faceArea(mesh, f) < 1e-10).length;
    const shells = findShells(mesh);
    const edgeFaces = new Map<number, boolean>();
    for (const e of edges) for (const f of e.faces) if (e.faces.length !== 2) edgeFaces.set(f, true);
    const insideOutShells = shells.filter((faces) =>
        faces.every((f) => !edgeFaces.has(f)) && signedVolume(mesh, faces, triangles) < 0).length;

    const { min, max } = boundsOf(mesh);
    const tags: Record<string, number> = {};
    for (const f of mesh.faces) if (f.tag) tags[f.tag] = (tags[f.tag] ?? 0) + 1;
    const triangleCount = triangles.reduce((n, t) => n + t.length, 0);

    const warnings: string[] = [];
    if (openEdges) warnings.push(`${openEdges} open edge${openEdges > 1 ? 's' : ''}: the surface has holes you can see into`);
    if (nonManifoldEdges) warnings.push(`${nonManifoldEdges} edge${nonManifoldEdges > 1 ? 's' : ''} shared by more than two faces; \`weld\` may have joined things that should stay apart`);
    if (degenerateFaces) warnings.push(`${degenerateFaces} face${degenerateFaces > 1 ? 's' : ''} with no area; \`weld\` removes them`);
    if (insideOutShells) warnings.push(`${insideOutShells} closed shell${insideOutShells > 1 ? 's are' : ' is'} inside out`);

    const roundVec = (v: readonly number[]): Vec3 => v.map((x) => Math.round(x * 1e5) / 1e5) as unknown as Vec3;
    return {
        poly: mesh,
        data: unwrapped,
        triangles: triangles.flatMap((tris, face) => tris.map((v) => ({ v, face }))),
        report: {
            vertices: unwrapped.vertexCount,
            triangles: triangleCount,
            faces: mesh.faces.length,
            shells: shells.length,
            bounds: {
                min: roundVec(min), max: roundVec(max),
                size: roundVec(sub(max, min)),
                center: roundVec([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]),
            },
            tags, openEdges, nonManifoldEdges, degenerateFaces, insideOutShells, steps, warnings,
        },
    };
}
