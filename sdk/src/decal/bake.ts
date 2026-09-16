// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bake.ts
 * @brief   A projector and the surfaces under it, in: one mesh out.
 *
 * @details The mesh is in the PROJECTOR's own space, so the entity carrying the
 *          decal draws it through the very transform that defined the box — move
 *          the decal and its geometry moves with it, without a rebake, right up
 *          until it leaves the surface it was cut from.
 */

import { invertMatrix4 } from '../math/mat4';
import { MeshChannel, MeshChannelType, type MeshData } from '../asset/meshFormat';
import { clipToProjector, projectorUV, DEFAULT_FACING_COSINE,
         type ClipTriangle, type ClipVertex } from './clip';

/** One surface the projector may print on, in WORLD space. */
export interface DecalReceiver {
    /** Three floats per vertex. */
    positions: Float32Array;
    /** Three floats per vertex, one per position. */
    normals: Float32Array;
    /** Three indices per triangle. */
    indices: Uint32Array;
}

/**
 * One mesh, placed, as surfaces a projector can print on.
 *
 * Here and not in each caller because it is the same knowledge the cut needs:
 * which channel is which, and that a transform moves a position one way and a
 * normal the other.
 */
export function receiverFromMesh(mesh: MeshData, transform: ArrayLike<number>): DecalReceiver | null {
    const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position);
    const nrm = mesh.channels.find((c) => c.semantic === MeshChannel.Normal);
    if (!pos || pos.type !== MeshChannelType.Float32) return null;
    const m = transform;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const positions = new Float32Array(mesh.vertexCount * 3);
    const normals = new Float32Array(mesh.vertexCount * 3);
    // The inverse-transpose a normal takes, for the usual reason: under a
    // non-uniform scale the position transform tilts a normal off its surface.
    const nm = normalMatrixOf(m);
    for (let v = 0; v < mesh.vertexCount; ++v) {
        const b = v * mesh.vertexStride + pos.offset;
        const x = view.getFloat32(b, true);
        const y = view.getFloat32(b + 4, true);
        const z = pos.components >= 3 ? view.getFloat32(b + 8, true) : 0;
        positions[v * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        positions[v * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        positions[v * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        // Geometry with no normal channel faces the viewer, as a flat surface
        // does everywhere else here — and then only a head-on projector prints.
        let nx = 0, ny = 0, nz = 1;
        if (nrm && nrm.type === MeshChannelType.Float32) {
            const nb = v * mesh.vertexStride + nrm.offset;
            nx = view.getFloat32(nb, true);
            ny = view.getFloat32(nb + 4, true);
            nz = view.getFloat32(nb + 8, true);
        }
        const wx = nm[0]! * nx + nm[3]! * ny + nm[6]! * nz;
        const wy = nm[1]! * nx + nm[4]! * ny + nm[7]! * nz;
        const wz = nm[2]! * nx + nm[5]! * ny + nm[8]! * nz;
        const len = Math.hypot(wx, wy, wz) || 1;
        normals[v * 3] = wx / len;
        normals[v * 3 + 1] = wy / len;
        normals[v * 3 + 2] = wz / len;
    }
    return { positions, normals, indices: mesh.indices };
}

/** The 3x3 inverse-transpose of a column-major 4x4, column-major. */
function normalMatrixOf(m: ArrayLike<number>): number[] {
    const a = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
    const det = a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!)
              - a[3]! * (a[1]! * a[8]! - a[2]! * a[7]!)
              + a[6]! * (a[1]! * a[5]! - a[2]! * a[4]!);
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const inv = 1 / det;
    // Cofactors, transposed twice — which is the cofactor matrix itself.
    return [
        (a[4]! * a[8]! - a[5]! * a[7]!) * inv, (a[5]! * a[6]! - a[3]! * a[8]!) * inv,
        (a[3]! * a[7]! - a[4]! * a[6]!) * inv,
        (a[2]! * a[7]! - a[1]! * a[8]!) * inv, (a[0]! * a[8]! - a[2]! * a[6]!) * inv,
        (a[1]! * a[6]! - a[0]! * a[7]!) * inv,
        (a[1]! * a[5]! - a[2]! * a[4]!) * inv, (a[2]! * a[3]! - a[0]! * a[5]!) * inv,
        (a[0]! * a[4]! - a[1]! * a[3]!) * inv,
    ];
}

export interface DecalBakeOptions {
    /** How far from facing the projector a surface may be. @see DEFAULT_FACING_COSINE */
    facing?: number;
}

/** Position (3f) + normal (3f) + uv (2f), interleaved — what a decal needs and
 *  no more: it is lit like the surface and reads its texture through the box. */
const STRIDE = 8 * 4;

function mulPoint(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
    return [
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ];
}

/**
 * A world normal into projector space.
 *
 * The TRANSPOSE of the projector's own 3x3, which is the inverse-transpose of
 * the inverse — so the engine's normal matrix, applied when the decal draws,
 * lands it back on the world normal it came from.
 */
function normalIntoProjector(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
    const nx = m[0]! * x + m[1]! * y + m[2]! * z;
    const ny = m[4]! * x + m[5]! * y + m[6]! * z;
    const nz = m[8]! * x + m[9]! * y + m[10]! * z;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

/**
 * The decal's geometry, or null when the projector prints on nothing.
 *
 * Null and not an empty mesh: a decal over thin air is a thing to report, and a
 * mesh with no triangles is a draw call that says nothing.
 */
export function bakeDecalMesh(
    receivers: readonly DecalReceiver[],
    projectorWorld: ArrayLike<number>,
    options: DecalBakeOptions = {},
): MeshData | null {
    // Whatever shape the caller's matrix came in: composeTRS — the SDK's own way
    // to build one — answers a plain array, and handing a matrix over should not
    // require converting it first.
    const world = projectorWorld instanceof Float32Array
        ? projectorWorld
        : Float32Array.from(projectorWorld);
    const inverse = invertMatrix4(world);
    const triangles: ClipTriangle[] = [];
    for (const r of receivers) {
        for (let i = 0; i + 2 < r.indices.length; i += 3) {
            const corner = (k: number): ClipVertex => {
                const at = r.indices[i + k]! * 3;
                return {
                    p: mulPoint(inverse, r.positions[at]!, r.positions[at + 1]!, r.positions[at + 2]!),
                    n: normalIntoProjector(world,
                                           r.normals[at]!, r.normals[at + 1]!, r.normals[at + 2]!),
                };
            };
            triangles.push([corner(0), corner(1), corner(2)]);
        }
    }

    const cut = clipToProjector(triangles, options.facing ?? DEFAULT_FACING_COSINE);
    if (cut.length === 0) return null;

    const vertexCount = cut.length * 3;
    const vertices = new Uint8Array(vertexCount * STRIDE);
    const floats = new Float32Array(vertices.buffer);
    const indices = new Uint32Array(vertexCount);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

    let at = 0;
    for (const tri of cut) {
        for (const c of tri) {
            // Welding is left undone on purpose: a cut edge's two vertices carry
            // the same position and different normals often enough that merging
            // by position alone would flatten the shading the receiver had.
            floats[at * 8 + 0] = c.p[0];
            floats[at * 8 + 1] = c.p[1];
            floats[at * 8 + 2] = c.p[2];
            floats[at * 8 + 3] = c.n[0];
            floats[at * 8 + 4] = c.n[1];
            floats[at * 8 + 5] = c.n[2];
            const uv = projectorUV(c);
            floats[at * 8 + 6] = uv[0];
            floats[at * 8 + 7] = uv[1];
            for (let k = 0; k < 3; ++k) {
                min[k] = Math.min(min[k]!, c.p[k]!);
                max[k] = Math.max(max[k]!, c.p[k]!);
            }
            indices[at] = at;
            ++at;
        }
    }

    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
            { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32, offset: 24 },
        ],
        vertexStride: STRIDE,
        vertexCount,
        vertices,
        indices,
        aabbMin: min,
        aabbMax: max,
    };
}
