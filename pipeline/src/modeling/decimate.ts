// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  decimate.ts — the `decimate` step: fewer triangles over the same surface.
 *
 *        The collapse is meshoptimizer's quadric-error simplifier, as a mesh import's LOD
 *        levels use. What is here is what it is told about a vertex and what the result is
 *        made of: surviving vertices keep their places, so every triangle out is three
 *        corners of the mesh that went in, and takes its paint, tag and shading from the
 *        faces those corners were on. It needs MeshoptSimplifier.ready; prepareModeling
 *        waits for that.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { triangulateFace } from './triangulate';
import { compact, cross, dot, faceArea, faceNormal, normalize, selectFaces, sub, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export interface DecimateParams {
    faces?: FaceSelector;
    /** Share of the triangles to keep, in (0, 1]. */
    ratio?: number;
    /** Triangles to end with, instead of a share. */
    triangles?: number;
    /** The most the surface may move, as a share of the mesh's size. It wins over the two above. */
    error?: number;
}

const DEFAULT_ERROR = 0.02;
/** A shading normal bends light and may give a little; a change of paint is a line someone drew. */
const NORMAL_WEIGHT = 0.5;
const COLOR_WEIGHT = 1;
const ATTRIBUTES = 6;

export const triangleCount = (mesh: PolyMesh): number => mesh.faces.reduce((n, f) => n + Math.max(0, f.v.length - 2), 0);

/** Each vertex's normal and paint over @p faces: what a collapse must not smear. */
function vertexAttributes(mesh: PolyMesh, faces: readonly Face[]): Float32Array {
    const out = new Float32Array(mesh.positions.length * ATTRIBUTES);
    const paints = new Uint32Array(mesh.positions.length);
    for (const face of faces) {
        const n = faceNormal(mesh, face);
        const area = faceArea(mesh, face);
        const color = face.color ?? [1, 1, 1, 1];
        for (const v of face.v) {
            for (let k = 0; k < 3; k++) {
                out[v * ATTRIBUTES + k]! += n[k]! * area;
                out[v * ATTRIBUTES + 3 + k]! += color[k]!;
            }
            paints[v]!++;
        }
    }
    for (let v = 0; v < paints.length; v++) {
        if (paints[v] === 0) continue;
        const n = normalize([out[v * ATTRIBUTES]!, out[v * ATTRIBUTES + 1]!, out[v * ATTRIBUTES + 2]!]);
        for (let k = 0; k < 3; k++) {
            out[v * ATTRIBUTES + k] = n[k]!;
            out[v * ATTRIBUTES + 3 + k]! /= paints[v]!;
        }
    }
    return out;
}

export function decimate(mesh: PolyMesh, p: DecimateParams): PolyMesh {
    if ((p.ratio === undefined) === (p.triangles === undefined)) throw new Error('give one of `ratio` and `triangles`');
    if (p.ratio !== undefined && !(p.ratio > 0 && p.ratio <= 1)) throw new Error(`ratio ${p.ratio} must be in (0, 1]`);
    if (p.triangles !== undefined && p.triangles < 1) throw new Error(`triangles ${p.triangles} must be at least 1`);
    if (p.error !== undefined && !(p.error > 0)) throw new Error(`error ${p.error} must be positive`);

    const selector = p.faces ?? 'all';
    const hit = selectFaces(mesh, selector);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(selector)} matched no face`);
    const chosen = new Set(hit);
    const faces = hit.map((f) => mesh.faces[f]!);
    const indices = Uint32Array.from(faces.flatMap((face) => triangulateFace(mesh, face).flat()));
    const count = indices.length / 3;
    const target = p.triangles ?? Math.round(count * p.ratio!);
    if (target >= count) return mesh;

    // The seam with faces left alone stays where it is, or the two would part.
    const lock = new Uint8Array(mesh.positions.length);
    mesh.faces.forEach((face, f) => {
        if (!chosen.has(f)) for (const v of face.v) lock[v] = 1;
    });
    const positions = Float32Array.from(mesh.positions.flat());
    const [kept] = MeshoptSimplifier.simplifyWithAttributes(
        indices, positions, 3, vertexAttributes(mesh, faces), ATTRIBUTES,
        [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT, COLOR_WEIGHT, COLOR_WEIGHT, COLOR_WEIGHT],
        // Not RegularizeLight: under an error limit it stops a flat surface from collapsing at all.
        lock, target * 3, p.error ?? DEFAULT_ERROR, ['LockBorder'],
    );
    if (kept.length === 0) throw new Error(`nothing is left at ${target} triangles; raise \`ratio\` or \`triangles\``);

    const around = new Map<number, Face[]>();
    for (const face of faces) {
        for (const v of face.v) {
            const at = around.get(v);
            if (at) at.push(face); else around.set(v, [face]);
        }
    }
    const made: Face[] = [];
    for (let i = 0; i < kept.length; i += 3) {
        const [a, b, c] = [kept[i]!, kept[i + 1]!, kept[i + 2]!];
        const [pa, pb, pc]: Vec3[] = [mesh.positions[a]!, mesh.positions[b]!, mesh.positions[c]!];
        const normal = normalize(cross(sub(pb, pa), sub(pc, pa)));
        // The old face this triangle lies on the most: the one holding most of its corners, then the one facing its way.
        const shared = new Map<Face, number>();
        for (const v of [a, b, c]) for (const face of around.get(v)!) shared.set(face, (shared.get(face) ?? 0) + 1);
        let from: Face | null = null;
        let best = -Infinity;
        for (const [face, corners] of shared) {
            const score = corners + dot(faceNormal(mesh, face), normal);
            if (score > best) { best = score; from = face; }
        }
        // A face's own corners (a place in a picture, a way it is lit) belong to its vertices, and a triangle that is kept has three of
        // those: each takes what any old face held for it there.
        const corner = <K extends 'cornerUvs' | 'cornerNormals'>(key: K): Pick<Face, K> | Record<string, never> => {
            if (!from![key]) return {};
            const held = [a, b, c].map((v) => { for (const face of around.get(v)!) { const i = face.v.indexOf(v); if (face[key]?.[i]) return face[key]![i]!; } return from![key]![0]!; });
            return { [key]: held } as unknown as Pick<Face, K>;
        };
        made.push({ ...from!, v: [a, b, c], ...corner('cornerUvs'), ...corner('cornerNormals') });
    }
    return compact({ positions: mesh.positions, faces: [...mesh.faces.filter((_, f) => !chosen.has(f)), ...made] });
}
