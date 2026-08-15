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
    type PrefabComponentData as ComponentData,
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
    /** Tangent-space normal map; the engine derives its tangent frame per pixel. */
    normalTexture?: ImportedImageRef;
}

/** An image the glTF carries inline (GLB chunk or data uri), to be written beside the meshes. */
export interface ImportedTexture {
    /** `<stem>_<image index>.<ext>` — named for the source, since an inline image has no name. */
    name: string;
    bytes: Uint8Array;
}

/**
 * A node of the source's own hierarchy: where its geometry sits, and what hangs
 * off it. Without this every primitive of a model lands on the origin.
 */
export interface ImportedNode {
    /** The node's own index in the source, so a re-import addresses the same entity. */
    index: number;
    name: string;
    translation: [number, number, number];
    /** Quaternion, glTF's (x, y, z, w) order — the same components a Transform holds. */
    rotation: [number, number, number, number];
    scale: [number, number, number];
    /** Indices into @ref GltfImportResult.meshes; one node can draw several primitives. */
    meshes: number[];
    children: ImportedNode[];
}

export interface GltfImportResult {
    meshes: ImportedMesh[];
    /** Images extracted from the file itself; external ones stay where they are. */
    textures: ImportedTexture[];
    /** Every uri the source points OUT to (buffers and images), in file order.
     *  Bringing a model into a project means bringing these with it. */
    externalFiles: string[];
    /** The scene's node roots. Empty for a file with no nodes, whose meshes then sit flat. */
    nodes: ImportedNode[];
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

/** Per-spec sparse storage: a base of zeroes (or a view) with some values replaced. */
interface GltfSparse {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
}

interface GltfJson {
    accessors?: {
        bufferView?: number; byteOffset?: number; componentType: number; count: number;
        type: string; normalized?: boolean; min?: number[]; max?: number[];
        sparse?: GltfSparse;
    }[];
    bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
    buffers?: { byteLength: number; uri?: string }[];
    meshes?: { name?: string; primitives: {
        attributes: Record<string, number>; indices?: number; mode?: number; material?: number;
        extensions?: Record<string, unknown>;
    }[] }[];
    materials?: {
        name?: string;
        pbrMetallicRoughness?: {
            baseColorFactor?: number[]; baseColorTexture?: GltfTextureRef;
            metallicFactor?: number; roughnessFactor?: number;
            metallicRoughnessTexture?: GltfTextureRef;
        };
        normalTexture?: GltfTextureRef & { scale?: number };
        occlusionTexture?: GltfTextureRef;
        emissiveTexture?: GltfTextureRef; emissiveFactor?: number[];
        alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean;
        extensions?: Record<string, unknown>;
    }[];
    textures?: { source?: number; sampler?: number }[];
    images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
    nodes?: {
        name?: string; children?: number[]; mesh?: number;
        matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[];
    }[];
    scenes?: { nodes?: number[] }[];
    scene?: number;
}

/**
 * Extensions that hold a primitive's geometry themselves, so its accessors point
 * at nothing this importer can read. Left undetected they decode as zeroes — a
 * mesh whose every vertex sits on the origin, with nothing said about it.
 */
const COMPRESSED_GEOMETRY: Record<string, string> = {
    KHR_draco_mesh_compression: 'Draco',
    EXT_meshopt_compression: 'meshopt',
};

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
    const scale = acc.normalized ? normalizedScale(acc.componentType) : 0;
    const read = (dv: DataView, at: number): number => {
        const raw = readComponent(dv, at, acc.componentType);
        return acc.normalized ? raw * scale : raw;
    };

    if (acc.bufferView !== undefined) {
        const view = json.bufferViews?.[acc.bufferView];
        if (!view) throw new Error(`bufferView ${acc.bufferView} is missing`);
        const source = view.buffer === 0 && bin ? bin : buffers[view.buffer];
        if (!source) throw new Error(`buffer ${view.buffer} has no bytes (external .bin not loaded?)`);

        const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : comps * compBytes;
        const dv = new DataView(source.buffer, source.byteOffset, source.byteLength);
        for (let i = 0; i < acc.count; i++) {
            for (let c = 0; c < comps; c++) {
                out[i * comps + c] = read(dv, base + i * stride + c * compBytes);
            }
        }
    }
    // A sparse accessor overrides some of that — or all of it, since the base
    // view is optional. Ignoring it reads a mesh in its pre-morph state, which
    // is wrong geometry rather than a failure.
    if (acc.sparse) applySparse(json, bin, buffers, acc.sparse, comps, compBytes, read, out);
    return out;
}

function applySparse(json: GltfJson, bin: Uint8Array | null, buffers: (Uint8Array | null)[],
                     sparse: GltfSparse, comps: number, compBytes: number,
                     read: (dv: DataView, at: number) => number, out: Float32Array): void {
    const indexBytes = COMPONENT_BYTES[sparse.indices.componentType];
    if (!indexBytes) throw new Error(`sparse indices use componentType ${sparse.indices.componentType}`);
    const indexView = sliceBufferView(json, bin, buffers, sparse.indices.bufferView);
    const valueView = sliceBufferView(json, bin, buffers, sparse.values.bufferView);
    if (!indexView || !valueView) throw new Error('sparse accessor has no bytes');

    const iv = new DataView(indexView.buffer, indexView.byteOffset, indexView.byteLength);
    const vv = new DataView(valueView.buffer, valueView.byteOffset, valueView.byteLength);
    const indexBase = sparse.indices.byteOffset ?? 0;
    const valueBase = sparse.values.byteOffset ?? 0;
    for (let i = 0; i < sparse.count; i++) {
        const target = readComponent(iv, indexBase + i * indexBytes, sparse.indices.componentType);
        for (let c = 0; c < comps; c++) {
            out[target * comps + c] = read(vv, valueBase + (i * comps + c) * compBytes);
        }
    }
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
    // The engine has no strength on a normal map; a scaled one would be imported
    // at full strength, which is a different surface than the author saw.
    if (src.normalTexture?.scale !== undefined && src.normalTexture.scale !== 1) {
        unused.push(`normal-map scale ${src.normalTexture.scale}`);
    }
    if (src.occlusionTexture) unused.push('occlusion');
    if (src.emissiveTexture || (src.emissiveFactor ?? [0, 0, 0]).some(v => v !== 0)) unused.push('emissive');
    if (src.alphaMode === 'MASK') unused.push(`alpha cutoff ${src.alphaCutoff ?? 0.5}`);
    if (src.doubleSided === false) unused.push('single-sided (backfaces are not culled)');
    for (const name of Object.keys(src.extensions ?? {})) unused.push(name);
    if (unused.length > 0) ctx.warnings.push(`${label}: ${unused.join(', ')} not imported`);

    const texture = pbr.baseColorTexture
        ? readTexture(ctx, textureCache, pbr.baseColorTexture, label) : null;
    const normal = src.normalTexture
        ? readTexture(ctx, textureCache, src.normalTexture, label) : null;
    return {
        name: src.name ?? `material_${index}`,
        baseColor: [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, factor[3] ?? 1],
        ...(texture ? { baseColorTexture: texture } : {}),
        ...(normal ? { normalTexture: normal } : {}),
    };
}

type Trs = Pick<ImportedNode, 'translation' | 'rotation' | 'scale'>;

/**
 * A node's local transform. A glTF gives either TRS or a column-major matrix,
 * and the engine's Transform holds TRS — so a matrix is decomposed here rather
 * than a whole second placement path existing downstream.
 */
function nodeTrs(node: NonNullable<GltfJson['nodes']>[number]): Trs {
    if (!node.matrix || node.matrix.length !== 16) {
        const r = node.rotation ?? [0, 0, 0, 1];
        const t = node.translation ?? [0, 0, 0];
        const s = node.scale ?? [1, 1, 1];
        return {
            translation: [t[0] ?? 0, t[1] ?? 0, t[2] ?? 0],
            rotation: [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 1],
            scale: [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1],
        };
    }
    const m = node.matrix as number[];
    const at = (i: number): number => m[i] ?? 0;
    const column = (c: number): [number, number, number] => [at(c * 4), at(c * 4 + 1), at(c * 4 + 2)];
    const length = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2]) || 1;
    const cols = [column(0), column(1), column(2)];
    const scale: [number, number, number] = [length(cols[0]!), length(cols[1]!), length(cols[2]!)];
    // A mirrored matrix has a negative determinant, which no rotation can carry;
    // the convention is to give the sign to the first axis.
    const det = cols[0]![0] * (cols[1]![1] * cols[2]![2] - cols[1]![2] * cols[2]![1])
        - cols[1]![0] * (cols[0]![1] * cols[2]![2] - cols[0]![2] * cols[2]![1])
        + cols[2]![0] * (cols[0]![1] * cols[1]![2] - cols[0]![2] * cols[1]![1]);
    if (det < 0) scale[0] = -scale[0];

    const r = cols.map((c, i) => c.map(v => v / scale[i]!) as [number, number, number]);
    const [x0, y0, z0] = r[0]!, [x1, y1, z1] = r[1]!, [x2, y2, z2] = r[2]!;
    const trace = x0 + y1 + z2;
    let q: [number, number, number, number];
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        q = [(z1 - y2) / s, (x2 - z0) / s, (y0 - x1) / s, s / 4];
    } else if (x0 > y1 && x0 > z2) {
        const s = Math.sqrt(1 + x0 - y1 - z2) * 2;
        q = [s / 4, (x1 + y0) / s, (x2 + z0) / s, (z1 - y2) / s];
    } else if (y1 > z2) {
        const s = Math.sqrt(1 + y1 - x0 - z2) * 2;
        q = [(x1 + y0) / s, s / 4, (y2 + z1) / s, (x2 - z0) / s];
    } else {
        const s = Math.sqrt(1 + z2 - x0 - y1) * 2;
        q = [(x2 + z0) / s, (y2 + z1) / s, s / 4, (y0 - x1) / s];
    }
    return { translation: [at(12), at(13), at(14)], rotation: q, scale };
}

/**
 * The scene's node tree, carrying only what survives: a node whose primitives
 * were all skipped keeps its place, because its children hang off it.
 */
function readNodes(json: GltfJson, meshIndexOf: Map<string, number>,
                   warnings: string[]): ImportedNode[] {
    const source = json.nodes;
    if (!source || source.length === 0) return [];

    const roots = json.scenes?.[json.scene ?? 0]?.nodes
        ?? source.map((_, i) => i).filter(i => !source.some(n => n.children?.includes(i)));

    const visiting = new Set<number>();
    const build = (index: number): ImportedNode | null => {
        const node = source[index];
        if (!node || visiting.has(index)) {
            if (node) warnings.push(`node ${index} is its own ancestor — subtree skipped`);
            return null;
        }
        visiting.add(index);
        const meshes: number[] = [];
        if (node.mesh !== undefined) {
            const primitives = json.meshes?.[node.mesh]?.primitives ?? [];
            primitives.forEach((_, primIndex) => {
                const product = meshIndexOf.get(`${node.mesh}_${primIndex}`);
                if (product !== undefined) meshes.push(product);
            });
        }
        const children = (node.children ?? []).map(build).filter((n): n is ImportedNode => n !== null);
        visiting.delete(index);
        return { index, name: node.name ?? `node_${index}`, ...nodeTrs(node), meshes, children };
    };

    return roots.map(build).filter((n): n is ImportedNode => n !== null);
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

    const externalFiles: string[] = [];
    const noteExternal = (uri: string): void => {
        const decoded = decodeURIComponent(uri);
        if (!externalFiles.includes(decoded)) externalFiles.push(decoded);
    };

    const buffers: (Uint8Array | null)[] = (json.buffers ?? []).map((b, i) => {
        if (!b.uri) return i === 0 ? bin : null;
        const inline = decodeDataUri(b.uri);
        if (inline) return inline;
        noteExternal(b.uri);
        const external = externalBuffers?.(b.uri) ?? null;
        if (!external) warnings.push(`buffer ${i}: ${b.uri} could not be read`);
        return external;
    });
    for (const image of json.images ?? []) {
        if (image.uri && !image.uri.startsWith('data:')) noteExternal(image.uri);
    }

    const meshes: ImportedMesh[] = [];
    const textures: ImportedTexture[] = [];
    const meshIndexOf = new Map<string, number>();
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
            const compressed = Object.keys(prim.extensions ?? {})
                .find(name => name in COMPRESSED_GEOMETRY);
            if (compressed) {
                warnings.push(`${label}: geometry is ${COMPRESSED_GEOMETRY[compressed]}-compressed`
                    + ' — skipped (re-export without compression)');
                return;
            }
            for (const name of Object.keys(prim.extensions ?? {})) {
                if (!(name in COMPRESSED_GEOMETRY)) warnings.push(`${label}: ${name} not imported`);
            }
            const posIndex = prim.attributes.POSITION;
            if (posIndex === undefined) {
                warnings.push(`${label}: no POSITION — skipped`);
                return;
            }
            // Zeroes are a legal accessor per spec, and for POSITION they are a
            // heap of vertices on the origin. Say so instead of writing one.
            const posAccessor = json.accessors?.[posIndex];
            if (posAccessor && posAccessor.bufferView === undefined && !posAccessor.sparse) {
                warnings.push(`${label}: POSITION has no data — skipped`);
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

                meshIndexOf.set(`${meshIndex}_${primIndex}`, meshes.length);
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
    return {
        meshes, textures, externalFiles,
        nodes: readNodes(json, meshIndexOf, warnings), warnings,
    };
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

/** How the products go together. */
export interface PrefabAssembly {
    refs?: ProductRefs;
    /** The source's hierarchy; without it every mesh sits at the origin. */
    nodes?: ImportedNode[];
    /** Uniform scale on the root: a glTF is in metres, a world unit is a design pixel. */
    scale?: number;
}

function meshComponent(mesh: ImportedMesh, refs: ProductRefs): ComponentData {
    const prefix = refs.prefix ?? '';
    const ref = (image?: ImportedImageRef): string | null => image
        ? (image.external ? refs.external?.(image.file) ?? image.file : prefix + image.file)
        : null;
    const texture = ref(mesh.material?.baseColorTexture);
    // A normal map needs normals to perturb; without them the engine draws the
    // unlit variant and the map would be a reference to nothing.
    const hasNormals = mesh.data.channels.some(c => c.semantic === MeshChannel.Normal);
    const normalMap = hasNormals ? ref(mesh.material?.normalTexture) : null;
    const color = mesh.material?.baseColor;
    return { type: 'Mesh2D', data: {
        mesh: `${prefix}${mesh.name}.esmesh`,
        ...(texture ? { texture } : {}),
        ...(normalMap ? { normalMap } : {}),
        ...(color ? { color: { r: color[0], g: color[1], b: color[2], a: color[3] } } : {}),
        enabled: true,
    } };
}

/** Only what differs from a Transform's defaults, so a diff shows the placement. */
function transformComponent(trs?: Trs, scale?: number): ComponentData {
    const s = trs?.scale ?? [1, 1, 1];
    const k = scale ?? 1;
    const [x, y, z] = trs?.translation ?? [0, 0, 0];
    const [rx, ry, rz, rw] = trs?.rotation ?? [0, 0, 0, 1];
    return { type: 'Transform', data: {
        ...(x || y || z ? { position: { x, y, z } } : {}),
        ...(rx || ry || rz || rw !== 1 ? { rotation: { w: rw, x: rx, y: ry, z: rz } } : {}),
        ...(s[0] * k !== 1 || s[1] * k !== 1 || s[2] * k !== 1
            ? { scale: { x: s[0] * k, y: s[1] * k, z: s[2] * k } } : {}),
    } };
}

function entity(id: string, name: string, parent: string | null,
                components: ComponentData[]): PrefabEntityData {
    return { prefabEntityId: id, name, parent, children: [], visible: true, components };
}

/**
 * The import's assembly: where each piece of geometry sits, and which image and
 * tint it is drawn with. The products are separate files and nothing else
 * records how they go together, so without this a model arrives as a pile of
 * parts to be re-connected by hand.
 */
export function assembleGltfPrefab(name: string, meshes: ImportedMesh[],
                                   options: PrefabAssembly = {}): PrefabData {
    const refs = options.refs ?? {};
    const entities: PrefabEntityData[] = [];
    const nodes = options.nodes ?? [];

    const emitNode = (node: ImportedNode, parent: string | null, rootScale?: number): string => {
        const id = `n${node.index}`;
        const drawn = node.meshes.map(i => meshes[i]).filter((m): m is ImportedMesh => !!m);
        // One primitive rides the node itself; several cannot, since a Mesh2D
        // draws one mesh — they become its children, at its own origin.
        const own = drawn.length === 1 && drawn[0] ? [meshComponent(drawn[0], refs)] : [];
        const self = entity(id, node.name, parent,
                            [transformComponent(node, rootScale), ...own]);
        entities.push(self);
        if (own.length === 0) {
            drawn.forEach((mesh, i) => {
                const childId = `${id}_p${i}`;
                self.children.push(childId);
                entities.push(entity(childId, mesh.name, id,
                                     [transformComponent(), meshComponent(mesh, refs)]));
            });
        }
        for (const child of node.children) self.children.push(emitNode(child, id));
        return id;
    };

    if (nodes.length === 1 && nodes[0]) {
        emitNode(nodes[0], null, options.scale);
    } else if (nodes.length > 1) {
        // Several roots are one model all the same, so they get a holder to be
        // placed by — and it is where the import's own scale belongs.
        const root = entity('root', name, null, [transformComponent(undefined, options.scale)]);
        entities.push(root);
        for (const node of nodes) root.children.push(emitNode(node, 'root'));
    } else {
        // No node tree: the meshes are all there is to place.
        const root = entity('root', name, null, [transformComponent(undefined, options.scale)]);
        entities.push(root);
        meshes.forEach((mesh, i) => {
            const id = `m${i}`;
            root.children.push(id);
            entities.push(entity(id, mesh.name, 'root',
                                 [transformComponent(), meshComponent(mesh, refs)]));
        });
    }
    return {
        version: PREFAB_FORMAT_VERSION, name,
        rootEntityId: entities[0]!.prefabEntityId, entities,
    };
}
