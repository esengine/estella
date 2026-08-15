// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  glTF geometry → `.esmesh`.
 *
 *        An import, not a cook. A glTF holds MANY primitives, so it is a source
 *        that produces several engine assets rather than one file becoming
 *        another — which is what the cook step models. The products land on
 *        disk, where a project can see them, reference them and diff them, and
 *        the cook then ships them as the engine format they already are.
 */
import { MeshChannel, MeshChannelType, packChannels, encodeMesh, type MeshData } from 'esengine';

/** One primitive's worth of geometry, named for the file it will be written to. */
export interface ImportedMesh {
    /** `<file stem>` for a single primitive, `<stem>_<mesh>_<primitive>` otherwise. */
    name: string;
    data: MeshData;
    vertexCount: number;
    triangleCount: number;
}

export interface GltfImportResult {
    meshes: ImportedMesh[];
    /** What was skipped and why — a silent drop is how half a model goes missing. */
    warnings: string[];
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_BYTES: Record<number, number> = {
    5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};
const TYPE_COMPONENTS: Record<string, number> = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

interface GltfJson {
    accessors?: {
        bufferView?: number; byteOffset?: number; componentType: number; count: number;
        type: string; normalized?: boolean; min?: number[]; max?: number[];
    }[];
    bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
    buffers?: { byteLength: number; uri?: string }[];
    meshes?: { name?: string; primitives: {
        attributes: Record<string, number>; indices?: number; mode?: number;
    }[] }[];
}

/** Splits a `.glb` container into its JSON and binary chunks. */
function parseGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a .glb container');
    let at = 12;
    let json: GltfJson | null = null;
    let bin: Uint8Array | null = null;
    while (at + 8 <= bytes.byteLength) {
        const length = view.getUint32(at, true);
        const kind = view.getUint32(at + 4, true);
        const body = bytes.subarray(at + 8, at + 8 + length);
        if (kind === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
        else if (kind === CHUNK_BIN) bin = body;
        at += 8 + length + ((4 - (length % 4)) % 4);
    }
    if (!json) throw new Error('.glb has no JSON chunk');
    return { json, bin };
}

function decodeDataUri(uri: string): Uint8Array | null {
    const comma = uri.indexOf(',');
    if (!uri.startsWith('data:') || comma < 0) return null;
    return Uint8Array.from(Buffer.from(uri.slice(comma + 1), 'base64'));
}

/**
 * Reads one accessor as floats. Byte stride is honoured — an interleaved glTF is
 * the common export, and reading it as tightly packed yields wrong vertices
 * rather than an error. Normalized integers are scaled per spec, so a COLOR_0
 * stored as u8 arrives as 0..1 like a float one.
 */
function readAccessor(json: GltfJson, bin: Uint8Array | null, buffers: (Uint8Array | null)[],
                      index: number): Float32Array {
    const acc = json.accessors?.[index];
    if (!acc) throw new Error(`accessor ${index} is missing`);
    const comps = TYPE_COMPONENTS[acc.type];
    if (!comps) throw new Error(`accessor ${index} has unsupported type ${acc.type}`);
    const compBytes = COMPONENT_BYTES[acc.componentType];
    if (!compBytes) throw new Error(`accessor ${index} has unsupported componentType ${acc.componentType}`);

    const out = new Float32Array(acc.count * comps);
    if (acc.bufferView === undefined) return out;  // spec: absent view ⇒ zeroes

    const view = json.bufferViews?.[acc.bufferView];
    if (!view) throw new Error(`bufferView ${acc.bufferView} is missing`);
    const source = view.buffer === 0 && bin ? bin : buffers[view.buffer];
    if (!source) throw new Error(`buffer ${view.buffer} has no bytes (external .bin not loaded?)`);

    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : comps * compBytes;
    const dv = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const scale = acc.normalized ? normalizedScale(acc.componentType) : 0;

    for (let i = 0; i < acc.count; i++) {
        for (let c = 0; c < comps; c++) {
            const at = base + i * stride + c * compBytes;
            const raw = readComponent(dv, at, acc.componentType);
            out[i * comps + c] = acc.normalized ? raw * scale : raw;
        }
    }
    return out;
}

function normalizedScale(componentType: number): number {
    switch (componentType) {
        case 5120: return 1 / 127;
        case 5121: return 1 / 255;
        case 5122: return 1 / 32767;
        case 5123: return 1 / 65535;
        default: return 1;
    }
}

function readComponent(dv: DataView, at: number, componentType: number): number {
    switch (componentType) {
        case 5120: return dv.getInt8(at);
        case 5121: return dv.getUint8(at);
        case 5122: return dv.getInt16(at, true);
        case 5123: return dv.getUint16(at, true);
        case 5125: return dv.getUint32(at, true);
        default: return dv.getFloat32(at, true);
    }
}

/**
 * A glTF's triangle geometry as `.esmesh` payloads. NORMALS ARE DELIBERATELY
 * SKIPPED: WebGPU rejects a pipeline whose vertex layout declares an attribute
 * the shader does not consume, and none reads normals until there is lighting.
 * The format already describes them, so enabling them is a change here.
 *
 * @param bytes The `.gltf` (JSON) or `.glb` (container) file.
 * @param stem  Base name for the products.
 * @param externalBuffers Resolver for `buffers[].uri` that are not data URIs.
 */
export function importGltfMeshes(
    bytes: Uint8Array, stem: string,
    externalBuffers?: (uri: string) => Uint8Array | null,
): GltfImportResult {
    const warnings: string[] = [];
    let json: GltfJson;
    let bin: Uint8Array | null = null;

    const looksBinary = bytes.byteLength >= 4
        && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC;
    if (looksBinary) {
        ({ json, bin } = parseGlb(bytes));
    } else {
        json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    }

    const buffers: (Uint8Array | null)[] = (json.buffers ?? []).map((b, i) => {
        if (!b.uri) return i === 0 ? bin : null;
        const inline = decodeDataUri(b.uri);
        if (inline) return inline;
        const external = externalBuffers?.(b.uri) ?? null;
        if (!external) warnings.push(`buffer ${i}: ${b.uri} could not be read`);
        return external;
    });

    const meshes: ImportedMesh[] = [];
    const single = (json.meshes ?? []).reduce((n, m) => n + m.primitives.length, 0) === 1;

    (json.meshes ?? []).forEach((mesh, meshIndex) => {
        mesh.primitives.forEach((prim, primIndex) => {
            const label = mesh.name ? `${mesh.name}[${primIndex}]` : `mesh ${meshIndex}[${primIndex}]`;
            const mode = prim.mode ?? 4;
            if (mode !== 4) {
                warnings.push(`${label}: mode ${mode} is not TRIANGLES — skipped`);
                return;
            }
            const posIndex = prim.attributes.POSITION;
            if (posIndex === undefined) {
                warnings.push(`${label}: no POSITION — skipped`);
                return;
            }

            try {
                const positions = readAccessor(json, bin, buffers, posIndex);
                const vertexCount = positions.length / 3;
                const uvIndex = prim.attributes.TEXCOORD_0;
                const colorIndex = prim.attributes.COLOR_0;
                const uvs = uvIndex !== undefined ? readAccessor(json, bin, buffers, uvIndex) : null;
                const colorsRaw = colorIndex !== undefined
                    ? readAccessor(json, bin, buffers, colorIndex) : null;
                const colorComps = colorIndex !== undefined
                    ? TYPE_COMPONENTS[json.accessors?.[colorIndex]?.type ?? 'VEC4'] ?? 4 : 4;

                const indices = prim.indices !== undefined
                    ? Uint32Array.from(readAccessor(json, bin, buffers, prim.indices))
                    : Uint32Array.from({ length: vertexCount }, (_, i) => i);
                if (indices.length % 3 !== 0) {
                    warnings.push(`${label}: ${indices.length} indices is not a triangle list — skipped`);
                    return;
                }

                const { channels, vertexStride } = packChannels([
                    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
                    { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
                    { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
                ]);

                const vertices = new Uint8Array(vertexCount * vertexStride);
                const dv = new DataView(vertices.buffer);
                // The accessor's own min/max would do for POSITION, but it is
                // optional in the spec; measuring costs one pass and is always right.
                const min: [number, number, number] = [Infinity, Infinity, Infinity];
                const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
                for (let i = 0; i < vertexCount; i++) {
                    const at = i * vertexStride;
                    for (let c = 0; c < 3; c++) {
                        const v = positions[i * 3 + c] ?? 0;
                        dv.setFloat32(at + channels[0]!.offset + c * 4, v, true);
                        if (v < min[c]) min[c] = v;
                        if (v > max[c]) max[c] = v;
                    }
                    dv.setFloat32(at + channels[1]!.offset, uvs ? uvs[i * 2] ?? 0 : 0, true);
                    dv.setFloat32(at + channels[1]!.offset + 4, uvs ? uvs[i * 2 + 1] ?? 0 : 0, true);
                    for (let c = 0; c < 4; c++) {
                        const v = colorsRaw
                            ? (c < colorComps ? colorsRaw[i * colorComps + c] ?? 1 : 1)
                            : 1;
                        dv.setUint8(at + channels[2]!.offset + c, Math.max(0, Math.min(255, Math.round(v * 255))));
                    }
                }

                meshes.push({
                    name: single ? stem : `${stem}_${meshIndex}_${primIndex}`,
                    data: { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max },
                    vertexCount,
                    triangleCount: indices.length / 3,
                });
            } catch (err) {
                warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
    });

    if (meshes.length === 0 && warnings.length === 0) {
        warnings.push('no triangle geometry found');
    }
    return { meshes, warnings };
}

/** The bytes to write for an imported mesh. */
export function encodeImportedMesh(mesh: ImportedMesh): Uint8Array {
    return encodeMesh(mesh.data);
}
