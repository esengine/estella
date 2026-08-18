// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reads an FBX into what @ref modelImport writes, the same shape a glTF
 *        arrives as.
 *
 * FBX is a closed binary format with thirty years of dialects behind it, so the
 * parsing is ufbx's (vendored, built to wasm by tools/ufbx-wasm/build.mjs) and
 * what happens here is only the translation: ufbx's scene, already converted to
 * the engine's axes and units, becomes meshes, materials, nodes and timelines.
 *
 * The wasm hands over one self-describing blob — a JSON header plus a payload of
 * arrays — rather than a heap this side would walk. @ref tools/ufbx-wasm/bridge.c
 * is the other half of that contract.
 */
import { MeshChannel, MeshChannelType, packChannels } from 'esengine';
import {
    alignQuaternionSigns, animationProductName, ANIMATED_PATHS, disambiguateNodes,
    nodeChildPaths, nodeNameFor, samplerKeyframes, timelineDocument,
    type AnimatedNode, type ImportedAnimation, type ImportedImageRef, type ImportedMaterial,
    type ImportedMesh, type ImportedNode, type ImportedTexture, type ModelImportResult,
} from './modelImport';

/** A `[byteOffset, byteLength]` pair addressing the blob's payload. */
type Slice = [number, number];

interface FbxTextureRef {
    /** Index into @ref FbxScene.textures. */
    file: number;
    wrapU: number;
    wrapV: number;
    uvTransform: boolean;
}

interface FbxMaterialMap {
    value: number | number[];
    hasValue: boolean;
    texture: FbxTextureRef | null;
}

interface FbxMaterial {
    name: string;
    shader: number;
    pbr: boolean;
    twoSided: boolean;
    baseColor: FbxMaterialMap | null;
    baseFactor: FbxMaterialMap | null;
    roughness: FbxMaterialMap | null;
    glossiness: FbxMaterialMap | null;
    metalness: FbxMaterialMap | null;
    emissionColor: FbxMaterialMap | null;
    emissionFactor: FbxMaterialMap | null;
    opacity: FbxMaterialMap | null;
    normalMap: FbxMaterialMap | null;
    occlusion: FbxMaterialMap | null;
}

interface FbxNode {
    name: string;
    /** Index into @ref FbxScene.nodes, or -1 for the scene root. */
    parent: number;
    translation: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
    /** ufbx mesh id this node draws, or -1. */
    mesh: number;
    /** ufbx invented this node to hold a geometry transform or an inherit mode. */
    helper: boolean;
}

interface FbxMeshPart {
    name: string;
    /** ufbx mesh id — several parts of one mesh share it. */
    mesh: number;
    /** Which material run of that mesh this is. */
    part: number;
    /** Index into @ref FbxScene.materials, or -1. */
    material: number;
    vertexCount: number;
    positions: Slice;
    normals: Slice | null;
    uvs: Slice | null;
    colors: Slice | null;
    joints: Slice | null;
    weights: Slice | null;
    indices: Slice;
    /** Source node index per bone, in the order the `Joints` channel indexes them. */
    skinJoints?: number[];
    inverseBindMatrices?: Slice;
}

interface FbxTextureFile {
    /** Path relative to the FBX, separators already normalized. */
    filename: string;
    relativeFilename: string;
    /** Bytes the FBX carries for it, when it embeds them. */
    content: Slice | null;
}

interface FbxAnimationNode {
    node: number;
    translation: { times: Slice; values: Slice } | null;
    rotation: { times: Slice; values: Slice } | null;
    scale: { times: Slice; values: Slice } | null;
}

interface FbxAnimation {
    name: string;
    duration: number;
    nodes: FbxAnimationNode[];
}

interface FbxScene {
    fileFormat: number;
    creator: string;
    nodes: FbxNode[];
    meshes: FbxMeshPart[];
    materials: FbxMaterial[];
    textures: FbxTextureFile[];
    animations: FbxAnimation[];
    warnings: string[];
}

const BLOB_MAGIC = 0x42465345;
const BLOB_VERSION = 1;

/**
 * Runs the FBX through ufbx and splits the blob into its two halves. The wasm
 * wrapper stays OUT of every bundle (see the externals in desktop/vite.config.ts
 * and pipeline/bin/estella.mjs): it finds its `.wasm` beside itself on disk,
 * which bundling breaks.
 */
async function readScene(bytes: Uint8Array, filename: string):
    Promise<{ scene: FbxScene; payload: Uint8Array }> {
    const { readFbxScene } = await import('../../../build-tools/ufbx/reader.mjs');
    const blob = await readFbxScene(bytes, filename);

    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob.byteLength < 16 || view.getUint32(0, true) !== BLOB_MAGIC) {
        throw new Error('the FBX reader returned something that is not a scene blob');
    }
    if (view.getUint32(4, true) !== BLOB_VERSION) {
        throw new Error(`the FBX reader speaks blob version ${view.getUint32(4, true)},`
            + ` this importer speaks ${BLOB_VERSION} — rebuild build-tools/ufbx`);
    }
    const jsonLength = view.getUint32(8, true);
    const scene = JSON.parse(
        new TextDecoder().decode(blob.subarray(16, 16 + jsonLength))) as FbxScene;
    const payloadAt = 16 + jsonLength + ((4 - (jsonLength % 4)) % 4);
    return { scene, payload: blob.subarray(payloadAt) };
}

/** Payload readers. A slice is always 4-byte aligned, so these never copy. */
function floats(payload: Uint8Array, slice: Slice): Float32Array {
    return new Float32Array(payload.buffer, payload.byteOffset + slice[0], slice[1] / 4);
}

function uints(payload: Uint8Array, slice: Slice): Uint32Array {
    return new Uint32Array(payload.buffer, payload.byteOffset + slice[0], slice[1] / 4);
}

function ushorts(payload: Uint8Array, slice: Slice): Uint16Array {
    return new Uint16Array(payload.buffer, payload.byteOffset + slice[0], slice[1] / 2);
}

/* -- Textures ----------------------------------------------------------- */

/**
 * What an embedded image is, read from its own first bytes. An FBX says nothing
 * about the type of the blob it carries, and the extension a product is written
 * with is what decides whether anything can load it.
 */
function imageExtension(bytes: Uint8Array): string | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return '.png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45
        && bytes[10] === 0x42 && bytes[11] === 0x50) return '.webp';
    return null;
}

interface TextureContext {
    scene: FbxScene;
    payload: Uint8Array;
    stem: string;
    textures: ImportedTexture[];
    externalFiles: string[];
    warnings: string[];
    cache: Map<number, ImportedImageRef | null>;
}

const WRAP_REPEAT = 0;

/**
 * Resolves one texture reference to the file a draw will sample, extracting the
 * image when the FBX embeds it. An image already on disk is REFERENCED, never
 * copied: a second copy is a second thing to keep in sync with the file the
 * artist edits.
 */
function readTexture(ctx: TextureContext, ref: FbxTextureRef, label: string): ImportedImageRef | null {
    if (ref.uvTransform) {
        ctx.warnings.push(`${label}: a uv transform on its texture is not imported`
            + ' (uvs are sampled as authored)');
    }
    const cached = ctx.cache.get(ref.file);
    if (cached !== undefined) return withWrap(cached, ref, ctx, label);

    const resolved = resolveTexture(ctx, ref, label);
    ctx.cache.set(ref.file, resolved);
    return withWrap(resolved, ref, ctx, label);
}

/**
 * The wrapping the texture asked for, as an import setting. It rides the
 * REFERENCE rather than the file because two materials can sample one image
 * differently, and only one of them can win when the `.meta` is minted.
 */
function withWrap(image: ImportedImageRef | null, ref: FbxTextureRef,
                  ctx: TextureContext, label: string): ImportedImageRef | null {
    if (!image) return null;
    if (ref.wrapU !== ref.wrapV) {
        ctx.warnings.push(`${label}: its texture wraps u and v differently; using u`);
    }
    return { ...image, settings: { wrapMode: ref.wrapU === WRAP_REPEAT ? 'repeat' : 'clamp' } };
}

function resolveTexture(ctx: TextureContext, ref: FbxTextureRef,
                        label: string): ImportedImageRef | null {
    const file = ctx.scene.textures[ref.file];
    if (!file) {
        ctx.warnings.push(`${label}: texture ${ref.file} is missing — skipped`);
        return null;
    }
    if (file.content) {
        const bytes = ctx.payload.subarray(file.content[0], file.content[0] + file.content[1]);
        const ext = imageExtension(bytes) ?? extensionOf(file.filename);
        if (!ext) {
            ctx.warnings.push(`${label}: the embedded image "${file.filename}" is not a PNG,`
                + ' JPEG or WebP — skipped');
            return null;
        }
        const name = `${ctx.stem}_${ref.file}${ext}`;
        if (!ctx.textures.some(t => t.name === name)) {
            ctx.textures.push({ name, bytes: bytes.slice() });
        }
        return { file: name, external: false };
    }
    const path = file.filename || file.relativeFilename;
    if (!path) {
        ctx.warnings.push(`${label}: its texture names no file — skipped`);
        return null;
    }
    if (!ctx.externalFiles.includes(path)) ctx.externalFiles.push(path);
    return { file: path, external: true };
}

/** The extension an image path carries, when the engine can load it. */
function extensionOf(path: string): string | null {
    const match = /\.(png|jpg|jpeg|webp|ktx2)$/i.exec(path);
    if (!match) return null;
    const ext = match[0].toLowerCase();
    return ext === '.jpeg' ? '.jpg' : ext;
}

/* -- Materials ---------------------------------------------------------- */

/** A map's scalar value, or `fallback` where the file said nothing. */
function scalar(map: FbxMaterialMap | null, fallback: number): number {
    if (!map?.hasValue) return fallback;
    return typeof map.value === 'number' ? map.value : (map.value[0] ?? fallback);
}

function rgb(map: FbxMaterialMap | null, fallback: number): [number, number, number] {
    if (!map?.hasValue) return [fallback, fallback, fallback];
    const value = map.value;
    if (typeof value === 'number') return [value, value, value];
    return [value[0] ?? fallback, value[1] ?? fallback, value[2] ?? fallback];
}

/**
 * One FBX material as the two things that can carry it. ufbx has already mapped
 * whatever shading model the file used — Phong, Maya's Standard Surface, 3ds
 * Max's Physical, Blender's Principled — onto one set of PBR maps, so what is
 * left here is the engine's own reading of those.
 */
function readMaterial(ctx: TextureContext, source: FbxMaterial, index: number): ImportedMaterial {
    const label = source.name ? `material "${source.name}"` : `material ${index}`;
    const texture = (map: FbxMaterialMap | null): ImportedImageRef | null =>
        map?.texture ? readTexture(ctx, map.texture, label) : null;

    const base = rgb(source.baseColor, 1);
    const baseFactor = scalar(source.baseFactor, 1);
    // Opacity is a scalar in FBX and the alpha of a tint here. A map for it is
    // not the same thing — the engine reads alpha from the base color image —
    // so it is reported rather than bound to a sampler that would ignore it.
    const opacity = scalar(source.opacity, 1);
    if (source.opacity?.texture) {
        ctx.warnings.push(`${label}: its opacity map is not imported`
            + " (the engine reads alpha from the base color image's own channel)");
    }

    // A Phong or Lambert material has no metalness at all; reporting ufbx's
    // zero as a value the file gave would be inventing a surface. Its roughness
    // IS derived — from specular exponent — and that conversion is ufbx's.
    const metallic = source.pbr ? scalar(source.metalness, 0) : 0;
    const roughness = source.glossiness?.hasValue && !source.roughness?.hasValue
        ? 1 - scalar(source.glossiness, 0)
        : scalar(source.roughness, 1);

    const metalMap = source.metalness?.texture ?? null;
    const roughMap = source.roughness?.texture ?? null;
    // The engine samples ONE map packed glTF's way (roughness in green, metal in
    // blue), and FBX exporters normally write two separate images. There is no
    // single image to bind when they do, so the import says so.
    const packed = metalMap && roughMap && metalMap.file === roughMap.file
        ? readTexture(ctx, metalMap, label) : null;
    if (!packed && (metalMap || roughMap)) {
        ctx.warnings.push(`${label}: its separate metalness/roughness maps are not imported —`
            + ' the engine samples one image packed as glTF does (roughness in green, metal in'
            + ` blue); the constants ${metallic.toFixed(2)}/${roughness.toFixed(2)} are used instead`);
    }

    const emissionFactor = scalar(source.emissionFactor, 1);
    const emissionColor = rgb(source.emissionColor, 0);
    const emissive = emissionColor.map(v => v * emissionFactor) as [number, number, number];
    const emits = emissive.some(v => v > 0);

    const baseTexture = texture(source.baseColor);
    const normalTexture = texture(source.normalMap);
    const occlusionTexture = texture(source.occlusion);
    // An emissive map multiplied by black emits nothing, and binding it would be
    // a sampler read per pixel for a result that is always zero.
    const emissiveTexture = emits ? texture(source.emissionColor) : null;

    return {
        index,
        name: source.name || `material_${index}`,
        baseColor: [base[0] * baseFactor, base[1] * baseFactor, base[2] * baseFactor, opacity],
        // FBX has no alpha mode: a material is transparent when it says it is
        // less than fully opaque, and opaque otherwise.
        opaque: opacity >= 1,
        cullBackfaces: !source.twoSided,
        ...(baseTexture ? { baseColorTexture: baseTexture } : {}),
        ...(normalTexture ? { normalTexture } : {}),
        ...(emits ? { emissive } : {}),
        ...(emissiveTexture ? { emissiveTexture } : {}),
        ...(occlusionTexture ? { occlusionTexture, occlusionStrength: 1 } : {}),
        metallic,
        roughness,
        ...(packed ? { metallicRoughnessTexture: packed } : {}),
    };
}

/* -- Nodes -------------------------------------------------------------- */

const IDENTITY_TRS = (node: FbxNode): boolean =>
    node.translation.every(v => v === 0) && node.scale.every(v => v === 1)
    && node.rotation[0] === 0 && node.rotation[1] === 0 && node.rotation[2] === 0
    && Math.abs(node.rotation[3]) === 1;

/**
 * The scene's hierarchy as the prefab will hold it. ufbx's root node is the scene
 * itself rather than anything the artist made, so its children are the roots —
 * unless it carries a transform, since dropping one would move the whole model.
 */
function buildNodes(scene: FbxScene, meshIndexOf: Map<string, number[]>): ImportedNode[] {
    const childrenOf = new Map<number, number[]>();
    scene.nodes.forEach((node, index) => {
        if (node.parent < 0) return;
        const siblings = childrenOf.get(node.parent) ?? [];
        siblings.push(index);
        childrenOf.set(node.parent, siblings);
    });

    const build = (index: number): ImportedNode => {
        const node = scene.nodes[index]!;
        return {
            index,
            name: node.name || (node.helper ? 'Helper' : `node_${index}`),
            translation: node.translation,
            rotation: node.rotation,
            scale: node.scale,
            meshes: node.mesh >= 0 ? meshIndexOf.get(`${node.mesh}`) ?? [] : [],
            children: (childrenOf.get(index) ?? []).map(build),
        };
    };

    const root = scene.nodes[0];
    const roots = !root || (IDENTITY_TRS(root) && root.mesh < 0)
        ? (childrenOf.get(0) ?? []).map(build)
        : [build(0)];
    disambiguateNodes(roots);
    return roots;
}

/* -- Geometry ----------------------------------------------------------- */

/** One material run of one FBX mesh as the `.esmesh` payload it becomes. */
function buildMesh(part: FbxMeshPart, name: string, payload: Uint8Array,
                   material: ImportedMaterial | undefined): ImportedMesh {
    const positions = floats(payload, part.positions);
    const normals = part.normals ? floats(payload, part.normals) : null;
    const uvs = part.uvs ? floats(payload, part.uvs) : null;
    const colors = part.colors ? floats(payload, part.colors) : null;
    const joints = part.joints ? ushorts(payload, part.joints) : null;
    const weights = part.weights ? floats(payload, part.weights) : null;
    const indices = uints(payload, part.indices);
    const vertexCount = part.vertexCount;
    const skinned = !!(joints && weights && part.skinJoints?.length);

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
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
        const at = i * vertexStride;
        for (let c = 0; c < 3; c++) {
            const v = positions[i * 3 + c] ?? 0;
            dv.setFloat32(at + channels[0]!.offset + c * 4, v, true);
            if (v < min[c]!) min[c] = v;
            if (v > max[c]!) max[c] = v;
        }
        // No v flip here, unlike glTF: FBX puts uv (0,0) at the image's BOTTOM
        // left, which is where the engine's textures start too.
        dv.setFloat32(at + channels[1]!.offset, uvs ? uvs[i * 2] ?? 0 : 0, true);
        dv.setFloat32(at + channels[1]!.offset + 4, uvs ? uvs[i * 2 + 1] ?? 0 : 0, true);
        for (let c = 0; c < 4; c++) {
            const v = colors ? colors[i * 4 + c] ?? 1 : 1;
            dv.setUint8(at + channels[2]!.offset + c,
                        Math.max(0, Math.min(255, Math.round(v * 255))));
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

    return {
        name,
        data: {
            channels, vertexStride, vertexCount,
            vertices, indices, aabbMin: min, aabbMax: max,
            ...(skinned && part.inverseBindMatrices
                ? { inverseBindMatrices: floats(payload, part.inverseBindMatrices).slice() }
                : {}),
        },
        vertexCount,
        triangleCount: indices.length / 3,
        ...(material ? { material } : {}),
        ...(skinned ? { skinJoints: part.skinJoints } : {}),
    };
}

/* -- Animation ---------------------------------------------------------- */

/**
 * The file's animation stacks as `.estimeline` documents. ufbx has already baked
 * them into TRS keyframes: FBX rotates in Euler angles around pivots the engine's
 * Transform has no field for, and reading those curves as authored would place a
 * limb where the source never put it.
 */
function buildAnimations(scene: FbxScene, payload: Uint8Array, nodes: ImportedNode[],
                         stem: string, warnings: string[]): ImportedAnimation[] {
    if (scene.animations.length === 0) return [];
    const paths = nodeChildPaths(nodes);

    const out: ImportedAnimation[] = [];
    for (const [index, animation] of scene.animations.entries()) {
        const name = animation.name || `animation_${index}`;
        const byNode = new Map<string, AnimatedNode>();

        for (const target of animation.nodes) {
            const path = paths.get(target.node);
            if (path === undefined) continue;
            const entry = byNode.get(path)
                ?? { node: nodeNameFor(nodes, target.node), channels: new Map() };
            for (const property of ['translation', 'rotation', 'scale'] as const) {
                const channel = target[property];
                const spec = ANIMATED_PATHS[property]!;
                if (!channel) continue;
                const times = floats(payload, channel.times);
                const values = floats(payload, channel.values);
                if (times.length === 0) continue;
                const frames = samplerKeyframes(times, values, spec.channels.length, 'linear');
                if (property === 'rotation') alignQuaternionSigns(frames);
                spec.channels.forEach((key, c) => entry.channels.set(key, frames[c]!));
            }
            if (entry.channels.size > 0) byNode.set(path, entry);
        }

        if (byNode.size === 0) {
            warnings.push(`${name}: no channel targets a node this import produced`);
            continue;
        }
        out.push({
            name: animationProductName(stem, name),
            document: timelineDocument(animation.duration, byNode),
        });
    }
    return out;
}

/* -- Import ------------------------------------------------------------- */

/**
 * An FBX's triangle geometry, materials, hierarchy and animation as the products
 * a project can reference.
 *
 * @param bytes    The `.fbx` file, binary or ASCII, any version ufbx reads.
 * @param stem     Base name for the products.
 * @param filename What the source is called, so a texture path stored relative
 *        to it resolves the way the file meant it to.
 */
export async function importFbxMeshes(bytes: Uint8Array, stem: string,
                                      filename = ''): Promise<ModelImportResult> {
    const { scene, payload } = await readScene(bytes, filename);
    const warnings = [...scene.warnings];
    const textures: ImportedTexture[] = [];
    const externalFiles: string[] = [];
    const ctx: TextureContext = {
        scene, payload, stem, textures, externalFiles, warnings, cache: new Map(),
    };

    const materialCache = new Map<number, ImportedMaterial>();
    const materialFor = (index: number): ImportedMaterial | undefined => {
        const source = scene.materials[index];
        if (!source) return undefined;
        let material = materialCache.get(index);
        if (!material) {
            material = readMaterial(ctx, source, index);
            materialCache.set(index, material);
        }
        return material;
    };

    // A node draws every part of its mesh, so the map holds a list — the same
    // relationship a glTF node has with its primitives.
    const meshIndexOf = new Map<string, number[]>();
    const single = scene.meshes.length === 1;
    const meshes: ImportedMesh[] = scene.meshes.map((part, index) => {
        const key = `${part.mesh}`;
        const products = meshIndexOf.get(key) ?? [];
        products.push(index);
        meshIndexOf.set(key, products);
        // An FBX mesh is often unnamed — the name is on the node that draws it —
        // so the product falls back to the source's own stem the way a glTF's
        // single primitive does.
        const name = single ? stem : `${stem}_${part.mesh}_${part.part}`;
        return buildMesh(part, name, payload, materialFor(part.material));
    });

    if (meshes.length === 0 && warnings.length === 0) {
        warnings.push('no triangle geometry found');
    }
    const nodes = buildNodes(scene, meshIndexOf);
    return {
        meshes, textures, externalFiles, nodes,
        animations: buildAnimations(scene, payload, nodes, stem, warnings),
        warnings,
    };
}
