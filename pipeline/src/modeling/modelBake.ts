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
import { MeshChannel, MeshChannelType, packChannels, unwrapLightmapUV, type MeshData, type MeshMorphTargets } from 'esengine';
import { generateTangents } from '../assets/meshTangents';
import { triangulateFace } from './triangulate';
import { faceUvs } from './modelUv';
import { adjustWeights, bindMatrices, computeWeights, resolveJoints, shapeDeltas, type ControllerIk, type RigGoal, type RigJoint, type SkinWeights } from './rig';
import type { NormalBakeReport } from './normalBake';
import { buildPolyMesh, validateModelSource, type ModelSource, type StepReport } from './modelSource';
import {
    boundsOf, collectEdges, cross, dot, faceArea, faceNormal, length, normalize, sub,
    type PolyMesh, type Vec3,
} from './polyMesh';

const DEFAULT_SMOOTH_ANGLE = 30;
const DEFAULT_NORMAL_SIZE = 1024;
const HEAVY_TRIANGLES = 300000;
const LIGHTMAP_TRIANGLES = 150000;

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
    /** Edges whose two faces run it the same way: one of them faces the wrong way, whatever the rest of the shell does. */
    flippedEdges: number;
    /** Closed shells whose faces point inward, which render as their own inside. */
    insideOutShells: number;
    steps: StepReport[];
    /** For a rigged model: each joint, and how many vertices it moves the most. */
    joints?: Record<string, number>;
    /** What a normal map carries, once one has been baked. */
    normalBake?: NormalBakeReport;
    /** The findings above that are worth stopping for, as sentences. */
    warnings: string[];
}

export interface BakedModel {
    poly: PolyMesh;
    data: MeshData;
    report: ModelReport;
    /** Present on a rigged model. */
    rig?: { joints: RigJoint[]; skin: SkinWeights; ik?: readonly ControllerIk[]; goals?: readonly RigGoal[] };
    /** Present where a source has shapes: three offsets per surface vertex, for each. */
    shapes?: { names: string[]; deltas: Float32Array[] };
    /** One triangle per entry: its three positions' indices, and the face it came from. */
    triangles: { v: [number, number, number]; face: number }[];
    /** Present where a source has a normalBake: what bakeNormalMap carries, onto a mesh already unwrapped and given tangents for it. */
    detail?: { high: PolyMesh; size: number; distance?: number; smoothAngle: number };
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
export function cornerNormals(mesh: PolyMesh, smoothAngle: number): Vec3[][] {
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
        if (smoothAngle <= 0 && !face.smooth) return normals[f]!;
        let sum: Vec3 = [0, 0, 0];
        for (const g of around.get(v)!) {
            const skin = face.smooth && mesh.faces[g]!.smooth;
            if (!skin && dot(normals[f]!, normals[g]!) < cosine) continue;
            const w = areas[g]!;
            sum = [sum[0] + normals[g]![0] * w, sum[1] + normals[g]![1] * w, sum[2] + normals[g]![2] * w];
        }
        return length(sum) > 0 ? normalize(sum) : normals[f]!;
    }));
}

function toMeshData(mesh: PolyMesh, triangles: readonly [number, number, number][][], source: ModelSource, rig?: BakedModel['rig'], shapes?: BakedModel['shapes']): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
        ...(rig ? [
            { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16 },
            { semantic: MeshChannel.Weights, components: 4, type: MeshChannelType.Float32 },
        ] : []),
    ]);
    const normals = cornerNormals(mesh, source.smoothAngle ?? DEFAULT_SMOOTH_ANGLE);
    const uvScale = source.uvScale ?? 1;
    const seen = new Map<string, number>();
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], source_: number[] = [], cornerOf: [number, number][] = [];
    const indices: number[] = [];
    const uvs = new Map<number, Map<number, readonly [number, number]>>();
    const vertexOf = (f: number, v: number): number => {
        const face = mesh.faces[f]!;
        const n = normals[f]![face.v.indexOf(v)]!;
        const p = mesh.positions[v]!;
        let corners = uvs.get(f);
        if (!corners) { corners = faceUvs(mesh, face, uvScale); uvs.set(f, corners); }
        const [tu, tv] = corners.get(v)!;
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
            source_.push(v);
            cornerOf.push([f, face.v.indexOf(v)]);
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
        if (rig) {
            const from = source_[i]! * 4;
            const [jointAt, weightAt] = [offset(MeshChannel.Joints), offset(MeshChannel.Weights)];
            for (let k = 0; k < 4; k++) {
                view.setUint16(at + jointAt + k * 2, rig.skin.joints[from + k]!, true);
                view.setFloat32(at + weightAt + k * 4, rig.skin.weights[from + k]!, true);
            }
        }
    }
    const { min, max } = boundsOf(mesh);
    return {
        channels, vertexStride, vertexCount, vertices,
        indices: new Uint32Array(indices),
        aabbMin: [...min] as [number, number, number],
        aabbMax: [...max] as [number, number, number],
        ...(rig ? { inverseBindMatrices: bindMatrices(rig.joints) } : {}),
        ...(shapes ? { morph: morphOf(mesh, shapes, source_, cornerOf, normals, source.smoothAngle ?? DEFAULT_SMOOTH_ANGLE) } : {}),
    };
}

/** Offsets for the baked vertices: positions from the surface's, normals from what the surface's corners become in that shape. */
function morphOf(mesh: PolyMesh, shapes: NonNullable<BakedModel['shapes']>, sourceOf: readonly number[], cornerOf: readonly [number, number][], rest: Vec3[][], smoothAngle: number): MeshMorphTargets {
    const count = sourceOf.length;
    const deltas = new Float32Array(shapes.names.length * count * 6);
    shapes.deltas.forEach((d, s) => {
        const moved: PolyMesh = { ...mesh, positions: mesh.positions.map((p, v) => [p[0] + d[v * 3]!, p[1] + d[v * 3 + 1]!, p[2] + d[v * 3 + 2]!]) };
        const normals = cornerNormals(moved, smoothAngle);
        for (let i = 0; i < count; i++) {
            const at = (s * count + i) * 6;
            const v = sourceOf[i]!;
            const [f, c] = cornerOf[i]!;
            for (let k = 0; k < 3; k++) {
                deltas[at + k] = d[v * 3 + k]!;
                deltas[at + 3 + k] = normals[f]![c]![k]! - rest[f]![c]![k]!;
            }
        }
    });
    return { names: shapes.names, hasNormals: true, deltas };
}

/** Gives the base UV the unwrap's: no two triangles share texels, so a texture can be painted for this one model. */
function copyLightmapUvToBase(mesh: MeshData): void {
    const from = mesh.channels.find((c) => c.semantic === MeshChannel.TexCoord1)!.offset;
    const to = mesh.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!.offset;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    for (let i = 0; i < mesh.vertexCount; i++) {
        const at = i * mesh.vertexStride;
        view.setFloat32(at + to, view.getFloat32(at + from, true), true);
        view.setFloat32(at + to + 4, view.getFloat32(at + from + 4, true), true);
    }
}

/** The mesh with the frame a normal map is read in, from the UVs and normals as stored. */
function withTangents(mesh: MeshData): MeshData {
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const read = (semantic: number, components: number): Float32Array => {
        const { offset } = mesh.channels.find((c) => c.semantic === semantic)!;
        const out = new Float32Array(mesh.vertexCount * components);
        for (let v = 0; v < mesh.vertexCount; v++) for (let k = 0; k < components; k++) out[v * components + k] = view.getFloat32(v * mesh.vertexStride + offset + k * 4, true);
        return out;
    };
    const tangents = generateTangents(read(MeshChannel.Position, 3), read(MeshChannel.Normal, 3), read(MeshChannel.TexCoord0, 2), mesh.indices);
    const stride = mesh.vertexStride + 16;
    const vertices = new Uint8Array(mesh.vertexCount * stride);
    const out = new DataView(vertices.buffer);
    for (let v = 0; v < mesh.vertexCount; v++) {
        vertices.set(mesh.vertices.subarray(v * mesh.vertexStride, (v + 1) * mesh.vertexStride), v * stride);
        for (let k = 0; k < 4; k++) out.setFloat32(v * stride + mesh.vertexStride + k * 4, tangents[v * 4 + k]!, true);
    }
    return {
        ...mesh, vertices, vertexStride: stride,
        channels: [...mesh.channels, { semantic: MeshChannel.Tangent, components: 4, type: MeshChannelType.Float32, offset: mesh.vertexStride }],
    };
}

/** Validates, builds and bakes @p raw. Throws a ModelBuildError naming the step that failed; writes nothing, so a failure leaves nothing half made. */
export function bakeModel(raw: unknown): BakedModel {
    const source = validateModelSource(raw);
    const { mesh, steps, high, notes } = buildPolyMesh(source);
    if (mesh.faces.length === 0) throw new Error('the steps leave no faces; a model starts with a box, cylinder, cone, sphere, plane or prism');

    const triangles = mesh.faces.map((f) => triangulateFace(mesh, f));
    let rig: BakedModel['rig'];
    if (source.rig) {
        const joints = resolveJoints(source.rig);
        rig = { joints, skin: adjustWeights(mesh, joints, computeWeights(mesh, joints), source.rig.adjust ?? []), ik: source.controller?.ik ?? [], goals: source.rig.goals ?? [] };
    }
    const shapes = source.shapes ? { names: source.shapes.map((s) => s.name), deltas: source.shapes.map((s) => shapeDeltas(mesh, s)) } : undefined;
    const bake = source.normalBake;
    const size = bake?.size ?? DEFAULT_NORMAL_SIZE;
    // A mesh that moves takes no lightmap: a bake holds still. A normal map moves with it, and needs texels of its own all the same.
    const baked = toMeshData(mesh, triangles, source, rig, shapes);
    const triangleCount = triangles.reduce((n, t) => n + t.length, 0);
    let layoutNote: string | null = null;
    let unwrapped = baked;
    if (bake || source.uvAtlas) {
        try {
            unwrapped = unwrapLightmapUV(baked, bake ? { atlasSize: size, paddingTexels: 4 } : {}).mesh;
        } catch {
            throw new Error(`${triangleCount} triangles break into too many pieces to lay out in one texture: decimate further, or give the surface less to carve before it`);
        }
        copyLightmapUvToBase(unwrapped);
    } else if (!rig && !shapes) {
        // This is optional, and costs minutes past a point where nobody would bake light onto the model anyway. Nothing else needs it.
        layoutNote = 'it has no lightmap UV: baked light will not land on it, and is not worth it at this density';
        if (triangleCount <= LIGHTMAP_TRIANGLES) {
            try {
                unwrapped = unwrapLightmapUV(baked).mesh;
                layoutNote = null;
            } catch {
                layoutNote = 'it has no lightmap UV: its surface breaks into too many pieces to lay out';
            }
        }
    }
    if (bake) unwrapped = withTangents(unwrapped);

    const edges = [...collectEdges(mesh).values()];
    const openEdges = edges.filter((e) => e.faces.length === 1).length;
    const nonManifoldEdges = edges.filter((e) => e.faces.length > 2).length;
    const degenerateFaces = mesh.faces.filter((f) => faceArea(mesh, f) < 1e-10).length;
    let flippedEdges = 0;
    for (const e of edges) {
        if (e.faces.length !== 2) continue;
        const runs = (f: number): boolean => {
            const v = mesh.faces[f]!.v;
            return v.some((a, i) => a === e.a && v[(i + 1) % v.length] === e.b);
        };
        if (runs(e.faces[0]!) === runs(e.faces[1]!)) flippedEdges++;
    }
    const shells = findShells(mesh);
    const edgeFaces = new Map<number, boolean>();
    for (const e of edges) for (const f of e.faces) if (e.faces.length !== 2) edgeFaces.set(f, true);
    const insideOutShells = shells.filter((faces) =>
        faces.every((f) => !edgeFaces.has(f)) && signedVolume(mesh, faces, triangles) < 0).length;

    const { min, max } = boundsOf(mesh);
    const tags: Record<string, number> = {};
    for (const f of mesh.faces) if (f.tag) tags[f.tag] = (tags[f.tag] ?? 0) + 1;

    const warnings: string[] = [...notes, ...(layoutNote ? [layoutNote] : [])];
    if (triangleCount > HEAVY_TRIANGLES) warnings.push(`${triangleCount} triangles is a lot to draw: end with a \`decimate\`, and \`normalBake\` to keep the detail`);
    if (openEdges) warnings.push(`${openEdges} open edge${openEdges > 1 ? 's' : ''}: the surface has holes you can see into`);
    if (nonManifoldEdges) warnings.push(`${nonManifoldEdges} edge${nonManifoldEdges > 1 ? 's' : ''} shared by more than two faces, which a later bevel refuses: \`weld\` may have joined things that should stay apart, or on an organic skin two parts just touch, so overlap them or raise blend`);
    if (flippedEdges) warnings.push(`${flippedEdges} edge${flippedEdges > 1 ? 's' : ''} between faces wound opposite ways: part of the surface faces inward`);
    if (degenerateFaces) warnings.push(`${degenerateFaces} face${degenerateFaces > 1 ? 's' : ''} with no area; \`weld\` removes them`);
    if (insideOutShells) warnings.push(`${insideOutShells} closed shell${insideOutShells > 1 ? 's are' : ' is'} inside out`);

    const jointReport = rig ? Object.fromEntries(rig.joints.map((j, i) => [j.name, rig!.skin.dominant[i]!])) : undefined;
    if (rig) {
        // A tip often moves nothing: it marks where the last bone ends.
        const idle = rig.joints.filter((j, i) => j.children.length > 0 && rig!.skin.dominant[i] === 0).map((j) => j.name);
        if (idle.length) warnings.push(`joint${idle.length > 1 ? 's' : ''} ${idle.join(', ')} move${idle.length > 1 ? '' : 's'} no vertex the most: too near another, or outside the surface`);
    }

    // The engine's delta texture is 2048 square, the most WebGL2 guarantees; past it the mesh draws, but never changes shape.
    for (const s of steps) {
        const step = source.steps[s.index]!;
        if (s.op !== 'decimate' || step.faces !== undefined) continue;
        const target = (step.triangles as number | undefined) ?? Math.round(s.trianglesBefore! * (step.ratio as number));
        if (s.trianglesAfter! > target * 1.1) warnings.push(`step ${s.index} (decimate) stopped at ${s.trianglesAfter} triangles of the ${target} asked: the surface would have moved more than \`error\` allows. Raise it to go further`);
    }

    if (shapes && shapes.names.length * unwrapped.vertexCount * 2 > 2048 * 2048) {
        warnings.push(`${shapes.names.length} shapes over ${unwrapped.vertexCount} vertices is more than the engine holds (${2048 * 2048} deltas, two each): it would draw but never change shape. Lower the resolution or use fewer shapes`);
    }

    const roundVec = (v: readonly number[]): Vec3 => v.map((x) => Math.round(x * 1e5) / 1e5) as unknown as Vec3;
    return {
        poly: mesh,
        data: unwrapped,
        ...(rig ? { rig } : {}),
        ...(shapes ? { shapes } : {}),
        ...(bake && high ? { detail: { high, size, ...(bake.distance !== undefined ? { distance: bake.distance } : {}), smoothAngle: source.smoothAngle ?? DEFAULT_SMOOTH_ANGLE } } : {}),
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
            tags, openEdges, nonManifoldEdges, flippedEdges, degenerateFaces, insideOutShells, steps, ...(jointReport ? { joints: jointReport } : {}), warnings,
        },
    };
}
