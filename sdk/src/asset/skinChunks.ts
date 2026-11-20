// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skinChunks.ts — a skinned mesh made ready for the GPU skinning path.
 *
 *        Three steps: the joints a vertex is moved by are cut to the influence limit and
 *        their weights made to sum to one again; a skin with more bones than one draw may carry is split into chunks, each a
 *        run of triangles whose vertices are moved by at most that many (a vertex two chunks share is written into both);
 *        and the skin channels are narrowed, the joint indices to a byte (a chunk never names more than 256 bones) and the
 *        weights to a byte or, at high precision, to two.
 *
 *        Pure and idempotent over its own output: a mesh already chunked is chunked again from the joints its chunks name,
 *        so an export for a platform with a smaller bone budget re-splits what the import wrote.
 */
import {
    MESH_MAX_BONES, MeshChannel, MeshChannelType, componentBytes, decodeMesh, encodeMesh, packChannels,
    type MeshChannelDesc, type MeshData, type MeshSkinChunks,
} from './meshFormat';

/** Joints a vertex can be moved by in the vertex layout: one `Joints` and one `Weights` channel of four. */
export const SKIN_INFLUENCES = 4;
/** Fewest bones a chunk may be given: one triangle can name twelve, and a chunk holds at least one triangle. */
export const MIN_BONES_PER_CHUNK = 3 * SKIN_INFLUENCES;

export interface SkinBuildOptions {
    /** Most bones one chunk is posed by; at most {@link MESH_MAX_BONES}. */
    maxBonesPerChunk?: number;
    /** Most joints one vertex is moved by; 0 or absent is every influence kept (four). */
    influenceLimit?: number;
    /** Weights at 16 bits rather than 8. */
    highPrecisionWeights?: boolean;
}

/** What building the skin did, for an import report. */
export interface SkinBuildReport {
    /** Chunks the mesh is drawn in: 1 when one draw poses it whole. */
    chunks: number;
    /** Bones the largest chunk carries. */
    maxBonesInChunk: number;
    /** Vertices written into more than one chunk. */
    duplicatedVertices: number;
    /** Vertices that lost an influence to the limit. */
    limitedVertices: number;
    /** The cluster hierarchy was dropped: it named vertices the chunks renumbered. */
    droppedClusters: boolean;
}

interface Influences {
    /** Four joints a vertex, as indices into the bind matrices. */
    joints: Uint32Array;
    /** Four weights a vertex, summing to one where any is not zero. */
    weights: Float32Array;
}

function readComponent(view: DataView, at: number, type: number): number {
    switch (type) {
    case MeshChannelType.UNorm8: return view.getUint8(at) / 255;
    case MeshChannelType.UInt8: return view.getUint8(at);
    case MeshChannelType.UInt16: return view.getUint16(at, true);
    case MeshChannelType.UNorm16: return view.getUint16(at, true) / 65535;
    default: return view.getFloat32(at, true);
    }
}

/** Each vertex's chunk, from the chunk ranges: a vertex belongs to one chunk once chunked. */
function chunkOfVertex(data: MeshData, chunks: MeshSkinChunks): Int32Array {
    const out = new Int32Array(data.vertexCount).fill(-1);
    for (let c = 0; c < chunks.boneCounts.length; c++) {
        const first = chunks.ranges[c * 2]!, count = chunks.ranges[c * 2 + 1]!;
        for (let i = first; i < first + count; i++) out[data.indices[i]!] = c;
    }
    return out;
}

/** Every vertex's influences as indices into the bind matrices, whatever the channels store them as. */
function readInfluences(data: MeshData, jointsCh: MeshChannelDesc, weightsCh: MeshChannelDesc): Influences {
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const joints = new Uint32Array(data.vertexCount * SKIN_INFLUENCES);
    const weights = new Float32Array(data.vertexCount * SKIN_INFLUENCES);
    const chunks = data.skinChunks;
    const chunkOf = chunks ? chunkOfVertex(data, chunks) : null;
    const boneStart = chunks ? new Uint32Array(chunks.boneCounts.length) : null;
    if (chunks && boneStart) for (let c = 1; c < boneStart.length; c++) boneStart[c] = boneStart[c - 1]! + chunks.boneCounts[c - 1]!;
    const jb = componentBytes(jointsCh.type), wb = componentBytes(weightsCh.type);
    for (let v = 0; v < data.vertexCount; v++) {
        const base = v * data.vertexStride;
        for (let k = 0; k < SKIN_INFLUENCES; k++) {
            const w = k < weightsCh.components ? readComponent(view, base + weightsCh.offset + k * wb, weightsCh.type) : 0;
            let j = k < jointsCh.components ? readComponent(view, base + jointsCh.offset + k * jb, jointsCh.type) : 0;
            // A chunked vertex names its chunk's k-th bone; the bind matrix it means is that bone.
            if (chunks && chunkOf && boneStart && chunkOf[v]! >= 0) j = chunks.bones[boneStart[chunkOf[v]!]! + j]!;
            joints[v * SKIN_INFLUENCES + k] = w > 0 ? j : 0;
            weights[v * SKIN_INFLUENCES + k] = w;
        }
    }
    return { joints, weights };
}

/** Keeps each vertex's `limit` heaviest influences and makes the weights sum to one again. Returns the vertices it cut. */
function limitInfluences(inf: Influences, vertexCount: number, limit: number): number {
    let cut = 0;
    const order = [0, 1, 2, 3];
    for (let v = 0; v < vertexCount; v++) {
        const b = v * SKIN_INFLUENCES;
        order.sort((x, y) => inf.weights[b + y]! - inf.weights[b + x]!);
        let lost = false;
        for (let r = limit; r < SKIN_INFLUENCES; r++) {
            const k = order[r]!;
            if (inf.weights[b + k]! > 0) lost = true;
            inf.weights[b + k] = 0;
            inf.joints[b + k] = 0;
        }
        let sum = 0;
        for (let k = 0; k < SKIN_INFLUENCES; k++) sum += inf.weights[b + k]!;
        if (sum > 0) for (let k = 0; k < SKIN_INFLUENCES; k++) inf.weights[b + k]! /= sum;
        if (lost) cut++;
    }
    return cut;
}

/**
 * Weights to `max` steps that still sum to exactly `max`: rounded, then what rounding gained or lost given to the
 * heaviest, so a vertex is never moved by a fraction more or less than the whole of its pose.
 */
function quantizeWeights(weights: Float32Array, at: number, max: number): number[] {
    const q = [0, 0, 0, 0];
    let sum = 0, heaviest = 0;
    for (let k = 0; k < SKIN_INFLUENCES; k++) {
        q[k] = Math.round(weights[at + k]! * max);
        sum += q[k]!;
        if (weights[at + k]! > weights[at + heaviest]!) heaviest = k;
    }
    if (sum > 0) q[heaviest] = Math.max(0, q[heaviest]! + (max - sum));
    return q;
}

/**
 * Builds a skinned mesh's GPU form; anything that is not skinned comes back as it was. See the file comment for the steps.
 */
export function buildSkinnedMesh(data: MeshData, options: SkinBuildOptions = {}): { mesh: MeshData; report: SkinBuildReport } {
    const report: SkinBuildReport = { chunks: 1, maxBonesInChunk: 0, duplicatedVertices: 0, limitedVertices: 0, droppedClusters: false };
    const jointsCh = data.channels.find((c) => c.semantic === MeshChannel.Joints);
    const weightsCh = data.channels.find((c) => c.semantic === MeshChannel.Weights);
    const jointCount = (data.inverseBindMatrices?.length ?? 0) / 16;
    if (!jointsCh || !weightsCh || jointCount === 0) return { mesh: data, report };

    const budget = Math.max(MIN_BONES_PER_CHUNK, Math.min(MESH_MAX_BONES, options.maxBonesPerChunk || MESH_MAX_BONES));
    const limit = options.influenceLimit && options.influenceLimit > 0 ? Math.min(SKIN_INFLUENCES, options.influenceLimit) : SKIN_INFLUENCES;

    const inf = readInfluences(data, jointsCh, weightsCh);
    report.limitedVertices = limitInfluences(inf, data.vertexCount, limit);

    // The chunks: runs of triangles, in index order, each closed when the next triangle's bones would not fit.
    const triangles = data.indices.length / 3;
    const chunkStarts: number[] = [];
    const chunkBones: number[][] = [];
    if (jointCount <= budget) {
        chunkStarts.push(0);
        chunkBones.push(Array.from({ length: jointCount }, (_, i) => i));
    } else {
        let bones = new Set<number>();
        const named = new Set<number>();
        for (let t = 0; t < triangles; t++) {
            named.clear();
            for (let c = 0; c < 3; c++) {
                const v = data.indices[t * 3 + c]!;
                for (let k = 0; k < SKIN_INFLUENCES; k++) if (inf.weights[v * SKIN_INFLUENCES + k]! > 0) named.add(inf.joints[v * SKIN_INFLUENCES + k]!);
            }
            let fresh = 0;
            for (const b of named) if (!bones.has(b)) fresh++;
            if (t === 0 || bones.size + fresh > budget) {
                if (t > 0) chunkBones.push([...bones]);
                chunkStarts.push(t * 3);
                bones = new Set();
            }
            for (const b of named) bones.add(b);
        }
        chunkBones.push([...bones]);
    }
    const chunked = chunkBones.length > 1 || jointCount > MESH_MAX_BONES;

    // The new channel layout: every channel as it was, the skin's two narrowed.
    const weightType = options.highPrecisionWeights ? MeshChannelType.UNorm16 : MeshChannelType.UNorm8;
    const { channels, vertexStride } = packChannels(data.channels.map((c) =>
        c.semantic === MeshChannel.Joints ? { semantic: c.semantic, components: SKIN_INFLUENCES, type: MeshChannelType.UInt8 }
            : c.semantic === MeshChannel.Weights ? { semantic: c.semantic, components: SKIN_INFLUENCES, type: weightType }
                : { semantic: c.semantic, components: c.components, type: c.type }));

    // The vertices, chunk by chunk: each vertex a chunk's triangles use, once in that chunk.
    const sourceOf: number[] = [];
    const localJoints: number[] = [];
    const indices = new Uint32Array(data.indices.length);
    const ranges = new Uint32Array(chunkBones.length * 2);
    const seen = new Uint8Array(data.vertexCount);
    for (let c = 0; c < chunkBones.length; c++) {
        const first = chunkStarts[c]!, end = c + 1 < chunkStarts.length ? chunkStarts[c + 1]! : data.indices.length;
        ranges[c * 2] = first;
        ranges[c * 2 + 1] = end - first;
        const local = new Map<number, number>();
        chunkBones[c]!.forEach((b, i) => local.set(b, i));
        const placed = new Map<number, number>();
        for (let i = first; i < end; i++) {
            const v = data.indices[i]!;
            let out = placed.get(v);
            if (out === undefined) {
                out = sourceOf.length;
                placed.set(v, out);
                sourceOf.push(v);
                if (seen[v]) report.duplicatedVertices++;
                seen[v] = 1;
                for (let k = 0; k < SKIN_INFLUENCES; k++) {
                    const w = inf.weights[v * SKIN_INFLUENCES + k]!;
                    localJoints.push(w > 0 ? local.get(inf.joints[v * SKIN_INFLUENCES + k]!)! : 0);
                }
            }
            indices[i] = out;
        }
        report.maxBonesInChunk = Math.max(report.maxBonesInChunk, chunkBones[c]!.length);
    }
    report.chunks = chunkBones.length;

    // A vertex no triangle uses keeps its place only when nothing is renumbered.
    const vertexCount = chunked ? sourceOf.length : data.vertexCount;
    if (!chunked) {
        sourceOf.length = 0;
        localJoints.length = 0;
        for (let v = 0; v < data.vertexCount; v++) {
            sourceOf.push(v);
            for (let k = 0; k < SKIN_INFLUENCES; k++) localJoints.push(inf.joints[v * SKIN_INFLUENCES + k]!);
        }
        indices.set(data.indices);
    }

    const vertices = new Uint8Array(vertexCount * vertexStride);
    const out = new DataView(vertices.buffer);
    const wMax = options.highPrecisionWeights ? 65535 : 255;
    for (let n = 0; n < vertexCount; n++) {
        const v = sourceOf[n]!;
        for (let ci = 0; ci < channels.length; ci++) {
            const to = channels[ci]!, from = data.channels[ci]!;
            const at = n * vertexStride + to.offset;
            if (to.semantic === MeshChannel.Joints) {
                for (let k = 0; k < SKIN_INFLUENCES; k++) out.setUint8(at + k, localJoints[n * SKIN_INFLUENCES + k]!);
            } else if (to.semantic === MeshChannel.Weights) {
                const q = quantizeWeights(inf.weights, v * SKIN_INFLUENCES, wMax);
                for (let k = 0; k < SKIN_INFLUENCES; k++) {
                    if (wMax === 255) out.setUint8(at + k, q[k]!);
                    else out.setUint16(at + k * 2, q[k]!, true);
                }
            } else {
                const bytes = from.components * componentBytes(from.type);
                vertices.set(data.vertices.subarray(v * data.vertexStride + from.offset, v * data.vertexStride + from.offset + bytes), at);
            }
        }
    }

    const mesh: MeshData = { ...data, channels, vertexStride, vertexCount, vertices, indices };
    if (data.morph && chunked) {
        const per = data.morph.hasNormals ? 6 : 3;
        const targets = data.morph.deltas.length / (data.vertexCount * per);
        const deltas = new Float32Array(targets * vertexCount * per);
        for (let t = 0; t < targets; t++) {
            for (let n = 0; n < vertexCount; n++) {
                const src = (t * data.vertexCount + sourceOf[n]!) * per;
                deltas.set(data.morph.deltas.subarray(src, src + per), (t * vertexCount + n) * per);
            }
        }
        mesh.morph = { ...data.morph, deltas };
    }
    if (chunked) {
        if (data.clusters) {
            delete mesh.clusters;
            report.droppedClusters = true;
        }
        mesh.skinChunks = {
            ranges,
            boneCounts: Uint16Array.from(chunkBones.map((b) => b.length)),
            bones: Uint16Array.from(chunkBones.flat()),
        };
    } else {
        delete mesh.skinChunks;
    }
    return { mesh, report };
}

/**
 * An `.esmesh` re-split for a smaller bone budget, or null when one draw of it already carries no more than `budget`
 * bones (or it is not skinned). What an export for a platform with its own "Maximum bones per Sections" ships.
 */
export function fitSkinToBudget(bytes: Uint8Array, budget: number): Uint8Array | null {
    const mesh = decodeMesh(bytes);
    const joints = (mesh.inverseBindMatrices?.length ?? 0) / 16;
    if (joints === 0) return null;
    const widest = mesh.skinChunks ? Math.max(...mesh.skinChunks.boneCounts) : joints;
    if (widest <= budget) return null;
    const weights = mesh.channels.find((c) => c.semantic === MeshChannel.Weights);
    const { mesh: built } = buildSkinnedMesh(mesh, {
        maxBonesPerChunk: budget,
        highPrecisionWeights: weights?.type === MeshChannelType.UNorm16 || weights?.type === MeshChannelType.Float32,
    });
    return encodeMesh(built);
}
