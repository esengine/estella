// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    staticBatch.ts
 * @brief   Many static meshes that share a material, folded into a few larger ones.
 *
 * @details The renderer already draws the SAME geometry many times as one instanced
 *          draw. What it cannot do is draw DIFFERENT geometry as one: each mesh is its
 *          own buffer range, so a level assembled from fifty distinct props pays fifty
 *          draws per material. A static batch is the answer a tool can give — bake each
 *          part's world transform into its vertices, concatenate, and draw the result once.
 *
 *          Three jobs, kept apart so each can be tested without a GPU:
 *            - {@link mergeMeshes}   the geometry: transforms and concatenates decoded meshes;
 *            - {@link planStaticBatches}  the grouping: who may share a draw, in which cells;
 *            - the plugin (staticBatchPlugin.ts)  the world: reads entities, uploads, hides.
 *
 *          What it costs is memory, not correctness: the merged mesh holds a copy of every
 *          part's vertices, and a part that stood for a hundred instances is now a hundred
 *          copies. {@link StaticBatchGroup} reports both numbers so the trade is visible.
 */
import { MeshChannel, MeshChannelType, type MeshChannelDesc, type MeshData } from '../asset/meshFormat';

/** Why a mesh was left out of every batch. Each one is a rule the merge relies on. */
export type StaticBatchRefusal =
    /** No geometry behind the handle yet (still loading, or a mesh that failed). */
    | 'no-mesh'
    /** Posed by a skeleton: one draw can only be in one pose. */
    | 'skinned'
    /** Carries blend shapes: one draw can only be in one shape. */
    | 'morph'
    /** Chooses among levels of detail at run time, which a merged mesh cannot. */
    | 'lod'
    /** A billboard: it turns to each view, and a merged mesh is fixed where it was baked. */
    | 'billboard'
    /** Lit by a bake: its atlas patch belongs to the object, not to the batch. */
    | 'baked'
    /** Blended: its result depends on order, and merging is the loss of order. */
    | 'blended'
    /** Moves (a dynamic body or a character): a static batch bakes where it stands. */
    | 'moves'
    /** Switched off, so there is nothing to draw. */
    | 'disabled'
    /** Vertex layout the merge cannot transform (positions or normals not float). */
    | 'layout'
    /** The only member of its group: merging it would cost memory and save nothing. */
    | 'alone';

/** What decides whether two meshes may share a draw — every field is state a draw owns. */
export interface StaticBatchState {
    material: number;
    texture: number;
    normalMap: number;
    color: { r: number; g: number; b: number; a: number };
    layer: number;
    cullBackfaces: boolean;
    lit: boolean;
    parallax: { x: number; y: number };
    /** The author's own grouping (`StaticBatch.group`), so two rooms can be kept apart. */
    group: string;
}

/** Whether a vertex layout is one the merge knows how to transform. */
export function channelSignature(channels: readonly MeshChannelDesc[], stride: number): string {
    return `${stride}:${channels.map((c) => `${c.semantic}.${c.components}.${c.type}@${c.offset}`).join(',')}`;
}

/** Null when the layout can be merged; otherwise the refusal to report. */
export function layoutRefusal(mesh: MeshData): StaticBatchRefusal | null {
    if (mesh.inverseBindMatrices || mesh.channels.some((c) => c.semantic === MeshChannel.Joints || c.semantic === MeshChannel.Weights)) {
        return 'skinned';
    }
    if (mesh.morph) return 'morph';
    const need = (semantic: number, components: number): boolean => {
        const c = mesh.channels.find((x) => x.semantic === semantic);
        return !c || (c.type === MeshChannelType.Float32 && c.components >= components);
    };
    // A channel that is present has to be float to be transformed in place; absent is fine (flat).
    return need(MeshChannel.Position, 3) && need(MeshChannel.Normal, 3) && need(MeshChannel.Tangent, 4)
        && mesh.channels.some((c) => c.semantic === MeshChannel.Position) ? null : 'layout';
}

/** A column-major 4x4 from a TRS, as the engine resolved the entity's world transform. */
export function worldMatrix(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number },
                            s: { x: number; y: number; z: number }): Float64Array {
    const { x, y, z, w } = q;
    return Float64Array.of(
        (1 - 2 * (y * y + z * z)) * s.x, (2 * (x * y + z * w)) * s.x, (2 * (x * z - y * w)) * s.x, 0,
        (2 * (x * y - z * w)) * s.y, (1 - 2 * (x * x + z * z)) * s.y, (2 * (y * z + x * w)) * s.y, 0,
        (2 * (x * z + y * w)) * s.z, (2 * (y * z - x * w)) * s.z, (1 - 2 * (x * x + y * y)) * s.z, 0,
        p.x, p.y, p.z, 1,
    );
}

/** One mesh and where it stands. */
export interface BatchPart {
    mesh: MeshData;
    /** Column-major world matrix. */
    world: ArrayLike<number>;
}

/** The inverse transpose of the upper 3x3, which is what carries a normal through a non-uniform scale. */
function normalMatrix(m: ArrayLike<number>): Float64Array {
    const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, i = m[10]!;
    // The cofactor matrix is det * inverse-transpose; the sign of det is kept, the scale is normalised away.
    return Float64Array.of(
        e * i - f * h, f * g - d * i, d * h - e * g,
        c * h - b * i, a * i - c * g, b * g - a * h,
        b * f - c * e, c * d - a * f, a * e - b * d,
    );
}

const determinant3 = (m: ArrayLike<number>): number =>
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);

/**
 * Concatenates `parts` into one mesh in world space.
 *
 * Every part must carry the same vertex layout (the planner groups by it); positions and
 * tangents go through the world matrix, normals through its inverse transpose. A mirrored part
 * (negative determinant) has its winding reversed and its tangent handedness flipped, so it
 * still faces the way it did.
 */
export function mergeMeshes(parts: readonly BatchPart[]): MeshData {
    if (parts.length === 0) throw new Error('mergeMeshes needs at least one part');
    const first = parts[0]!.mesh;
    const signature = channelSignature(first.channels, first.vertexStride);
    const stride = first.vertexStride;
    let vertexCount = 0;
    let indexCount = 0;
    for (const p of parts) {
        if (channelSignature(p.mesh.channels, p.mesh.vertexStride) !== signature) {
            throw new Error('mergeMeshes: parts carry different vertex layouts');
        }
        vertexCount += p.mesh.vertexCount;
        indexCount += p.mesh.indices.length;
    }

    const position = first.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const normal = first.channels.find((c) => c.semantic === MeshChannel.Normal);
    const tangent = first.channels.find((c) => c.semantic === MeshChannel.Tangent);

    const vertices = new Uint8Array(vertexCount * stride);
    const indices = new Uint32Array(indexCount);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let vBase = 0;
    let iBase = 0;

    for (const { mesh, world } of parts) {
        const out = new Uint8Array(vertices.buffer, vBase * stride, mesh.vertexCount * stride);
        out.set(mesh.vertices.subarray(0, mesh.vertexCount * stride));
        // A view over a copy that starts at a vertex boundary: strides are multiples of 4.
        const dv = new DataView(vertices.buffer, vBase * stride, mesh.vertexCount * stride);
        const nm = normalMatrix(world);
        const flip = determinant3(world) < 0;

        for (let v = 0; v < mesh.vertexCount; v++) {
            const at = v * stride;
            const px = dv.getFloat32(at + position.offset, true);
            const py = dv.getFloat32(at + position.offset + 4, true);
            const pz = dv.getFloat32(at + position.offset + 8, true);
            const wx = world[0]! * px + world[4]! * py + world[8]! * pz + world[12]!;
            const wy = world[1]! * px + world[5]! * py + world[9]! * pz + world[13]!;
            const wz = world[2]! * px + world[6]! * py + world[10]! * pz + world[14]!;
            dv.setFloat32(at + position.offset, wx, true);
            dv.setFloat32(at + position.offset + 4, wy, true);
            dv.setFloat32(at + position.offset + 8, wz, true);
            if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
            if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
            if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;

            if (normal) {
                const nx = dv.getFloat32(at + normal.offset, true);
                const ny = dv.getFloat32(at + normal.offset + 4, true);
                const nz = dv.getFloat32(at + normal.offset + 8, true);
                // nm holds the cofactors of the matrix read row-wise from the column-major input, so
                // the product with it is taken transposed: n' = N^T * n.
                let rx = nm[0]! * nx + nm[3]! * ny + nm[6]! * nz;
                let ry = nm[1]! * nx + nm[4]! * ny + nm[7]! * nz;
                let rz = nm[2]! * nx + nm[5]! * ny + nm[8]! * nz;
                const len = Math.hypot(rx, ry, rz) || 1;
                // The cofactor of a mirrored matrix points the other way; the surface it belongs to has flipped winding.
                const sign = flip ? -1 : 1;
                rx = (rx / len) * sign; ry = (ry / len) * sign; rz = (rz / len) * sign;
                dv.setFloat32(at + normal.offset, rx, true);
                dv.setFloat32(at + normal.offset + 4, ry, true);
                dv.setFloat32(at + normal.offset + 8, rz, true);
            }
            if (tangent) {
                const tx = dv.getFloat32(at + tangent.offset, true);
                const ty = dv.getFloat32(at + tangent.offset + 4, true);
                const tz = dv.getFloat32(at + tangent.offset + 8, true);
                let rx = world[0]! * tx + world[4]! * ty + world[8]! * tz;
                let ry = world[1]! * tx + world[5]! * ty + world[9]! * tz;
                let rz = world[2]! * tx + world[6]! * ty + world[10]! * tz;
                const len = Math.hypot(rx, ry, rz) || 1;
                rx /= len; ry /= len; rz /= len;
                dv.setFloat32(at + tangent.offset, rx, true);
                dv.setFloat32(at + tangent.offset + 4, ry, true);
                dv.setFloat32(at + tangent.offset + 8, rz, true);
                if (flip) dv.setFloat32(at + tangent.offset + 12, -dv.getFloat32(at + tangent.offset + 12, true), true);
            }
        }

        const src = mesh.indices;
        if (flip) {
            for (let t = 0; t + 2 < src.length; t += 3) {
                indices[iBase + t] = src[t]! + vBase;
                indices[iBase + t + 1] = src[t + 2]! + vBase;
                indices[iBase + t + 2] = src[t + 1]! + vBase;
            }
        } else {
            for (let t = 0; t < src.length; t++) indices[iBase + t] = src[t]! + vBase;
        }
        vBase += mesh.vertexCount;
        iBase += src.length;
    }

    return {
        channels: first.channels.map((c) => ({ ...c })),
        vertexStride: stride,
        vertexCount,
        vertices,
        indices,
        aabbMin: min,
        aabbMax: max,
    };
}

/** What the planner knows about one entity, without holding its geometry. */
export interface StaticBatchCandidate {
    entity: number;
    /** `staticBatchKey(...)` of its draw state plus its vertex layout. */
    key: string;
    /** Where its mesh stands, for the cell it falls in. */
    center: readonly [number, number, number];
    vertices: number;
}

export interface StaticBatchPlan {
    /** Entities to merge together, one list per resulting mesh. */
    batches: { key: string; entities: number[]; vertices: number }[];
    /** Entities left out because they would have been alone in their group. */
    alone: number[];
}

export interface StaticBatchLimits {
    /** Side of the world cell a batch is confined to: bigger merges more and culls worse. */
    cellSize: number;
    /** Most vertices one merged mesh may hold. */
    maxVertices: number;
}

export const STATIC_BATCH_DEFAULTS: StaticBatchLimits = { cellSize: 1600, maxVertices: 262144 };

/** The draw state two meshes must share to be one draw, as a string. */
export function staticBatchKey(state: StaticBatchState, layout: string): string {
    const c = state.color;
    return [state.material, state.texture, state.normalMap, c.r, c.g, c.b, c.a, state.layer,
        state.cullBackfaces ? 1 : 0, state.lit ? 1 : 0, state.parallax.x, state.parallax.y, state.group, layout].join('|');
}

/**
 * Groups candidates by draw state, confines each group to world cells, and splits a cell at the
 * vertex limit. Order inside a batch follows entity id, so the same scene always merges the same way.
 */
export function planStaticBatches(candidates: readonly StaticBatchCandidate[],
                                  limits: StaticBatchLimits = STATIC_BATCH_DEFAULTS): StaticBatchPlan {
    const cells = new Map<string, StaticBatchCandidate[]>();
    const size = Math.max(1, limits.cellSize);
    for (const c of candidates) {
        const cell = `${c.key}#${Math.floor(c.center[0] / size)},${Math.floor(c.center[1] / size)},${Math.floor(c.center[2] / size)}`;
        const list = cells.get(cell);
        if (list) list.push(c); else cells.set(cell, [c]);
    }
    const plan: StaticBatchPlan = { batches: [], alone: [] };
    for (const list of cells.values()) {
        list.sort((a, b) => a.entity - b.entity);
        let current: StaticBatchCandidate[] = [];
        let vertices = 0;
        const flush = (): void => {
            if (current.length === 0) return;
            if (current.length === 1) plan.alone.push(current[0]!.entity);
            else plan.batches.push({ key: current[0]!.key, entities: current.map((c) => c.entity), vertices });
            current = [];
            vertices = 0;
        };
        for (const c of list) {
            if (current.length > 0 && vertices + c.vertices > limits.maxVertices) flush();
            current.push(c);
            vertices += c.vertices;
        }
        flush();
    }
    plan.batches.sort((a, b) => a.entities[0]! - b.entities[0]!);
    plan.alone.sort((a, b) => a - b);
    return plan;
}

/** One merged mesh, as the report states it. */
export interface StaticBatchGroup {
    /** The entity that now draws the merged mesh. */
    entity: number;
    /** The meshes folded into it. */
    parts: number[];
    vertices: number;
    triangles: number;
    /** Bytes of vertex and index data the merged mesh holds (the copy the merge costs). */
    bytes: number;
    /** What drawing the parts took: one per distinct mesh range, plus the instancing the renderer already did. */
    drawsBefore: number;
}

/** What the last pass did and left out, for a profiler or an editor panel. */
export interface StaticBatchReport {
    groups: StaticBatchGroup[];
    refused: Map<number, StaticBatchRefusal>;
}
