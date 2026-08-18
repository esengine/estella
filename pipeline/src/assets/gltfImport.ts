// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reads a glTF into what @ref modelImport writes: geometry, materials,
 *        the node hierarchy and the animations.
 *
 *        An import, not a cook. A glTF holds MANY primitives, so it is a source
 *        that produces several engine assets rather than one file becoming
 *        another — which is what the cook step models. The products land on
 *        disk, where a project can see them, reference them and diff them, and
 *        the cook then ships them as the engine format they already are.
 */
/// <reference path="./draco3dgltf.d.ts" />
import { MESH_MAX_BONES, MeshChannel, MeshChannelType, packChannels } from 'esengine';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import {
    ANIMATED_PATHS, alignQuaternionSigns, animationProductName, disambiguateNodes,
    nodeChildPaths, nodeNameFor, samplerKeyframes, timelineDocument,
    type AnimatedNode, type ImportedAnimation, type ImportedImageRef, type ImportedMaterial,
    type ImportedMesh, type ImportedNode, type ImportedTexture, type ModelImportResult,
    type OutKeyframe, type Trs,
} from './modelImport';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_BYTES: Record<number, number> = {
    5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};
const TYPE_COMPONENTS: Record<string, number> = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

interface GltfTextureRef {
    index: number; texCoord?: number;
    /** How much of an occlusionTexture's shadowing applies (occlusionTextureInfo only). */
    strength?: number;
    /** KHR_texture_transform and friends: a uv rewrite this importer does not do. */
    extensions?: Record<string, unknown>;
}

/**
 * `EXT_meshopt_compression` on a bufferView: the view's bytes live compressed in
 * another buffer, and decoding one yields exactly the bytes the view declares —
 * so accessors, strides and every reader above are untouched by it.
 */
interface MeshoptView {
    buffer: number; byteOffset?: number; byteLength: number;
    byteStride: number; count: number; mode: string; filter?: string;
}

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
    bufferViews?: {
        buffer: number; byteOffset?: number; byteLength: number; byteStride?: number;
        extensions?: { EXT_meshopt_compression?: MeshoptView };
    }[];
    buffers?: {
        byteLength: number; uri?: string;
        /** A meshopt fallback buffer has no uri: nothing reads it once the views decode. */
        extensions?: { EXT_meshopt_compression?: { fallback?: boolean } };
    }[];
    meshes?: { name?: string; primitives: {
        attributes: Record<string, number>; indices?: number; mode?: number; material?: number;
        extensions?: { KHR_draco_mesh_compression?: DracoPrimitive } & Record<string, unknown>;
        /** Morph targets — shapes the runtime blends between; not imported. */
        targets?: unknown[];
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
    samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
    images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
    nodes?: {
        name?: string; children?: number[]; mesh?: number; skin?: number;
        matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[];
    }[];
    skins?: { name?: string; joints: number[]; inverseBindMatrices?: number; skeleton?: number }[];
    animations?: {
        name?: string;
        channels: { sampler: number; target: { node?: number; path: string } }[];
        samplers: { input: number; output: number; interpolation?: string }[];
    }[];
    scenes?: { nodes?: number[] }[];
    scene?: number;
}

/**
 * `KHR_draco_mesh_compression` on a primitive: the geometry is one compressed
 * blob holding every attribute, so unlike meshopt this is NOT a bufferView that
 * decodes in place — the accessors keep their count and type and lose their data.
 */
interface DracoPrimitive {
    bufferView: number;
    /** Attribute semantic → the id Draco knows it by (not an accessor index). */
    attributes: Record<string, number>;
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
 * Where a glTF's bytes live. Every reader goes through {@link viewBytes}, so a
 * view holding compressed bytes is decoded in one place and nothing above knows.
 */
interface GltfBytes {
    json: GltfJson;
    bin: Uint8Array | null;
    buffers: (Uint8Array | null)[];
    decoded: Map<number, Uint8Array | null>;
}

/** A whole buffer's bytes — the GLB chunk for buffer 0, else what was loaded. */
function bufferBytes(src: GltfBytes, index: number): Uint8Array | null {
    return (index === 0 && src.bin) ? src.bin : (src.buffers[index] ?? null);
}

/**
 * One bufferView's bytes, decompressed if it holds them that way. Offsets above
 * here are relative to what this returns, so a decoded view — which is its own
 * buffer starting at zero — needs no special case anywhere else.
 */
function viewBytes(src: GltfBytes, index: number): Uint8Array | null {
    const view = src.json.bufferViews?.[index];
    if (!view) return null;
    const packed = view.extensions?.EXT_meshopt_compression;
    if (packed) {
        if (!src.decoded.has(index)) src.decoded.set(index, decodeMeshopt(src, packed));
        return src.decoded.get(index) ?? null;
    }
    const source = bufferBytes(src, view.buffer);
    if (!source) return null;
    const at = view.byteOffset ?? 0;
    return source.subarray(at, at + view.byteLength);
}

/**
 * A meshopt-compressed view, expanded. `MeshoptDecoder.ready` is awaited before
 * any of this runs; the decoder itself is the upstream implementation rather
 * than a second reading of the format, which would decode wrong and say nothing.
 */
function decodeMeshopt(src: GltfBytes, packed: MeshoptView): Uint8Array | null {
    const source = bufferBytes(src, packed.buffer);
    if (!source) return null;
    const at = packed.byteOffset ?? 0;
    const out = new Uint8Array(packed.count * packed.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
        out, packed.count, packed.byteStride,
        source.subarray(at, at + packed.byteLength), packed.mode, packed.filter,
    );
    return out;
}

let dracoModule: Promise<DracoModule | null> | null = null;

/** The decoder, instantiated once per process — a wasm module per file would be
 *  most of the cost of importing one. */
function loadDraco(warnings: string[]): Promise<DracoModule | null> {
    dracoModule ??= import('draco3dgltf')
        .then(m => (m as unknown as { createDecoderModule(): Promise<DracoModule> }).createDecoderModule())
        .catch(() => null);
    return dracoModule.then((m) => {
        if (!m) warnings.push('the Draco decoder could not be loaded');
        return m;
    });
}

/**
 * The slice of the Draco decoder this import uses, typed here because the package
 * ships none. Loaded by dynamic import and kept OUT of the Electron-main bundle
 * (see its externals): it locates its wasm beside itself on disk, which bundling
 * breaks — the same shape as the KTX2 encoder the cook loads.
 */
interface DracoModule {
    Decoder: new () => DracoDecoder;
    DecoderBuffer: new () => { Init(bytes: Uint8Array, length: number): void };
    Mesh: new () => DracoMesh;
    TRIANGULAR_MESH: number;
    DT_FLOAT32: number;
    HEAPF32: { buffer: ArrayBuffer };
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    destroy(object: unknown): void;
}
interface DracoMesh { num_points(): number; num_faces(): number }
interface DracoAttribute { num_components(): number }
interface DracoDecoder {
    GetEncodedGeometryType(buffer: unknown): number;
    DecodeBufferToMesh(buffer: unknown, mesh: DracoMesh): { ok(): boolean; error_msg(): string };
    GetAttributeByUniqueId(mesh: DracoMesh, id: number): DracoAttribute | null;
    GetAttributeDataArrayForAllPoints(
        mesh: DracoMesh, attribute: DracoAttribute, type: number, byteLength: number, ptr: number): boolean;
    GetTrianglesUInt32Array(mesh: DracoMesh, byteLength: number, ptr: number): boolean;
}

/** One primitive's decoded geometry: every attribute Draco held, and its faces. */
interface DracoGeometry {
    attributes: Map<string, Float32Array>;
    indices: Uint32Array;
}

/**
 * Draco's blob for one primitive, expanded. Values come back as floats without
 * the glTF `normalized` scale applied — that stays the accessor's word, as it is
 * for uncompressed data, so a u8 COLOR_0 does not arrive 255× too bright.
 */
function decodeDraco(draco: DracoModule, bytes: Uint8Array, ext: DracoPrimitive): DracoGeometry {
    const decoder = new draco.Decoder();
    const buffer = new draco.DecoderBuffer();
    const mesh = new draco.Mesh();
    try {
        buffer.Init(bytes, bytes.byteLength);
        if (decoder.GetEncodedGeometryType(buffer) !== draco.TRIANGULAR_MESH) {
            throw new Error('the Draco blob is not a triangle mesh');
        }
        const status = decoder.DecodeBufferToMesh(buffer, mesh);
        if (!status.ok()) throw new Error(status.error_msg());

        const attributes = new Map<string, Float32Array>();
        for (const [semantic, id] of Object.entries(ext.attributes)) {
            const attribute = decoder.GetAttributeByUniqueId(mesh, id);
            if (!attribute) continue;
            attributes.set(semantic, readDracoArray(draco, decoder, mesh, attribute));
        }
        return { attributes, indices: readDracoIndices(draco, decoder, mesh) };
    } finally {
        // Every handle is wasm memory this side has to hand back, on the error
        // path too — an import that reports a bad file must not also leak it.
        draco.destroy(mesh);
        draco.destroy(buffer);
        draco.destroy(decoder);
    }
}

function readDracoArray(draco: DracoModule, decoder: DracoDecoder,
                        mesh: DracoMesh, attribute: DracoAttribute): Float32Array {
    const values = mesh.num_points() * attribute.num_components();
    const ptr = draco._malloc(values * 4);
    try {
        decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, draco.DT_FLOAT32, values * 4, ptr);
        return new Float32Array(draco.HEAPF32.buffer, ptr, values).slice();
    } finally {
        draco._free(ptr);
    }
}

function readDracoIndices(draco: DracoModule, decoder: DracoDecoder, mesh: DracoMesh): Uint32Array {
    const count = mesh.num_faces() * 3;
    const ptr = draco._malloc(count * 4);
    try {
        decoder.GetTrianglesUInt32Array(mesh, count * 4, ptr);
        return new Uint32Array(draco.HEAPF32.buffer, ptr, count).slice();
    } finally {
        draco._free(ptr);
    }
}

/**
 * Reads one accessor as floats. Byte stride is honoured — an interleaved glTF is
 * the common export, and reading it as tightly packed yields wrong vertices
 * rather than an error. Normalized integers are scaled per spec, so a COLOR_0
 * stored as u8 arrives as 0..1 like a float one.
 */
function readAccessor(src: GltfBytes, index: number): Float32Array {
    const json = src.json;
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
        const source = viewBytes(src, acc.bufferView);
        if (!source) throw new Error(`buffer ${view.buffer} has no bytes (external .bin not loaded?)`);

        const base = acc.byteOffset ?? 0;
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
    if (acc.sparse) applySparse(src, acc.sparse, comps, compBytes, read, out);
    return out;
}

function applySparse(src: GltfBytes, sparse: GltfSparse, comps: number, compBytes: number,
                     read: (dv: DataView, at: number) => number, out: Float32Array): void {
    const indexBytes = COMPONENT_BYTES[sparse.indices.componentType];
    if (!indexBytes) throw new Error(`sparse indices use componentType ${sparse.indices.componentType}`);
    const indexView = viewBytes(src, sparse.indices.bufferView);
    const valueView = viewBytes(src, sparse.values.bufferView);
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

function dataUriMime(uri: string): string {
    const semi = uri.indexOf(';');
    const comma = uri.indexOf(',');
    const end = semi >= 0 && semi < comma ? semi : comma;
    return end > 5 ? uri.slice(5, end) : '';
}

interface MaterialContext {
    src: GltfBytes;
    json: GltfJson;
    stem: string;
    textures: ImportedTexture[];
    warnings: string[];
}

const GL_NEAREST = 9728;
const WRAP_MODE: Record<number, 'repeat' | 'clamp' | 'mirror'> = {
    10497: 'repeat', 33071: 'clamp', 33648: 'mirror',
};

/**
 * A glTF sampler as the engine's own import settings. Only what it states is
 * carried: an absent field means the glTF asked for nothing, and the engine's
 * default is as good an answer as any.
 */
function readSampler(ctx: MaterialContext, index: number | undefined,
                     label: string): ImportedImageRef['settings'] {
    const sampler = index !== undefined ? ctx.json.samplers?.[index] : undefined;
    if (!sampler) return undefined;
    const out: NonNullable<ImportedImageRef['settings']> = {};
    if (sampler.magFilter !== undefined) {
        out.filterMode = sampler.magFilter === GL_NEAREST ? 'nearest' : 'linear';
    }
    // One wrap mode per texture here; a source that addresses u and v differently
    // has to lose one of them, so it says which rather than picking silently.
    if (sampler.wrapS !== undefined && sampler.wrapT !== undefined
        && sampler.wrapS !== sampler.wrapT) {
        ctx.warnings.push(`${label}: wrapS and wrapT differ; using wrapS`);
    }
    const wrap = WRAP_MODE[sampler.wrapS ?? sampler.wrapT ?? 0];
    if (wrap) out.wrapMode = wrap;
    return Object.keys(out).length > 0 ? out : undefined;
}

/** Resolves a glTF texture index to the file a Mesh2D will sample, extracting inline images. */
function readTexture(ctx: MaterialContext, cache: Map<number, ImportedImageRef | null>,
                     ref: GltfTextureRef, label: string): ImportedImageRef | null {
    if (ref.texCoord) ctx.warnings.push(`${label}: TEXCOORD_${ref.texCoord} is not imported (one UV set)`);
    for (const name of Object.keys(ref.extensions ?? {})) {
        ctx.warnings.push(`${label}: ${name} not imported (uvs are used as authored)`);
    }
    const cached = cache.get(ref.index);
    if (cached !== undefined) return cached;

    const resolve = (): ImportedImageRef | null => {
        const texture = ctx.json.textures?.[ref.index];
        const settings = readSampler(ctx, texture?.sampler, label);
        const withSettings = (r: ImportedImageRef): ImportedImageRef =>
            settings ? { ...r, settings } : r;
        const source = texture?.source;
        const image = source !== undefined ? ctx.json.images?.[source] : undefined;
        if (!image || source === undefined) {
            ctx.warnings.push(`${label}: texture ${ref.index} has no image — skipped`);
            return null;
        }
        // An image already on disk is REFERENCED, never copied: a second copy is
        // a second thing to keep in sync with the file the artist edits.
        if (image.uri && !image.uri.startsWith('data:')) {
            return withSettings({ file: decodeURIComponent(image.uri), external: true });
        }
        const bytes = image.uri
            ? decodeDataUri(image.uri)
            : image.bufferView !== undefined
                ? viewBytes(ctx.src, image.bufferView)
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
        return withSettings({ file: name, external: false });
    };

    const resolved = resolve();
    cache.set(ref.index, resolved);
    return resolved;
}

/**
 * One glTF material, read into the two things that can hold it (@ref
 * materialProducts).
 */
function readMaterial(ctx: MaterialContext, textureCache: Map<number, ImportedImageRef | null>,
                      index: number): ImportedMaterial {
    const src = ctx.json.materials?.[index] ?? {};
    const label = src.name ? `material "${src.name}"` : `material ${index}`;
    const pbr = src.pbrMetallicRoughness ?? {};
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];

    const unused: string[] = [];
    if (src.normalTexture?.scale !== undefined && src.normalTexture.scale !== 1) {
        unused.push(`normal-map scale ${src.normalTexture.scale}`);
    }
    for (const name of Object.keys(src.extensions ?? {})) unused.push(name);
    if (unused.length > 0) ctx.warnings.push(`${label}: ${unused.join(', ')} not imported`);

    const texture = pbr.baseColorTexture
        ? readTexture(ctx, textureCache, pbr.baseColorTexture, label) : null;
    const normal = src.normalTexture
        ? readTexture(ctx, textureCache, src.normalTexture, label) : null;
    const emissiveMap = src.emissiveTexture
        ? readTexture(ctx, textureCache, src.emissiveTexture, label) : null;
    const occlusionMap = src.occlusionTexture
        ? readTexture(ctx, textureCache, src.occlusionTexture, label) : null;
    const metalRoughMap = pbr.metallicRoughnessTexture
        ? readTexture(ctx, textureCache, pbr.metallicRoughnessTexture, label) : null;
    const emissive = src.emissiveFactor ?? (emissiveMap ? [1, 1, 1] : [0, 0, 0]);
    // glTF defaults both factors to 1 — a material that says nothing is a fully
    // rough metal, and writing that out is what makes a product say so.
    const metallic = pbr.metallicFactor ?? 1;
    const roughness = pbr.roughnessFactor ?? 1;
    return {
        index,
        name: src.name ?? `material_${index}`,
        baseColor: [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, factor[3] ?? 1],
        // A glTF is OPAQUE and single-sided unless it says otherwise, so a model
        // arrives occluding itself the way it was authored to. MASK is opaque
        // too — what it adds is the cutoff below.
        opaque: (src.alphaMode ?? 'OPAQUE') !== 'BLEND',
        cullBackfaces: src.doubleSided !== true,
        ...(texture ? { baseColorTexture: texture } : {}),
        ...(normal ? { normalTexture: normal } : {}),
        ...(emissive.some(v => v !== 0)
            ? { emissive: [emissive[0] ?? 0, emissive[1] ?? 0, emissive[2] ?? 0] as [number, number, number] }
            : {}),
        ...(emissiveMap ? { emissiveTexture: emissiveMap } : {}),
        ...(occlusionMap ? {
            occlusionTexture: occlusionMap,
            occlusionStrength: src.occlusionTexture?.strength ?? 1,
        } : {}),
        metallic,
        roughness,
        ...(metalRoughMap ? { metallicRoughnessTexture: metalRoughMap } : {}),
        ...(src.alphaMode === 'MASK' ? { alphaCutoff: src.alphaCutoff ?? 0.5 } : {}),
    };
}

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

    const built = roots.map(build).filter((n): n is ImportedNode => n !== null);
    disambiguateNodes(built);
    return built;
}

/**
 * A skin's inverse bind matrices, one 4x4 per joint. The accessor is optional
 * per spec and its absence means identity — a bind pose already at the origin,
 * not a missing one.
 */
function bindMatrices(src: GltfBytes, skin: NonNullable<GltfJson['skins']>[number],
                      warnings: string[]): Float32Array {
    const out = new Float32Array(skin.joints.length * 16);
    if (skin.inverseBindMatrices === undefined) {
        for (let j = 0; j < skin.joints.length; j++) {
            for (let c = 0; c < 4; c++) out[j * 16 + c * 5] = 1;
        }
        return out;
    }
    const read = readAccessor(src, skin.inverseBindMatrices);
    if (read.length < out.length) {
        warnings.push(`a skin declares ${skin.joints.length} joints but carries`
            + ` ${read.length / 16} bind matrices; the rest are identity`);
    }
    out.set(read.subarray(0, Math.min(read.length, out.length)));
    for (let j = read.length / 16; j < skin.joints.length; j++) {
        for (let c = 0; c < 4; c++) out[j * 16 + c * 5] = 1;
    }
    return out;
}

/** glTF's sampler interpolation → the engine's, which spells the same curves. */
const INTERPOLATION: Record<string, string> = {
    LINEAR: 'linear', STEP: 'step', CUBICSPLINE: 'hermite',
};

/**
 * A glTF animation as an `.estimeline` document. Channels are grouped per target
 * node, since a track drives one component on one entity and the runtime reads
 * and writes that component once per track.
 */
function readAnimations(json: GltfJson, src: GltfBytes, nodes: ImportedNode[],
                        stem: string, warnings: string[]): ImportedAnimation[] {
    const animations = json.animations ?? [];
    if (animations.length === 0) return [];
    const paths = nodeChildPaths(nodes);
    const skinned = new Set<number>();
    for (const [i, node] of (json.nodes ?? []).entries()) if (node.skin !== undefined) skinned.add(i);

    const out: ImportedAnimation[] = [];
    for (const [index, animation] of animations.entries()) {
        const name = animation.name || `animation_${index}`;
        // childPath -> property -> keyframes, so one node's channels form one track.
        const byNode = new Map<string, AnimatedNode>();
        let duration = 0;
        let drivesSkin = false;

        for (const channel of animation.channels ?? []) {
            const target = channel.target?.node;
            const spec = ANIMATED_PATHS[channel.target?.path ?? ''];
            if (target === undefined || !paths.has(target)) continue;
            if (!spec) {
                warnings.push(`${name}: "${channel.target?.path}" channels are not imported`
                    + ' (morph target weights need blend shapes)');
                continue;
            }
            const sampler = animation.samplers?.[channel.sampler];
            if (!sampler) continue;
            const times = readAccessor(src, sampler.input);
            const values = readAccessor(src, sampler.output);
            if (times.length === 0 || values.length === 0) continue;
            if (skinned.has(target)) drivesSkin = true;

            const comps = spec.channels.length;
            const frames = samplerKeyframes(times, values, comps,
                                            INTERPOLATION[sampler.interpolation ?? 'LINEAR'] ?? 'linear');
            if (spec.property === 'rotation') alignQuaternionSigns(frames);
            duration = Math.max(duration, times[times.length - 1] ?? 0);

            const path = paths.get(target)!;
            const entry = byNode.get(path)
                ?? { node: nodeNameFor(nodes, target), channels: new Map<string, OutKeyframe[]>() };
            spec.channels.forEach((property, c) => entry.channels.set(property, frames[c]!));
            byNode.set(path, entry);
        }

        if (byNode.size === 0) {
            warnings.push(`${name}: no channel targets a node this import produced`);
            continue;
        }
        // Not "skinning is missing" — it is here. A skinned mesh is placed by its
        // JOINTS, and glTF requires the mesh node's own transform to be ignored, so
        // a channel aimed at that node moves nothing at all.
        if (drivesSkin) {
            warnings.push(`${name}: animates a node that carries a skin, whose own transform is`
                + ' ignored (glTF requires it) — this channel moves nothing. Animate its joints.');
        }
        out.push({
            name: animationProductName(stem, name),
            document: timelineDocument(duration, byNode),
        });
    }
    return out;
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
export async function importGltfMeshes(
    bytes: Uint8Array, stem: string,
    externalBuffers?: (uri: string) => Uint8Array | null,
): Promise<ModelImportResult> {
    // Compressed views decode synchronously once this resolves; awaiting it
    // unconditionally keeps "is the decoder up" from being a per-file question.
    await MeshoptDecoder.ready;
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
        // A meshopt fallback buffer declares a length and no uri on purpose: the
        // views that name it decode from the compressed one instead.
        if (!b.uri) return i === 0 && !b.extensions?.EXT_meshopt_compression?.fallback ? bin : null;
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

    // Which skin deforms each mesh. A skin sits on the NODE, not the primitive,
    // so the geometry learns its bind pose from whatever draws it — and a mesh
    // drawn by two nodes under different skins can only carry one of them.
    const meshSkin = new Map<number, number>();
    for (const node of json.nodes ?? []) {
        if (node.mesh === undefined || node.skin === undefined) continue;
        const seen = meshSkin.get(node.mesh);
        if (seen === undefined) meshSkin.set(node.mesh, node.skin);
        else if (seen !== node.skin) {
            warnings.push(`mesh ${node.mesh} is drawn under two skins; it is bound to the first`);
        }
    }

    // ~800KB of decoder, loaded only for a file that carries Draco — the same
    // lazy dynamic import the cook uses for its KTX2 encoder, and the reason the
    // import is async in the first place.
    const draco = (json.meshes ?? []).some(m => m.primitives.some(p => p.extensions?.KHR_draco_mesh_compression))
        ? await loadDraco(warnings)
        : null;

    const src: GltfBytes = { json, bin, buffers, decoded: new Map() };
    const materialCtx: MaterialContext = { src, json, stem, textures, warnings };
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
            const packed = prim.extensions?.KHR_draco_mesh_compression;
            let geometry: DracoGeometry | null = null;
            if (packed) {
                const blob = viewBytes(src, packed.bufferView);
                if (!blob || !draco) {
                    warnings.push(`${label}: Draco geometry could not be read — skipped`);
                    return;
                }
                try {
                    geometry = decodeDraco(draco, blob, packed);
                } catch (err) {
                    warnings.push(`${label}: Draco decode failed (${(err as Error).message}) — skipped`);
                    return;
                }
            }
            for (const name of Object.keys(prim.extensions ?? {})) {
                if (name !== 'KHR_draco_mesh_compression') warnings.push(`${label}: ${name} not imported`);
            }
            // Deformation is the difference between a model that moves and one
            // that does not, so it is never dropped in silence.
            if (prim.targets?.length) {
                warnings.push(`${label}: ${prim.targets.length} morph target(s) not imported`);
            }
            const posIndex = prim.attributes.POSITION;
            if (posIndex === undefined) {
                warnings.push(`${label}: no POSITION — skipped`);
                return;
            }
            // Zeroes are a legal accessor per spec, and for POSITION they are a
            // heap of vertices on the origin. Say so instead of writing one. A
            // Draco accessor has no view BY spec — its data is in the blob.
            const posAccessor = json.accessors?.[posIndex];
            if (!geometry && posAccessor
                && posAccessor.bufferView === undefined && !posAccessor.sparse) {
                warnings.push(`${label}: POSITION has no data — skipped`);
                return;
            }

            try {
                // One reader for both storages. Draco hands over whole attribute
                // arrays, leaving each accessor to say what it MEANS — its type,
                // and whether its integers are normalized — as it always does.
                const attribute = (semantic: string, index: number | undefined): Float32Array | null => {
                    if (index === undefined) return null;
                    if (!geometry) return readAccessor(src, index);
                    const values = geometry.attributes.get(semantic);
                    if (!values) throw new Error(`${semantic} is missing from the Draco blob`);
                    const acc = json.accessors?.[index];
                    if (!acc?.normalized) return values;
                    const scale = normalizedScale(acc.componentType);
                    return values.map(v => v * scale);
                };
                const positions = attribute('POSITION', posIndex)!;
                const vertexCount = positions.length / 3;
                const uvIndex = prim.attributes.TEXCOORD_0;
                const colorIndex = prim.attributes.COLOR_0;
                const uvs = attribute('TEXCOORD_0', uvIndex);
                const normalIndex = prim.attributes.NORMAL;
                const normals = attribute('NORMAL', normalIndex);
                const colorsRaw = attribute('COLOR_0', colorIndex);
                const colorComps = colorIndex !== undefined
                    ? TYPE_COMPONENTS[json.accessors?.[colorIndex]?.type ?? 'VEC4'] ?? 4 : 4;

                const indices = geometry ? geometry.indices
                    : prim.indices !== undefined
                        ? Uint32Array.from(readAccessor(src, prim.indices))
                        : Uint32Array.from({ length: vertexCount }, (_, i) => i);
                if (indices.length % 3 !== 0) {
                    warnings.push(`${label}: ${indices.length} indices is not a triangle list — skipped`);
                    return;
                }

                // Both halves or neither: a joint index nothing weights moves the
                // vertex by an arbitrary bone, and a weight indexing nothing has
                // no bone to apply. A skin is what says which bind pose they mean.
                const skinIndex = meshSkin.get(meshIndex);
                const skin = skinIndex !== undefined ? json.skins?.[skinIndex] : undefined;
                // Joints past the pose block index a matrix nothing uploads, so
                // those vertices land somewhere arbitrary. Static is the honest
                // read, and the one JOINTS_0-without-WEIGHTS_0 already takes.
                const overBudget = (skin?.joints?.length ?? 0) > MESH_MAX_BONES;
                const joints = skin && !overBudget ? attribute('JOINTS_0', prim.attributes.JOINTS_0) : null;
                const weights = skin && !overBudget ? attribute('WEIGHTS_0', prim.attributes.WEIGHTS_0) : null;
                const skinned = !!(skin?.joints?.length && joints && weights);
                if (overBudget) {
                    warnings.push(`${label}: the skin binds ${skin!.joints.length} joints and one`
                        + ` draw can be posed by ${MESH_MAX_BONES} — imported static`);
                } else if (prim.attributes.JOINTS_0 !== undefined && !skinned) {
                    warnings.push(`${label}: JOINTS_0 without ${!skin?.joints?.length
                        ? 'a skin naming joints on any node drawing it' : 'WEIGHTS_0'}`
                        + ' — imported static');
                }

                const { channels, vertexStride } = packChannels([
                    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
                    { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
                    { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
                    ...(normals ? [{ semantic: MeshChannel.Normal, components: 3,
                                     type: MeshChannelType.Float32 }] : []),
                    ...(skinned ? [
                        { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16 },
                        { semantic: MeshChannel.Weights, components: 4, type: MeshChannelType.Float32 },
                    ] : []),
                ]);
                const jointsChannel = skinned ? channels[channels.length - 2]! : null;
                const weightsChannel = skinned ? channels[channels.length - 1]! : null;

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
                    if (jointsChannel && weightsChannel) {
                        for (let c = 0; c < 4; c++) {
                            dv.setUint16(at + jointsChannel.offset + c * 2, joints![i * 4 + c] ?? 0, true);
                            dv.setFloat32(at + weightsChannel.offset + c * 4, weights![i * 4 + c] ?? 0, true);
                        }
                    }
                }

                meshIndexOf.set(`${meshIndex}_${primIndex}`, meshes.length);
                meshes.push({
                    name: single ? stem : `${stem}_${meshIndex}_${primIndex}`,
                    data: {
                        channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max,
                        ...(skinned ? { inverseBindMatrices: bindMatrices(src, skin!, warnings) } : {}),
                    },
                    vertexCount,
                    triangleCount: indices.length / 3,
                    ...(prim.material !== undefined ? { material: materialFor(prim.material) } : {}),
                    ...(skinned ? { skinJoints: skin!.joints } : {}),
                });
            } catch (err) {
                warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
    });

    if (meshes.length === 0 && warnings.length === 0) {
        warnings.push('no triangle geometry found');
    }
    const nodes = readNodes(json, meshIndexOf, warnings);
    return {
        meshes, textures, externalFiles, nodes, warnings,
        animations: readAnimations(json, src, nodes, stem, warnings),
    };
}