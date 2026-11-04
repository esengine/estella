// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Mesh simplification — the cheaper stand-ins a `LODGroup` swaps in as an object shrinks.
 *
 *        An import that can write the levels spares a creator the one job nobody does by
 *        hand: re-exporting every prop three times at three budgets. The collapse itself is
 *        meshoptimizer's quadric-error simplifier; what is written here is the part around
 *        it — what the simplifier is told about a vertex (its position, and the normal and
 *        UV that must not be collapsed across a seam), and what the result is made of.
 *
 *        The result keeps the SOURCE vertices, not new ones: every surviving vertex is a
 *        byte-for-byte copy of one the original had, so every channel — colour, the
 *        lightmap UV, anything a later format adds — rides along without this file having
 *        to know it exists.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';

/** What the collapse is allowed to cost, as a fraction of the mesh's own extent. */
export interface SimplifyOptions {
    /** Share of the triangles to keep, in (0, 1). The result may keep more where the
     *  error limit stops the collapse first — a level is never worse than its budget. */
    ratio: number;
    /** The most the surface may move, relative to the mesh's extent. */
    maxError?: number;
    /** How freely the collapse may treat the surface. Far levels are looked at small, so they can give up a mesh's open borders, collapse across a seam
     *  and drop specks that are no longer a shape (`Permissive`, `Prune`); a near level keeps its borders (`LockBorder`), where a gap would show. */
    flags?: SimplifierFlag[];
}

export type SimplifierFlag = 'LockBorder' | 'Sparse' | 'ErrorAbsolute' | 'Prune' | 'Regularize' | 'Permissive' | 'RegularizeLight';

export interface Simplified {
    data: MeshData;
    triangles: number;
    /** What the collapse cost, relative to the mesh's extent. */
    error: number;
}

/** Weights on what must survive besides the shape. A UV is wrapped art, so it counts
 *  full; a normal bends light and is allowed a little more give. */
const NORMAL_WEIGHT = 0.5;
const UV_WEIGHT = 1.0;

const floatChannel = (data: MeshData, semantic: number, components: number) =>
    data.channels.find((c) => c.semantic === semantic && c.components >= components
        && c.type === MeshChannelType.Float32);

/** Geometry a collapse would break: bones index into the vertices, morph deltas are
 *  addressed by them. Such a mesh keeps one level of detail. */
export function canSimplify(data: MeshData): boolean {
    if (data.morph) return false;
    if (data.channels.some((c) => c.semantic === MeshChannel.Joints || c.semantic === MeshChannel.Weights)) return false;
    return !!floatChannel(data, MeshChannel.Position, 3) && data.indices.length >= 3;
}

/**
 * A cheaper copy of `data`, or null where it cannot be made cheaper (skinned, morphing,
 * already smaller than the budget).
 */
export async function simplifyMesh(data: MeshData, options: SimplifyOptions): Promise<Simplified | null> {
    if (!canSimplify(data)) return null;
    await MeshoptSimplifier.ready;

    const { vertexCount, vertexStride } = data;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const position = floatChannel(data, MeshChannel.Position, 3)!;
    const normal = floatChannel(data, MeshChannel.Normal, 3);
    const uv = floatChannel(data, MeshChannel.TexCoord0, 2);

    const positions = new Float32Array(vertexCount * 3);
    const attributeStride = (normal ? 3 : 0) + (uv ? 2 : 0);
    const attributes = new Float32Array(vertexCount * attributeStride);
    for (let v = 0; v < vertexCount; v++) {
        const at = v * vertexStride;
        for (let k = 0; k < 3; k++) positions[v * 3 + k] = view.getFloat32(at + position.offset + k * 4, true);
        let a = v * attributeStride;
        if (normal) for (let k = 0; k < 3; k++) attributes[a++] = view.getFloat32(at + normal.offset + k * 4, true);
        if (uv) for (let k = 0; k < 2; k++) attributes[a++] = view.getFloat32(at + uv.offset + k * 4, true);
    }
    const weights = [...(normal ? [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT] : []),
                     ...(uv ? [UV_WEIGHT, UV_WEIGHT] : [])];

    const triangles = data.indices.length / 3;
    const targetTriangles = Math.max(1, Math.floor(triangles * options.ratio));
    if (targetTriangles >= triangles) return null;
    const flags = options.flags ?? ['LockBorder'];
    const [kept, error] = attributeStride > 0
        ? MeshoptSimplifier.simplifyWithAttributes(data.indices, positions, 3, attributes, attributeStride, weights,
            null, targetTriangles * 3, options.maxError ?? 0.05, flags)
        : MeshoptSimplifier.simplify(data.indices, positions, 3, targetTriangles * 3, options.maxError ?? 0.05, flags);
    if (kept.length === 0 || kept.length >= data.indices.length) return null;

    // Only the vertices the survivors name are carried: a collapse leaves the rest behind.
    const remap = new Int32Array(vertexCount).fill(-1);
    let used = 0;
    for (const i of kept) if (remap[i] < 0) remap[i] = used++;
    const vertices = new Uint8Array(used * vertexStride);
    for (let v = 0; v < vertexCount; v++) {
        const to = remap[v];
        if (to >= 0) vertices.set(data.vertices.subarray(v * vertexStride, (v + 1) * vertexStride), to * vertexStride);
    }
    const indices = new Uint32Array(kept.length);
    for (let i = 0; i < kept.length; i++) indices[i] = remap[kept[i]!]!;

    return {
        data: { ...data, vertexCount: used, vertices, indices },
        triangles: indices.length / 3,
        error,
    };
}
