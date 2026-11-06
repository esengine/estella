// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelUv.ts — how each face takes a texture: the `uv` step, and the corner UVs
 *        the bake asks for. A face's corners are worked out together, because a seam
 *        can only be stepped over by looking at the corners next to each other.
 */
import {
    boundsOf, dot, faceNormal, isAxisName, axisVector, selectFaces, sub,
    type Face, type FaceSelector, type FaceUv, type PolyMesh, type Vec3,
} from './polyMesh';

const pair = (v: number | readonly number[] | undefined, fallback: readonly [number, number]): readonly [number, number] =>
    v === undefined ? fallback : typeof v === 'number' ? [v, v] : [v[0]!, v[1]!];

export interface UvParams {
    faces?: FaceSelector;
    mode: FaceUv['mode'];
    axis?: string;
    at?: Vec3;
    scale?: number | readonly number[];
    repeat?: number | readonly number[];
    offset?: readonly number[];
    rotate?: number;
}

export function uvStep(mesh: PolyMesh, p: UvParams): PolyMesh {
    const selector = p.faces ?? 'all';
    const hit = selectFaces(mesh, selector);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(selector)} matched no face`);
    const axis = p.axis ?? (p.mode === 'planar' ? '+z' : p.mode === 'cylinder' ? 'y' : undefined);
    if (p.mode === 'planar' && !isAxisName(axis!)) throw new Error(`a planar uv's axis ${JSON.stringify(axis)} must be one like "+z"`);
    if (p.mode === 'cylinder' && !['x', 'y', 'z'].includes(axis!)) throw new Error(`a cylinder uv's axis ${JSON.stringify(axis)} must be x, y or z`);
    const scale = pair(p.scale, [1, 1]);
    if (scale[0] === 0 || scale[1] === 0) throw new Error('scale must not be 0');

    const { min, max } = boundsOf(mesh, new Set(hit.flatMap((f) => mesh.faces[f]!.v)));
    const k = { x: 0, y: 1, z: 2 }[axis as 'x'] ?? 1;
    const uv: FaceUv = {
        mode: p.mode,
        ...(axis ? { axis } : {}),
        center: p.at ?? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        extent: Math.max(max[k]! - min[k]!, 1e-6),
        scale,
        repeat: pair(p.repeat, [1, 1]),
        offset: pair(p.offset, [0, 0]),
        rotate: p.rotate ?? 0,
    };
    const set = new Set(hit);
    return { ...mesh, faces: mesh.faces.map((f, i) => (set.has(i) ? { ...f, uv } : f)) };
}

/** The in-plane axes a texture is laid along when seen from @p n, with up staying up where it can. */
function planeAxes(n: Vec3): [Vec3, Vec3] {
    const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    if (ay >= ax && ay >= az) return [[1, 0, 0], n[1] > 0 ? [0, 0, -1] : [0, 0, 1]];
    if (ax >= az) return [n[0] > 0 ? [0, 0, -1] : [0, 0, 1], [0, 1, 0]];
    return [n[2] > 0 ? [1, 0, 0] : [-1, 0, 0], [0, 1, 0]];
}

function finish(uv: FaceUv | undefined, u: number, v: number): [number, number] {
    if (!uv) return [u, v];
    const a = (uv.rotate * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return [c * u - s * v + uv.offset[0], s * u + c * v + uv.offset[1]];
}

/** The UV at each corner of @p face. */
export function faceUvs(mesh: PolyMesh, face: Face, uvScale: number): Map<number, readonly [number, number]> {
    const out = new Map<number, readonly [number, number]>();
    const uv = face.uv;
    if (!uv || uv.mode === 'box' || uv.mode === 'planar') {
        const normal = uv?.mode === 'planar' ? axisVector(uv.axis as never) : faceNormal(mesh, face);
        const [right, up] = planeAxes(normal);
        const [su, sv] = uv ? uv.scale : [uvScale, uvScale];
        const origin: Vec3 = uv ? uv.center : [0, 0, 0];
        for (const i of face.v) {
            const p = sub(mesh.positions[i]!, origin);
            out.set(i, finish(uv, dot(p, right) / su, dot(p, up) / sv));
        }
        return out;
    }
    // The round modes: an angle jumps by a whole turn across its seam, and a face straddling that must not paint the texture backwards across itself.
    const raw = face.v.map((i) => {
        const q = sub(mesh.positions[i]!, uv.center);
        if (uv.mode === 'sphere') {
            const len = Math.hypot(q[0], q[1], q[2]) || 1;
            return [Math.atan2(q[0], q[2]) / (2 * Math.PI) + 0.5, Math.acos(Math.max(-1, Math.min(1, q[1] / len))) / Math.PI] as [number, number];
        }
        const k = { x: 0, y: 1, z: 2 }[uv.axis as 'x']!;
        const [a, b] = [q[(k + 2) % 3]!, q[(k + 1) % 3]!];
        return [Math.atan2(b, a) / (2 * Math.PI) + 0.5, q[k]! / uv.extent + 0.5] as [number, number];
    });
    const first = raw[0]![0];
    face.v.forEach((i, n) => {
        let u = raw[n]![0];
        if (u - first > 0.5) u -= 1;
        else if (first - u > 0.5) u += 1;
        out.set(i, finish(uv, u * uv.repeat[0], raw[n]![1] * uv.repeat[1]));
    });
    return out;
}
