// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  .esmesh — GPU-resident geometry on disk.
 *
 *        Self-describing: the channel table is written out rather than implied by
 *        a mask, so a file states its own strides and offsets and a reader needs
 *        no table of its own. Adding a channel is then an append to the vocabulary
 *        below, not a format version — and a mesh without normals stays a file
 *        without normals instead of one carrying zeroes.
 */

/** Magic 'ESMH', little-endian. */
const MAGIC = 0x484d5345;
const VERSION = 6;
/** The last version whose indices are always 32-bit. */
const VERSION_U32_INDICES = 3;
/** Flag bits at header offset 50, beside the morph-normals bit. */
const FLAG_MORPH_NORMALS = 1;
/** v4: the index section is 16-bit. Widened to 32-bit when read, so nothing downstream
 *  of the decoder knows the file was narrower. */
const FLAG_U16_INDICES = 2;
/** v5: a cluster hierarchy follows everything else in the file (@ref MeshClusters). */
const FLAG_CLUSTERS = 4;
/** The last version without one: what a mesh that carries none is still written as. */
const VERSION_NO_CLUSTERS = 4;
/** v6: a skin chunk table follows the clusters (@ref MeshSkinChunks). */
const FLAG_SKIN_CHUNKS = 8;
/** The last version without one. */
const VERSION_NO_SKIN_CHUNKS = 5;
/** One chunk on disk: its first index, its index count, and how many bones it names. */
const SKIN_CHUNK_BYTES = 12;
/** One cluster on disk: its first index and index count, then the ten floats of its bounds. */
const CLUSTER_BYTES = 48;
/** Floats of bounds one cluster has: centre, radius and error of the cluster, then of the group that replaces it. */
export const MESH_CLUSTER_BOUNDS_FLOATS = 10;
/** Largest vertex index a 16-bit index can name. */
const MAX_U16_INDEX = 0xffff;

/** Whether every index fits in 16 bits — half the index bytes, for any mesh that small. */
function fitsU16(indices: Uint32Array): boolean {
    for (let i = 0; i < indices.length; i++) if (indices[i]! > MAX_U16_INDEX) return false;
    return true;
}
/** v1 had no joint count; a file that predates skinning reads with the shorter one. */
const HEADER_BYTES_V1 = 44;
/** v2 ended at the joint count; a file that predates morph targets reads with that. */
const HEADER_BYTES_V2 = 48;
const HEADER_BYTES = 56;
const CHANNEL_BYTES = 8;
/** One inverse bind matrix: 16 floats. */
const MATRIX_BYTES = 64;

/**
 * Joints one draw can be posed by — what the RENDERER holds (256 mat4 is 16KB,
 * exactly WebGL2's guaranteed block), not what the format carries. A mesh bound
 * to more is split into chunks of at most this many at import (skinChunks.ts),
 * one draw each. Mirrors GfxEnums.hpp.
 */
export const MESH_MAX_BONES = 256;

/**
 * What a channel means. The value IS the shader attribute location, and the first
 * three match the 2D batch layout, so one attribute vocabulary serves both vertex
 * sources. Append only: these numbers are serialized.
 */
export const MeshChannel = {
    Position: 0,
    Color: 1,
    TexCoord0: 2,
    Normal: 3,
    Tangent: 4,
    /** Which joints move this vertex — indices into the mesh's own bind matrices. */
    Joints: 5,
    /** How much each of those four joints moves it. */
    Weights: 6,
    /** A second UV set: what an unwrap produces for a lightmap, a detail pass or an
     *  AO atlas. Carried because the boundary is lossy in one direction — a source
     *  that had one cannot be re-derived — and read by nothing yet, which is why
     *  `meshShaderReads` in GfxEnums.hpp keeps it out of the vertex LAYOUT. */
    TexCoord1: 7,
} as const;

/** How a channel's components are stored. Append only — serialized. */
/** Every id {@link MeshChannel} declares, for validating a file's channel table. */
const CHANNEL_SEMANTICS: ReadonlySet<number> = new Set(Object.values(MeshChannel));

export const MeshChannelType = {
    Float32: 0,
    UNorm8: 1,
    /** Joint indices over a skin of more than 256 joints that is not chunked. */
    UInt16: 2,
    /** Joint indices of a skin, or of a chunk, of at most 256 joints: a quarter of a float's bytes. */
    UInt8: 3,
    /** Skin weights at high precision: 0..65535 for 0..1. */
    UNorm16: 4,
} as const;

/** Whether a channel type is read as 0..1 rather than as the integer stored. */
export const isNormalizedChannelType = (type: number): boolean =>
    type === MeshChannelType.UNorm8 || type === MeshChannelType.UNorm16;

export interface MeshChannelDesc {
    /** One of {@link MeshChannel}; also the attribute location. */
    semantic: number;
    /** 1..4. */
    components: number;
    /** One of {@link MeshChannelType}. */
    type: number;
    /** Byte offset of this channel within one vertex. */
    offset: number;
}

/**
 * The shapes a mesh can be blended towards, as offsets from the vertices it
 * carries. Deltas rather than whole positions because a target usually moves a
 * fraction of the mesh, and what is stored is then zero wherever it says nothing.
 */
export interface MeshMorphTargets {
    /** One name per target, in the order weights address them. */
    names: string[];
    /** Whether each target carries a normal delta behind its position delta.
     *  A mesh-wide fact, not a per-target one: the deltas are one packed array
     *  and a reader cannot find target `i` without a fixed stride. */
    hasNormals: boolean;
    /**
     * `targets * vertexCount * (hasNormals ? 6 : 3)` floats: for each target,
     * for each vertex, the position delta and — when carried — the normal delta.
     * Float32 and not half: half is what the GPU wants, and narrowing here would
     * make every other reader (a collider, an editor preview) inherit that choice.
     */
    deltas: Float32Array;
}

/**
 * The mesh at every level of detail, as clusters a view picks from piece by piece (the model import builds them for a
 * dense static mesh). The mesh's own `indices` are level 0, in cluster order, so a reader that knows nothing of clusters
 * draws the mesh as it was. Cluster runs are addressed in `indices` followed by `coarseIndices`, as one array.
 */
export interface MeshClusters {
    /** The triangles of every level above the mesh's own. They name the same vertices. */
    coarseIndices: Uint32Array;
    /** Two per cluster: the first index of its run, and how many indices the run has. */
    ranges: Uint32Array;
    /** {@link MESH_CLUSTER_BOUNDS_FLOATS} per cluster. A cluster nothing replaces has `Infinity` for its group's error. */
    bounds: Float32Array;
}

export interface MeshData {
    channels: MeshChannelDesc[];
    vertexStride: number;
    vertexCount: number;
    /** Interleaved vertex bytes, `vertexCount * vertexStride` long. */
    vertices: Uint8Array;
    indices: Uint32Array;
    aabbMin: [number, number, number];
    aabbMax: [number, number, number];
    /**
     * The bind pose, one 4x4 per joint, in the order the `Joints` channel indexes.
     * It lives with the vertices because those indices point AT it — split apart,
     * a file's indices would name something it does not carry. Absent for
     * geometry that is not skinned.
     */
    inverseBindMatrices?: Float32Array;
    /**
     * The shapes this geometry can be blended towards. Like the bind pose, it
     * lives with the vertices because it is indexed BY them — one delta per
     * vertex per target, so a file carrying the two apart could not say which
     * vertex a delta moves.
     */
    morph?: MeshMorphTargets;
    /** The levels of detail a view picks clusters from. Absent for a mesh drawn whole. */
    clusters?: MeshClusters;
    /**
     * The skin split into chunks, each drawn on its own with the bones it names: absent when one draw can pose the whole
     * skin. With chunks, the `Joints` channel indexes the vertex's chunk's bones, not the bind matrices.
     */
    skinChunks?: MeshSkinChunks;
}

/**
 * The pieces a skinned mesh is drawn in, when its bones are more than one draw can carry. Each
 * is a run of the mesh's indices whose vertices are moved only by the chunk's bones, at most {@link MESH_MAX_BONES} of
 * them; a vertex two chunks share is written once in each.
 */
export interface MeshSkinChunks {
    /** Two per chunk: its first index and how many indices it has. Together they cover the indices in order. */
    ranges: Uint32Array;
    /** How many bones each chunk names. */
    boneCounts: Uint16Array;
    /** Each chunk's bones in turn, as indices into the bind matrices: a vertex's joint `k` is its chunk's `k`-th bone. */
    bones: Uint16Array;
}

/** Bytes one component of a channel type occupies. */
export function componentBytes(type: number): number {
    if (type === MeshChannelType.UNorm8 || type === MeshChannelType.UInt8) return 1;
    if (type === MeshChannelType.UInt16 || type === MeshChannelType.UNorm16) return 2;
    return 4;
}

/**
 * Byte size of one vertex for these channels, laid out in the order given.
 *
 * Rounded up to 4 so every channel starts aligned: WebGL rejects a float
 * attribute at an unaligned offset, and a colour packed between two of them is
 * exactly how that happens.
 */
export function packChannels(semantics: { semantic: number; components: number; type: number }[]): {
    channels: MeshChannelDesc[];
    vertexStride: number;
} {
    const channels: MeshChannelDesc[] = [];
    let offset = 0;
    for (const s of semantics) {
        channels.push({ ...s, offset });
        offset += s.components * componentBytes(s.type);
        offset = (offset + 3) & ~3;
    }
    return { channels, vertexStride: offset };
}

/** Bytes the target names occupy: each carries its own length, the whole padded
 *  to 4 so the deltas behind it start where a float may be written. */
function morphNameBytes(names: Uint8Array[]): number {
    return (names.reduce((n, b) => n + 2 + b.length, 0) + 3) & ~3;
}

export function encodeMesh(data: MeshData): Uint8Array {
    const jointCount = (data.inverseBindMatrices?.length ?? 0) / 16;
    const names = (data.morph?.names ?? []).map(n => new TextEncoder().encode(n));
    const nameBytes = morphNameBytes(names);
    const deltaFloats = data.morph?.deltas.length ?? 0;
    // Narrowed whenever it loses nothing: an index file is a tenth of a mesh, and the
    // meshes with more than 65536 vertices stay on the version every reader knows.
    const narrow = fitsU16(data.indices);
    const indexBytes = narrow ? 2 : 4;
    const clusters = data.clusters;
    const clusterCount = clusters ? clusters.ranges.length / 2 : 0;
    const clusterBytes = clusters ? 8 + clusterCount * CLUSTER_BYTES + clusters.coarseIndices.length * 4 : 0;
    const chunks = data.skinChunks;
    const chunkCount = chunks ? chunks.boneCounts.length : 0;
    const chunkBytes = chunks ? 8 + chunkCount * SKIN_CHUNK_BYTES + ((chunks.bones.length * 2 + 3) & ~3) : 0;
    const size = HEADER_BYTES + data.channels.length * CHANNEL_BYTES
        + data.vertexCount * data.vertexStride + data.indices.length * indexBytes
        + jointCount * MATRIX_BYTES + nameBytes + deltaFloats * 4 + clusterBytes + chunkBytes;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);

    view.setUint32(0, MAGIC, true);
    // The oldest version that can say what this mesh carries, so a reader that predates a section reads a mesh without one.
    view.setUint16(4, chunks ? VERSION : clusters ? VERSION_NO_SKIN_CHUNKS : narrow ? VERSION_NO_CLUSTERS : VERSION_U32_INDICES, true);
    view.setUint16(6, data.channels.length, true);
    view.setUint32(8, data.vertexStride, true);
    view.setUint32(12, data.vertexCount, true);
    view.setUint32(16, data.indices.length, true);
    for (let i = 0; i < 3; i++) {
        view.setFloat32(20 + i * 4, data.aabbMin[i], true);
        view.setFloat32(32 + i * 4, data.aabbMax[i], true);
    }
    view.setUint32(44, jointCount, true);
    view.setUint16(48, names.length, true);
    view.setUint16(50, (data.morph?.hasNormals ? FLAG_MORPH_NORMALS : 0) | (narrow ? FLAG_U16_INDICES : 0)
        | (clusters ? FLAG_CLUSTERS : 0) | (chunks ? FLAG_SKIN_CHUNKS : 0), true);
    view.setUint32(52, nameBytes, true);

    let at = HEADER_BYTES;
    for (const c of data.channels) {
        view.setUint8(at, c.semantic);
        view.setUint8(at + 1, c.components);
        view.setUint8(at + 2, c.type);
        view.setUint8(at + 3, isNormalizedChannelType(c.type) ? 1 : 0);
        view.setUint32(at + 4, c.offset, true);
        at += CHANNEL_BYTES;
    }

    out.set(data.vertices.subarray(0, data.vertexCount * data.vertexStride), at);
    at += data.vertexCount * data.vertexStride;
    if (narrow) {
        for (let i = 0; i < data.indices.length; i++) view.setUint16(at + i * 2, data.indices[i]!, true);
    } else {
        out.set(new Uint8Array(data.indices.buffer, data.indices.byteOffset, data.indices.length * 4), at);
    }
    at += data.indices.length * indexBytes;
    if (data.inverseBindMatrices) {
        // Written through the DataView: the section's start is only 4-byte
        // aligned, and a Float32Array view on it may not be constructible.
        for (let i = 0; i < data.inverseBindMatrices.length; i++) {
            view.setFloat32(at + i * 4, data.inverseBindMatrices[i]!, true);
        }
    }
    at += jointCount * MATRIX_BYTES;
    if (data.morph) {
        let nameAt = at;
        for (const name of names) {
            view.setUint16(nameAt, name.length, true);
            out.set(name, nameAt + 2);
            nameAt += 2 + name.length;
        }
        at += nameBytes;
        for (let i = 0; i < data.morph.deltas.length; i++) {
            view.setFloat32(at + i * 4, data.morph.deltas[i]!, true);
        }
        at += deltaFloats * 4;
    }
    if (clusters) {
        view.setUint32(at, clusterCount, true);
        view.setUint32(at + 4, clusters.coarseIndices.length, true);
        at += 8;
        for (let c = 0; c < clusterCount; c++, at += CLUSTER_BYTES) {
            view.setUint32(at, clusters.ranges[c * 2]!, true);
            view.setUint32(at + 4, clusters.ranges[c * 2 + 1]!, true);
            for (let k = 0; k < MESH_CLUSTER_BOUNDS_FLOATS; k++) {
                view.setFloat32(at + 8 + k * 4, clusters.bounds[c * MESH_CLUSTER_BOUNDS_FLOATS + k]!, true);
            }
        }
        for (let i = 0; i < clusters.coarseIndices.length; i++) view.setUint32(at + i * 4, clusters.coarseIndices[i]!, true);
        at += clusters.coarseIndices.length * 4;
    }
    if (chunks) {
        view.setUint32(at, chunkCount, true);
        view.setUint32(at + 4, chunks.bones.length, true);
        at += 8;
        for (let c = 0; c < chunkCount; c++, at += SKIN_CHUNK_BYTES) {
            view.setUint32(at, chunks.ranges[c * 2]!, true);
            view.setUint32(at + 4, chunks.ranges[c * 2 + 1]!, true);
            view.setUint32(at + 8, chunks.boneCounts[c]!, true);
        }
        for (let i = 0; i < chunks.bones.length; i++) view.setUint16(at + i * 2, chunks.bones[i]!, true);
    }
    return out;
}

export function decodeMesh(bytes: Uint8Array): MeshData {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < HEADER_BYTES_V1 || view.getUint32(0, true) !== MAGIC) {
        throw new Error('not an .esmesh file');
    }
    const version = view.getUint16(4, true);
    // Refused rather than read leniently: a newer file's channel table may mean
    // something this build does not know, and a mesh drawn from a guess is a
    // wrong frame instead of an error.
    if (version > VERSION) {
        throw new Error(`.esmesh version ${version} is newer than this engine understands (${VERSION})`);
    }

    const channelCount = view.getUint16(6, true);
    // A semantic IS the shader location it binds to, and the per-object instance
    // block starts at location 8 — so an id outside the vocabulary collides with that
    // block: WebGPU rejects the pipeline, GL binds it and draws a wrong frame.
    if (channelCount > CHANNEL_SEMANTICS.size) {
        throw new Error(`.esmesh declares ${channelCount} channels; the format has ${CHANNEL_SEMANTICS.size}`);
    }
    const vertexStride = view.getUint32(8, true);
    const vertexCount = view.getUint32(12, true);
    const indexCount = view.getUint32(16, true);
    const aabbMin: [number, number, number] = [
        view.getFloat32(20, true), view.getFloat32(24, true), view.getFloat32(28, true)];
    const aabbMax: [number, number, number] = [
        view.getFloat32(32, true), view.getFloat32(36, true), view.getFloat32(40, true)];

    const headerBytes = version >= 3 ? HEADER_BYTES
        : version >= 2 ? HEADER_BYTES_V2 : HEADER_BYTES_V1;
    const jointCount = version >= 2 ? view.getUint32(44, true) : 0;
    const morphCount = version >= 3 ? view.getUint16(48, true) : 0;
    const flags = version >= 3 ? view.getUint16(50, true) : 0;
    const morphNormals = (flags & FLAG_MORPH_NORMALS) !== 0;
    const indexBytes = version > VERSION_U32_INDICES && (flags & FLAG_U16_INDICES) !== 0 ? 2 : 4;
    const nameBytes = version >= 3 ? view.getUint32(52, true) : 0;
    const morphComponents = morphNormals ? 6 : 3;

    const channels: MeshChannelDesc[] = [];
    let at = headerBytes;
    for (let i = 0; i < channelCount; i++) {
        const semantic = view.getUint8(at);
        if (!CHANNEL_SEMANTICS.has(semantic)) {
            throw new Error(`.esmesh channel ${i} has semantic ${semantic}, which the format does not define`);
        }
        channels.push({
            semantic,
            components: view.getUint8(at + 1),
            type: view.getUint8(at + 2),
            offset: view.getUint32(at + 4, true),
        });
        at += CHANNEL_BYTES;
    }

    const vertexBytes = vertexCount * vertexStride;
    const deltaFloats = morphCount * vertexCount * morphComponents;
    const expected = at + vertexBytes + indexCount * indexBytes + jointCount * MATRIX_BYTES
        + nameBytes + deltaFloats * 4;
    if (bytes.byteLength < expected) {
        throw new Error(`.esmesh is truncated: ${bytes.byteLength} bytes, header describes ${expected}`);
    }
    const vertices = bytes.subarray(at, at + vertexBytes);
    // Copied, not viewed: the index data is not guaranteed 4-byte aligned within
    // the file, and a Uint32Array view on an odd offset throws.
    const indices = new Uint32Array(indexCount);
    const indexBase = at + vertexBytes;
    if (indexBytes === 2) {
        for (let i = 0; i < indexCount; i++) indices[i] = view.getUint16(indexBase + i * 2, true);
    } else {
        for (let i = 0; i < indexCount; i++) indices[i] = view.getUint32(indexBase + i * 4, true);
    }

    const out: MeshData = { channels, vertexStride, vertexCount, vertices, indices, aabbMin, aabbMax };
    const bindBase = indexBase + indexCount * indexBytes;
    if (jointCount > 0) {
        const matrices = new Float32Array(jointCount * 16);
        for (let i = 0; i < matrices.length; i++) {
            matrices[i] = view.getFloat32(bindBase + i * 4, true);
        }
        out.inverseBindMatrices = matrices;
    }
    if (morphCount > 0) {
        const nameBase = bindBase + jointCount * MATRIX_BYTES;
        const names: string[] = [];
        let nameAt = nameBase;
        for (let i = 0; i < morphCount; i++) {
            const length = view.getUint16(nameAt, true);
            // Read against the section's own size rather than the file's: a length
            // that runs past it names bytes that belong to the deltas, and the
            // string that comes back would look like a target this mesh has.
            if (nameAt + 2 + length > nameBase + nameBytes) {
                throw new Error(`.esmesh morph target ${i} names ${length} bytes,`
                    + ' which runs past the name section');
            }
            names.push(new TextDecoder().decode(bytes.subarray(nameAt + 2, nameAt + 2 + length)));
            nameAt += 2 + length;
        }
        const deltaBase = nameBase + nameBytes;
        const deltas = new Float32Array(deltaFloats);
        for (let i = 0; i < deltas.length; i++) deltas[i] = view.getFloat32(deltaBase + i * 4, true);
        out.morph = { names, hasNormals: morphNormals, deltas };
    }
    // Where the next optional section starts: past the clusters when there are any.
    let tailAt = expected;
    if (version > VERSION_NO_CLUSTERS && (flags & FLAG_CLUSTERS) !== 0) {
        let clusterAt = expected;
        if (bytes.byteLength < clusterAt + 8) throw new Error('.esmesh is truncated: its cluster section has no header');
        const clusterCount = view.getUint32(clusterAt, true);
        const coarseCount = view.getUint32(clusterAt + 4, true);
        clusterAt += 8;
        if (bytes.byteLength < clusterAt + clusterCount * CLUSTER_BYTES + coarseCount * 4) {
            throw new Error(`.esmesh is truncated: ${clusterCount} clusters and ${coarseCount} indices do not fit in it`);
        }
        const ranges = new Uint32Array(clusterCount * 2);
        const bounds = new Float32Array(clusterCount * MESH_CLUSTER_BOUNDS_FLOATS);
        const total = indexCount + coarseCount;
        for (let c = 0; c < clusterCount; c++, clusterAt += CLUSTER_BYTES) {
            const first = view.getUint32(clusterAt, true), count = view.getUint32(clusterAt + 4, true);
            // Checked here, where the file is read: a run outside the indices would be assembled into a draw.
            if (first + count > total || count % 3 !== 0) {
                throw new Error(`.esmesh cluster ${c} names indices ${first}..${first + count} of ${total}`);
            }
            ranges[c * 2] = first;
            ranges[c * 2 + 1] = count;
            for (let k = 0; k < MESH_CLUSTER_BOUNDS_FLOATS; k++) {
                bounds[c * MESH_CLUSTER_BOUNDS_FLOATS + k] = view.getFloat32(clusterAt + 8 + k * 4, true);
            }
        }
        const coarseIndices = new Uint32Array(coarseCount);
        for (let i = 0; i < coarseCount; i++) coarseIndices[i] = view.getUint32(clusterAt + i * 4, true);
        out.clusters = { coarseIndices, ranges, bounds };
        tailAt = clusterAt + coarseCount * 4;
    }
    if (version > VERSION_NO_SKIN_CHUNKS && (flags & FLAG_SKIN_CHUNKS) !== 0) {
        out.skinChunks = readSkinChunks(view, tailAt, indexCount, jointCount);
    }
    return out;
}

/** The chunk table at `at`, checked against the indices and bones it names. */
function readSkinChunks(view: DataView, at: number, indexCount: number, jointCount: number): MeshSkinChunks {
    if (view.byteLength < at + 8) throw new Error('.esmesh is truncated: its skin chunk section has no header');
    const count = view.getUint32(at, true);
    const boneTotal = view.getUint32(at + 4, true);
    at += 8;
    if (view.byteLength < at + count * SKIN_CHUNK_BYTES + boneTotal * 2) {
        throw new Error(`.esmesh is truncated: ${count} skin chunks and ${boneTotal} bones do not fit in it`);
    }
    const ranges = new Uint32Array(count * 2);
    const boneCounts = new Uint16Array(count);
    let next = 0, bones = 0;
    for (let c = 0; c < count; c++, at += SKIN_CHUNK_BYTES) {
        const first = view.getUint32(at, true), length = view.getUint32(at + 4, true), named = view.getUint32(at + 8, true);
        // Runs that tile the indices in order, each a whole number of triangles, each a set of bones one draw can carry.
        if (first !== next || length === 0 || length % 3 !== 0 || named === 0 || named > MESH_MAX_BONES) {
            throw new Error(`.esmesh skin chunk ${c} names indices ${first}..${first + length} and ${named} bones`);
        }
        ranges[c * 2] = first;
        ranges[c * 2 + 1] = length;
        boneCounts[c] = named;
        next = first + length;
        bones += named;
    }
    if (next !== indexCount || bones !== boneTotal) {
        throw new Error(`.esmesh skin chunks cover ${next} of ${indexCount} indices and ${bones} of ${boneTotal} bones`);
    }
    const out = new Uint16Array(boneTotal);
    for (let i = 0; i < boneTotal; i++) {
        out[i] = view.getUint16(at + i * 2, true);
        if (out[i]! >= jointCount) throw new Error(`.esmesh skin chunk bone ${out[i]} is past the ${jointCount} joints`);
    }
    return { ranges, boneCounts, bones: out };
}

/** The channel table as the engine takes it: one 8-byte record per channel. */
export function encodeChannelTable(channels: MeshChannelDesc[]): Uint8Array {
    const out = new Uint8Array(channels.length * CHANNEL_BYTES);
    const view = new DataView(out.buffer);
    let at = 0;
    for (const c of channels) {
        view.setUint8(at, c.semantic);
        view.setUint8(at + 1, c.components);
        view.setUint8(at + 2, c.type);
        view.setUint8(at + 3, isNormalizedChannelType(c.type) ? 1 : 0);
        view.setUint32(at + 4, c.offset, true);
        at += CHANNEL_BYTES;
    }
    return out;
}
