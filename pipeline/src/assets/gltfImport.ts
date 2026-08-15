// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  glTF geometry and baseColor → `.esmesh`, images, and one `.esprefab`.
 *
 *        An import, not a cook. A glTF holds MANY primitives, so it is a source
 *        that produces several engine assets rather than one file becoming
 *        another — which is what the cook step models. The products land on
 *        disk, where a project can see them, reference them and diff them, and
 *        the cook then ships them as the engine format they already are.
 */
import {
    MeshChannel, MeshChannelType, packChannels, encodeMesh, PREFAB_FORMAT_VERSION,
    type MeshData, type PrefabData, type PrefabEntityData,
} from 'esengine';

/** One primitive's worth of geometry, named for the file it will be written to. */
export interface ImportedMesh {
    /** `<file stem>` for a single primitive, `<stem>_<mesh>_<primitive>` otherwise. */
    name: string;
    data: MeshData;
    vertexCount: number;
    triangleCount: number;
    /** The primitive's baseColor, absent when it names no material. */
    material?: ImportedMaterial;
}

/** Where a material's image comes from: a product this import writes, or a file already on disk. */
export interface ImportedImageRef {
    /** Product name (no directory) when written, else the glTF's own uri. */
    file: string;
    /** True for a uri the glTF points at — an existing file is referenced, never copied. */
    external: boolean;
}

/**
 * A glTF material in the terms a Mesh2D carries: the engine's mesh path is
 * `texture(uv) * vertexColor * tint`, which is what glTF calls baseColor. The
 * PBR channels around it have no consumer here and are reported, not dropped.
 */
export interface ImportedMaterial {
    name: string;
    /** baseColorFactor — the tint multiplied into the vertex colors. */
    baseColor: [number, number, number, number];
    baseColorTexture?: ImportedImageRef;
}

/** An image the glTF carries inline (GLB chunk or data uri), to be written beside the meshes. */
export interface ImportedTexture {
    /** `<stem>_<image index>.<ext>` — named for the source, since an inline image has no name. */
    name: string;
    bytes: Uint8Array;
}

export interface GltfImportResult {
    meshes: ImportedMesh[];
    /** Images extracted from the file itself; external ones stay where they are. */
    textures: ImportedTexture[];
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

interface GltfTextureRef { index: number; texCoord?: number }

interface GltfJson {
    accessors?: {
        bufferView?: number; byteOffset?: number; componentType: number; count: number;
        type: string; normalized?: boolean; min?: number[]; max?: number[];
    }[];
    bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
    buffers?: { byteLength: number; uri?: string }[];
    meshes?: { name?: string; primitives: {
        attributes: Record<string, number>; indices?: number; mode?: number; material?: number;
    }[] }[];
    materials?: {
        name?: string;
        pbrMetallicRoughness?: {
            baseColorFactor?: number[]; baseColorTexture?: GltfTextureRef;
            metallicFactor?: number; roughnessFactor?: number;
            metallicRoughnessTexture?: GltfTextureRef;
        };
        normalTexture?: GltfTextureRef; occlusionTexture?: GltfTextureRef;
        emissiveTexture?: GltfTextureRef; emissiveFactor?: number[];
        alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean;
        extensions?: Record<string, unknown>;
    }[];
    textures?: { source?: number; sampler?: number }[];
    images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
}

const MIME_EXTENSION: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/ktx2': '.ktx2',
};

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

/** A bufferView's bytes as they lie — an image chunk, not an attribute stream. */
function sliceBufferView(json: GltfJson, bin: Uint8Array | null, buffers: (Uint8Array | null)[],
                         index: number): Uint8Array | null {
    const view = json.bufferViews?.[index];
    if (!view) return null;
    const source = view.buffer === 0 && bin ? bin : buffers[view.buffer];
    if (!source) return null;
    const at = view.byteOffset ?? 0;
    return source.subarray(at, at + view.byteLength);
}

function dataUriMime(uri: string): string {
    const semi = uri.indexOf(';');
    const comma = uri.indexOf(',');
    const end = semi >= 0 && semi < comma ? semi : comma;
    return end > 5 ? uri.slice(5, end) : '';
}

interface MaterialContext {
    json: GltfJson;
    bin: Uint8Array | null;
    buffers: (Uint8Array | null)[];
    stem: string;
    textures: ImportedTexture[];
    warnings: string[];
}

/** Resolves a glTF texture index to the file a Mesh2D will sample, extracting inline images. */
function readTexture(ctx: MaterialContext, cache: Map<number, ImportedImageRef | null>,
                     ref: GltfTextureRef, label: string): ImportedImageRef | null {
    if (ref.texCoord) ctx.warnings.push(`${label}: TEXCOORD_${ref.texCoord} is not imported (one UV set)`);
    const cached = cache.get(ref.index);
    if (cached !== undefined) return cached;

    const resolve = (): ImportedImageRef | null => {
        const source = ctx.json.textures?.[ref.index]?.source;
        const image = source !== undefined ? ctx.json.images?.[source] : undefined;
        if (!image || source === undefined) {
            ctx.warnings.push(`${label}: texture ${ref.index} has no image — skipped`);
            return null;
        }
        // An image already on disk is REFERENCED, never copied: a second copy is
        // a second thing to keep in sync with the file the artist edits.
        if (image.uri && !image.uri.startsWith('data:')) {
            return { file: decodeURIComponent(image.uri), external: true };
        }
        const bytes = image.uri
            ? decodeDataUri(image.uri)
            : image.bufferView !== undefined
                ? sliceBufferView(ctx.json, ctx.bin, ctx.buffers, image.bufferView)
                : null;
        if (!bytes) {
            ctx.warnings.push(`${label}: image ${source} could not be read — skipped`);
            return null;
        }
        const mime = image.mimeType ?? (image.uri ? dataUriMime(image.uri) : '');
        const ext = MIME_EXTENSION[mime];
        if (!ext) {
            ctx.warnings.push(`${label}: image ${source} has unsupported type ${mime || '(none)'} — skipped`);
            return null;
        }
        const name = `${ctx.stem}_${source}${ext}`;
        if (!ctx.textures.some(t => t.name === name)) ctx.textures.push({ name, bytes });
        return { file: name, external: false };
    };

    const resolved = resolve();
    cache.set(ref.index, resolved);
    return resolved;
}

/**
 * One glTF material as the baseColor a Mesh2D can carry. Everything a PBR
 * material says beyond that — metal, roughness, emission, a normal map, an alpha
 * cutoff — has no consumer in this engine yet, so it is reported rather than
 * quietly lost.
 */
function readMaterial(ctx: MaterialContext, textureCache: Map<number, ImportedImageRef | null>,
                      index: number): ImportedMaterial {
    const src = ctx.json.materials?.[index] ?? {};
    const label = src.name ? `material "${src.name}"` : `material ${index}`;
    const pbr = src.pbrMetallicRoughness ?? {};
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];

    const unused: string[] = [];
    if (pbr.metallicRoughnessTexture || (pbr.metallicFactor ?? 1) !== 0 || (pbr.roughnessFactor ?? 1) !== 1) {
        unused.push('metallic-roughness');
    }
    if (src.normalTexture) unused.push('normal map');
    if (src.occlusionTexture) unused.push('occlusion');
    if (src.emissiveTexture || (src.emissiveFactor ?? [0, 0, 0]).some(v => v !== 0)) unused.push('emissive');
    if (src.alphaMode === 'MASK') unused.push(`alpha cutoff ${src.alphaCutoff ?? 0.5}`);
    if (src.doubleSided === false) unused.push('single-sided (backfaces are not culled)');
    for (const name of Object.keys(src.extensions ?? {})) unused.push(name);
    if (unused.length > 0) ctx.warnings.push(`${label}: ${unused.join(', ')} not imported`);

    const texture = pbr.baseColorTexture
        ? readTexture(ctx, textureCache, pbr.baseColorTexture, label) : null;
    return {
        name: src.name ?? `material_${index}`,
        baseColor: [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, factor[3] ?? 1],
        ...(texture ? { baseColorTexture: texture } : {}),
    };
}

/**
 * A glTF's triangle geometry as `.esmesh` payloads. NORMAL is carried when the
 * source has it: the engine then draws the mesh with its lit variant, and the
 * layout declares the channel only where a shader reads it — which is the rule
 * WebGPU enforces and the reason this is not written unconditionally.
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
    const textures: ImportedTexture[] = [];
    const single = (json.meshes ?? []).reduce((n, m) => n + m.primitives.length, 0) === 1;

    const materialCtx: MaterialContext = { json, bin, buffers, stem, textures, warnings };
    const textureCache = new Map<number, ImportedImageRef | null>();
    const materialCache = new Map<number, ImportedMaterial>();
    const materialFor = (index: number): ImportedMaterial => {
        let material = materialCache.get(index);
        if (!material) {
            material = readMaterial(materialCtx, textureCache, index);
            materialCache.set(index, material);
        }
        return material;
    };

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
                const normalIndex = prim.attributes.NORMAL;
                const normals = normalIndex !== undefined
                    ? readAccessor(json, bin, buffers, normalIndex) : null;
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
                    ...(normals ? [{ semantic: MeshChannel.Normal, components: 3,
                                     type: MeshChannelType.Float32 }] : []),
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
                    // V is flipped at this boundary: glTF puts uv (0,0) at the
                    // image's top-left, the engine's textures are uploaded
                    // bottom-up, and the two conventions each look right alone.
                    dv.setFloat32(at + channels[1]!.offset + 4,
                                  uvs ? 1 - (uvs[i * 2 + 1] ?? 0) : 0, true);
                    for (let c = 0; c < 4; c++) {
                        const v = colorsRaw
                            ? (c < colorComps ? colorsRaw[i * colorComps + c] ?? 1 : 1)
                            : 1;
                        dv.setUint8(at + channels[2]!.offset + c, Math.max(0, Math.min(255, Math.round(v * 255))));
                    }
                    if (normals && channels[3]) {
                        for (let c = 0; c < 3; c++) {
                            dv.setFloat32(at + channels[3].offset + c * 4, normals[i * 3 + c] ?? 0, true);
                        }
                    }
                }

                meshes.push({
                    name: single ? stem : `${stem}_${meshIndex}_${primIndex}`,
                    data: { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max },
                    vertexCount,
                    triangleCount: indices.length / 3,
                    ...(prim.material !== undefined ? { material: materialFor(prim.material) } : {}),
                });
            } catch (err) {
                warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
    });

    if (meshes.length === 0 && warnings.length === 0) {
        warnings.push('no triangle geometry found');
    }
    return { meshes, textures, warnings };
}

/** The bytes to write for an imported mesh. */
export function encodeImportedMesh(mesh: ImportedMesh): Uint8Array {
    return encodeMesh(mesh.data);
}

/** How a product is spelled where a component refers to it. */
export interface ProductRefs {
    /** Prepended to every product name, e.g. `assets/models/` — the project-relative dir. */
    prefix?: string;
    /** An external image uri (relative to the glTF) → the ref a component carries. */
    external?: (uri: string) => string;
}

function meshEntity(id: string, mesh: ImportedMesh, refs: ProductRefs,
                    parent: string | null): PrefabEntityData {
    const prefix = refs.prefix ?? '';
    const image = mesh.material?.baseColorTexture;
    const texture = image
        ? (image.external ? refs.external?.(image.file) ?? image.file : prefix + image.file)
        : null;
    const color = mesh.material?.baseColor;
    return {
        prefabEntityId: id,
        name: mesh.name,
        parent,
        children: [],
        visible: true,
        components: [
            { type: 'Transform', data: {} },
            { type: 'Mesh2D', data: {
                mesh: `${prefix}${mesh.name}.esmesh`,
                ...(texture ? { texture } : {}),
                ...(color ? { color: { r: color[0], g: color[1], b: color[2], a: color[3] } } : {}),
                enabled: true,
            } },
        ],
    };
}

/**
 * The import's assembly: which geometry is drawn with which image and tint. The
 * products are separate files and nothing else records how they go together, so
 * without this a model arrives as a pile of parts to be re-connected by hand.
 */
export function assembleGltfPrefab(name: string, meshes: ImportedMesh[],
                                   refs: ProductRefs = {}): PrefabData {
    // A single primitive needs no holder: the root IS the mesh, which is what a
    // scene wants to place. Several get one, since they are one model.
    const entities: PrefabEntityData[] = meshes.length === 1 && meshes[0]
        ? [meshEntity('0', meshes[0], refs, null)]
        : [
            {
                prefabEntityId: '0', name, parent: null, visible: true,
                children: meshes.map((_, i) => String(i + 1)),
                components: [{ type: 'Transform', data: {} }],
            },
            ...meshes.map((mesh, i) => meshEntity(String(i + 1), mesh, refs, '0')),
        ];
    return { version: PREFAB_FORMAT_VERSION, name, rootEntityId: '0', entities };
}
