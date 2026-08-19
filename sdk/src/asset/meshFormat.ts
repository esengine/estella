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
const VERSION = 2;
/** v1 had no joint count; a file that predates skinning reads with the shorter one. */
const HEADER_BYTES_V1 = 44;
const HEADER_BYTES = 48;
const CHANNEL_BYTES = 8;
/** One inverse bind matrix: 16 floats. */
const MATRIX_BYTES = 64;

/**
 * Joints one draw can be posed by — what the RENDERER holds (64 mat4 is 4KB,
 * inside WebGL2's guaranteed block), not what the format carries. A mesh bound
 * to more is drawn in its bind pose: a joint index no uploaded matrix answers
 * moves the vertex nowhere in particular. Mirrors GfxEnums.hpp.
 */
export const MESH_MAX_BONES = 64;

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
} as const;

/** How a channel's components are stored. Append only — serialized. */
/** Every id {@link MeshChannel} declares, for validating a file's channel table. */
const CHANNEL_SEMANTICS: ReadonlySet<number> = new Set(Object.values(MeshChannel));

export const MeshChannelType = {
    Float32: 0,
    UNorm8: 1,
    /** Joint indices: glTF writes them as u8 or u16, and u16 loses neither. */
    UInt16: 2,
} as const;

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
}

/** Bytes one component of a channel type occupies. */
function componentBytes(type: number): number {
    if (type === MeshChannelType.UNorm8) return 1;
    if (type === MeshChannelType.UInt16) return 2;
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

export function encodeMesh(data: MeshData): Uint8Array {
    const jointCount = (data.inverseBindMatrices?.length ?? 0) / 16;
    const size = HEADER_BYTES + data.channels.length * CHANNEL_BYTES
        + data.vertexCount * data.vertexStride + data.indices.length * 4
        + jointCount * MATRIX_BYTES;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);

    view.setUint32(0, MAGIC, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, data.channels.length, true);
    view.setUint32(8, data.vertexStride, true);
    view.setUint32(12, data.vertexCount, true);
    view.setUint32(16, data.indices.length, true);
    for (let i = 0; i < 3; i++) {
        view.setFloat32(20 + i * 4, data.aabbMin[i], true);
        view.setFloat32(32 + i * 4, data.aabbMax[i], true);
    }
    view.setUint32(44, jointCount, true);

    let at = HEADER_BYTES;
    for (const c of data.channels) {
        view.setUint8(at, c.semantic);
        view.setUint8(at + 1, c.components);
        view.setUint8(at + 2, c.type);
        view.setUint8(at + 3, c.type === MeshChannelType.UNorm8 ? 1 : 0);
        view.setUint32(at + 4, c.offset, true);
        at += CHANNEL_BYTES;
    }

    out.set(data.vertices.subarray(0, data.vertexCount * data.vertexStride), at);
    at += data.vertexCount * data.vertexStride;
    out.set(new Uint8Array(data.indices.buffer, data.indices.byteOffset, data.indices.length * 4), at);
    at += data.indices.length * 4;
    if (data.inverseBindMatrices) {
        // Written through the DataView: the section's start is only 4-byte
        // aligned, and a Float32Array view on it may not be constructible.
        for (let i = 0; i < data.inverseBindMatrices.length; i++) {
            view.setFloat32(at + i * 4, data.inverseBindMatrices[i]!, true);
        }
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

    const headerBytes = version >= 2 ? HEADER_BYTES : HEADER_BYTES_V1;
    const jointCount = version >= 2 ? view.getUint32(44, true) : 0;

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
    const expected = at + vertexBytes + indexCount * 4 + jointCount * MATRIX_BYTES;
    if (bytes.byteLength < expected) {
        throw new Error(`.esmesh is truncated: ${bytes.byteLength} bytes, header describes ${expected}`);
    }
    const vertices = bytes.subarray(at, at + vertexBytes);
    // Copied, not viewed: the index data is not guaranteed 4-byte aligned within
    // the file, and a Uint32Array view on an odd offset throws.
    const indices = new Uint32Array(indexCount);
    const indexBase = at + vertexBytes;
    for (let i = 0; i < indexCount; i++) indices[i] = view.getUint32(indexBase + i * 4, true);

    const out: MeshData = { channels, vertexStride, vertexCount, vertices, indices, aabbMin, aabbMax };
    if (jointCount > 0) {
        const base = indexBase + indexCount * 4;
        const matrices = new Float32Array(jointCount * 16);
        for (let i = 0; i < matrices.length; i++) matrices[i] = view.getFloat32(base + i * 4, true);
        out.inverseBindMatrices = matrices;
    }
    return out;
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
        view.setUint8(at + 3, c.type === MeshChannelType.UNorm8 ? 1 : 0);
        view.setUint32(at + 4, c.offset, true);
        at += CHANNEL_BYTES;
    }
    return out;
}
