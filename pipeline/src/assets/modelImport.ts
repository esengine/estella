// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a model becomes, and how its products go together — the half of
 *        the import that has nothing to do with the format it arrived in.
 *
 *        A reader (glTF, FBX) produces a {@link ModelImportResult}; everything
 *        below that — the `.esmesh` bytes, the `.esmaterial` documents, the
 *        `.estimeline` tracks and the `.esprefab` that assembles them — is
 *        written here, once. A second format that wrote its own would be a
 *        second set of rules for what a model IS in this engine.
 */
import {
    MeshChannel, MeshChannelType, encodeMesh, unwrapLightmapUV, PREFAB_FORMAT_VERSION, TIMELINE_FORMAT_VERSION,
    MATERIAL_FORMAT_VERSION, BlendMode, CullMode,
    type MeshData, type MaterialAssetData, type PrefabData, type PrefabEntityData,
    type PrefabComponentData as ComponentData,
} from 'esengine';
import { canSimplify, simplifyMesh, type SimplifierFlag } from './meshSimplify';
import { SPARSE_LIGHTMAP_UV, OVERLAPPING_LIGHTMAP_UV } from '../../../sdk/src/lightmap/atlas';
import type { CompoundColliderPart3D } from 'esengine/physics3d';

/** One primitive's worth of geometry, named for the file it will be written to. */
export interface ImportedMesh {
    /** `<file stem>` for a single primitive, `<stem>_<mesh>_<primitive>` otherwise. */
    name: string;
    data: MeshData;
    vertexCount: number;
    triangleCount: number;
    /** The primitive's baseColor, absent when it names no material. */
    material?: ImportedMaterial;
    /** Source node indices of the joints its `Joints` channel indexes, in order.
     *  Absent for geometry nothing skins. */
    skinJoints?: number[];
    /** The weight each morph target starts at, where the source states them. */
    morphWeights?: number[];
    /** Cheaper stand-ins, finest first, written as `<name>_lod<n>.esmesh` (@ref generateLods). */
    lods?: GeneratedLod[];
}

/** One cheaper level of a mesh, and the screen height below which it replaces the one above. */
export interface GeneratedLod {
    data: MeshData;
    triangleCount: number;
    /** Fraction of the viewport height — the unit a `LODGroup` threshold is in. */
    size: number;
}

/** Where a material's image comes from: a product this import writes, or a file already on disk. */
export interface ImportedImageRef {
    /** Product name (no directory) when written, else the source's own uri. */
    file: string;
    /** True for a uri the source points at — an existing file is referenced, never copied. */
    external: boolean;
    /** Import settings the source's sampler asks for, in the engine's own words.
     *  Absent where the source names no sampler (its defaults are the engine's). */
    settings?: {
        filterMode?: 'nearest' | 'linear'; wrapMode?: 'repeat' | 'clamp' | 'mirror'; sRGB?: boolean; mipCoverage?: number;
    };
}

/**
 * A material, split by what can carry it: baseColor is `texture(uv) *
 * vertexColor * tint`, which a MeshRenderer's own fields say, and the shading around
 * it becomes an `.esmaterial` (@ref materialProducts). What neither can express
 * is reported, not dropped.
 */
export interface ImportedMaterial {
    /** The source's own material index — what its product is named after. */
    index: number;
    name: string;
    /** The tint multiplied into the vertex colors. */
    baseColor: [number, number, number, number];
    /** KHR_materials_unlit: base colour and alpha only, independent of lighting. */
    unlit?: boolean;
    blendMode?: BlendMode;
    baseColorTexture?: ImportedImageRef;
    /** Tangent-space normal map, read against the mesh's own tangent frame where it has one (see meshTangents.ts). */
    normalTexture?: ImportedImageRef;
    /** Tangent-space X/Y scale, applied before renormalizing the sampled normal. */
    normalScale?: number;
    /** Light the surface makes, unaffected by the scene's lights. */
    emissive?: [number, number, number];
    emissiveTexture?: ImportedImageRef;
    /** Ambient occlusion in the map's red channel, scaled by @ref occlusionStrength. */
    occlusionTexture?: ImportedImageRef;
    /** Hair's strand-direction and highlight-shift maps, which glTF has no slot for: a material states them in its extras (`flow_map`, `shift_map`, paths from the model). */
    flowTexture?: ImportedImageRef;
    shiftTexture?: ImportedImageRef;
    /** How far in from the cutoff a hair card's edge fades (`extras.suggested_tipSoftness`). */
    tipSoftness?: number;
    occlusionStrength?: number;
    /** Where every map is read: the UV scaled, turned (radians) and moved — glTF's KHR_texture_transform, the Model shader's
     *  Tiling, Offset and Rotation — in the ENGINE's uv (V up), not the source's. Absent when the maps are read where the
     *  mesh's UVs say. */
    uvTransform?: { tiling: [number, number]; offset: [number, number]; rotation: number };
    /** How metal and how rough the surface is, as constants. */
    metallic?: number;
    roughness?: number;
    /** glTF's packing: roughness in green, metal in blue, multiplying the factors. */
    metallicRoughnessTexture?: ImportedImageRef;
    /** Legacy glTF specular/glossiness: diffuse uses baseColor; specular is linear RGB and gloss is linear alpha. */
    specularGlossiness?: { specular: [number, number, number]; glossiness: number };
    specularGlossinessTexture?: ImportedImageRef;
    /**
     * Metalness, roughness and occlusion as the source wrote them: a separate image each, the value in its red channel (roughness
     * inverted when the source gave glossiness). Image preparation packs them into the one map above, glTF's way, and removes this.
     */
    separateMaps?: {
        metalness?: ImportedImageRef; roughness?: ImportedImageRef; roughnessIsGlossiness?: boolean; occlusion?: ImportedImageRef;
    };
    /**
     * What the surface has beyond a metal/rough pair, one field per glTF extension that says it — the values are
     * the extension's own factors, absent where the source says nothing (the engine's defaults are glTF's).
     */
    /** KHR_materials_clearcoat: a smooth lacquer over the surface. */
    clearcoat?: number;
    clearcoatRoughness?: number;
    /** KHR_materials_sheen: the soft rim light of cloth. */
    sheenColor?: [number, number, number];
    sheenRoughness?: number;
    /** KHR_materials_anisotropy: a highlight stretched along grooves, turned by `anisotropyRotation` radians. */
    anisotropy?: number;
    anisotropyRotation?: number;
    /** KHR_materials_ior and KHR_materials_specular's factor. */
    ior?: number;
    specular?: number;
    /** KHR_materials_diffuse_transmission: light that scatters through a thin surface, tinted. */
    translucency?: number;
    translucencyColor?: [number, number, number];
    /** KHR_materials_transmission, and KHR_materials_volume's thickness and tint. */
    transmission?: number;
    thickness?: number;
    attenuationColor?: [number, number, number];
    /** KHR_materials_iridescence: a thin film over the surface. */
    iridescence?: number;
    iridescenceIor?: number;
    iridescenceThickness?: number;
    /** A fragment below this alpha is discarded. */
    alphaCutoff?: number;
    /** Drawn without blending, and taking part in depth. */
    opaque: boolean;
    /** Back faces are not drawn. */
    cullBackfaces: boolean;
}

/** A material product: the shading a MeshRenderer's own fields cannot say. */
export interface ImportedMaterialAsset {
    /** `<stem>_m<material index>` — stable across re-imports, so overrides keep matching. */
    name: string;
    /** The `.esmaterial` document. */
    data: MaterialAssetData;
    /** Every image it references, so the caller can carry the sampler settings over. */
    images: ImportedImageRef[];
}

/** Every image reference carried by an imported material, shared by preparation, copying and missing-file cleanup. */
export const IMPORTED_MATERIAL_IMAGE_SLOTS = [
    'baseColorTexture', 'normalTexture', 'emissiveTexture', 'occlusionTexture',
    'metallicRoughnessTexture', 'specularGlossinessTexture', 'flowTexture', 'shiftTexture',
] as const;

/** An image the source carries inline, to be written beside the meshes. */
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
    /** Quaternion in (x, y, z, w) order — the same components a Transform holds. */
    rotation: [number, number, number, number];
    scale: [number, number, number];
    /** Indices into @ref ModelImportResult.meshes; one node can draw several primitives. */
    meshes: number[];
    children: ImportedNode[];
    /** A light the node carries, shining along its local -Z. */
    light?: ImportedLight;
    /** A camera the node carries, looking along its local -Z with +Y up. */
    camera?: ImportedCamera;
    /** Hierarchical visual visibility, independent of simulation and cameras. */
    visibility?: boolean;
    particle?: { emitter: Record<string, unknown>; units: Record<string, unknown>; texture?: ImportedImageRef };
    billboard?: 0 | 1;
    physics?: { bodyType: 0 | 1 | 2; mass: number; isSensor: boolean;
        parts: CompoundColliderPart3D[]; triangleMesh?: number; settings?: Record<string, unknown> };
    /** This node is the root of a spring chain: the bones below it are the strand. Lengths are the model's metres. */
    springBone?: ImportedSpringBone;
    /** Colliders this node hosts, each an entity of its own below it so one bone can carry several. */
    springColliders?: ImportedSpringCollider[];
}

/** What a source states about a spring chain; a field it leaves out keeps the component's default (or the name rule's, for a chain found by name). */
export interface ImportedSpringBone {
    stiffness?: number;
    drag?: number;
    gravity?: [number, number, number];
    radius?: number;
    endLength?: number;
    /** Prefab entity ids of the colliders the chain is kept out of; left out, every collider in the model. */
    colliders?: string[];
}

/** A sphere (`shape` 0) or capsule (1) placed relative to its host node: `offset` and `rotation` (x, y, z, w) put its centre and its Y axis. */
export interface ImportedSpringCollider {
    shape: 0 | 1;
    radius: number;
    height?: number;
    offset?: [number, number, number];
    rotation?: [number, number, number, number];
}

/**
 * A light as a source states it. Intensity is carried over as it is, the way
 * Godot's glTF import does: the engine's is a multiplier with no photometric unit.
 */
export interface ImportedLight {
    type: 'point' | 'directional' | 'spot';
    color: [number, number, number];
    intensity: number;
    /** Where it stops reaching, in metres; absent is unbounded. */
    range?: number;
    /** Full cone angles in degrees. */
    innerAngle?: number;
    outerAngle?: number;
}

export interface ImportedCamera {
    projection: 'perspective' | 'orthographic';
    /** Vertical field of view in degrees. */
    yfov?: number;
    /** Half the visible height, for an orthographic camera. */
    halfHeight?: number;
    near: number;
    far?: number;
    aspect?: number;
}

/** One of the source's animations as the `.estimeline` document it will be written to. */
export interface ImportedAnimation {
    /** `<stem>_<animation name>` — named for the file it will be written to. */
    name: string;
    document: Record<string, unknown>;
}

/**
 * What a source's specular map means. `color` is what the name says — a tint on the
 * highlight, which the engine's metal/rough model has no slot for. `orm` is the
 * packing Falcor-era scenes (Bistro, Sun Temple) store there: occlusion in red,
 * roughness in green, metalness in blue.
 */
export type SpecularMapReading = 'color' | 'orm';

/** What a reader hands over: one file's worth of model, in the engine's terms. */
export interface ModelImportResult {
    meshes: ImportedMesh[];
    /** Images extracted from the file itself; external ones stay where they are. */
    textures: ImportedTexture[];
    /** Every uri the source points OUT to (buffers and images), in file order.
     *  Bringing a model into a project means bringing these with it. */
    externalFiles: string[];
    /** The scene's node roots. Empty for a file with no nodes, whose meshes then sit flat. */
    nodes: ImportedNode[];
    /** The file's animations, each addressing nodes by their path under the prefab. */
    animations: ImportedAnimation[];
    /** What was skipped and why — a silent drop is how half a model goes missing. */
    warnings: string[];
}

export type Trs = Pick<ImportedNode, 'translation' | 'rotation' | 'scale'>;

/**
 * Make sibling names unique. An animation channel addresses its node by the path
 * of names from the root, so two siblings called "Arm" would leave a track
 * driving whichever the walk reached first — the wrong half of the model. Both
 * formats allow the duplicate, so the import settles it and the products agree.
 */
export function disambiguateNodes(nodes: ImportedNode[]): void {
    const used = new Set<string>();
    for (const node of nodes) {
        if (used.has(node.name)) node.name = `${node.name}_${node.index}`;
        used.add(node.name);
        disambiguateNodes(node.children);
    }
}

/**
 * Each node's path of names from the prefab root, matching what
 * {@link assembleModelPrefab} builds: a lone root node IS the prefab root (empty
 * path), while several roots hang under a holder and so carry their own name.
 */
export function nodeChildPaths(nodes: ImportedNode[]): Map<number, string> {
    const paths = new Map<number, string>();
    const walk = (node: ImportedNode, prefix: string): void => {
        const path = prefix ? `${prefix}/${node.name}` : node.name;
        paths.set(node.index, path);
        for (const child of node.children) walk(child, path);
    };
    if (nodes.length === 1 && nodes[0]) {
        paths.set(nodes[0].index, '');
        for (const child of nodes[0].children) walk(child, '');
    } else {
        for (const node of nodes) walk(node, '');
    }
    return paths;
}

/** A node's own name, for the track label. */
export function nodeNameFor(nodes: ImportedNode[], index: number): string {
    for (const node of nodes) {
        if (node.index === index) return node.name;
        const hit = nodeNameFor(node.children, index);
        if (hit) return hit;
    }
    return '';
}

/* -- Animation ---------------------------------------------------------- */

export interface OutKeyframe {
    time: number; value: number; inTangent: number; outTangent: number; interpolation: string;
}

/** Which Transform channels a source's animation path writes, in component order. */
export const ANIMATED_PATHS: Record<string, { property: string; channels: string[] }> = {
    translation: { property: 'position', channels: ['position.x', 'position.y', 'position.z'] },
    scale: { property: 'scale', channels: ['scale.x', 'scale.y', 'scale.z'] },
    // A rotation is stored as (x, y, z, w) — the components, in that order.
    rotation: { property: 'rotation', channels: ['rotation.x', 'rotation.y', 'rotation.z', 'rotation.w'] },
};

/**
 * A quaternion and its negation are the same rotation, and interpolating the
 * four numbers takes the LONG way round whenever consecutive keyframes point
 * apart. Flipping the sign here means the products already describe the short
 * arc, so nothing downstream has to decide it per frame.
 */
export function alignQuaternionSigns(frames: OutKeyframe[][]): void {
    if (frames.length !== 4) return;
    for (let k = 1; k < (frames[0]?.length ?? 0); k++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += frames[c]![k]!.value * frames[c]![k - 1]!.value;
        if (dot >= 0) continue;
        for (let c = 0; c < 4; c++) {
            const kf = frames[c]![k]!;
            kf.value = -kf.value;
            kf.inTangent = -kf.inTangent;
            kf.outTangent = -kf.outTangent;
        }
    }
}

/**
 * One sampler's keyframes, split into one list per component. CUBICSPLINE stores
 * each key as `[inTangent, value, outTangent]`, and its tangents are already per
 * second — the units the evaluator multiplies by the segment length — so the
 * three land in the three fields a keyframe has with no conversion.
 */
export function samplerKeyframes(times: ArrayLike<number>, values: ArrayLike<number>,
                                 comps: number, interpolation: string): OutKeyframe[][] {
    const cubic = interpolation === 'hermite';
    const out: OutKeyframe[][] = Array.from({ length: comps }, () => []);
    for (let k = 0; k < times.length; k++) {
        for (let c = 0; c < comps; c++) {
            const at = cubic ? (3 * k + 1) * comps + c : k * comps + c;
            out[c]!.push({
                time: times[k] ?? 0,
                value: values[at] ?? 0,
                inTangent: cubic ? (values[3 * k * comps + c] ?? 0) : 0,
                outTangent: cubic ? (values[(3 * k + 2) * comps + c] ?? 0) : 0,
                interpolation: cubic ? 'hermite' : interpolation,
            });
        }
    }
    return out;
}

/** One animated node: the entity a track addresses, and the channels driving it. */
export interface AnimatedNode {
    /** The node's own name — the track's label. */
    node: string;
    /** The entity the track writes, under the prefab root. */
    childPath: string;
    /** The component whose fields the channels below name. */
    component: string;
    channels: Map<string, OutKeyframe[]>;
}

/**
 * An animation as an `.estimeline` document. Channels are grouped per target
 * entity AND component, since a track drives one component on one entity and the
 * runtime reads and writes that component once per track — a node whose shape
 * and placement both move is two tracks.
 *
 * @param byNode childPath → the node's channels, in the order tracks are written.
 */
export function timelineDocument(duration: number,
                                 byNode: Map<string, AnimatedNode>): Record<string, unknown> {
    return {
        version: TIMELINE_FORMAT_VERSION,
        type: 'timeline',
        duration,
        // Neither format says anything about looping, and the import does not guess.
        wrapMode: 'once',
        tracks: [...byNode.values()].map((entry) => ({
            type: 'property', name: entry.node, childPath: entry.childPath,
            component: entry.component,
            channels: [...entry.channels].map(([property, keyframes]) => ({ property, keyframes })),
        })),
    };
}

/** A source's animation name is whatever the tool wrote (spaces, dots, a slash),
 *  and it becomes a file name here. */
export function animationProductName(stem: string, name: string): string {
    return `${stem}_${name.replace(/[^\w.-]+/g, '_')}`;
}

/* -- Products ----------------------------------------------------------- */

/** Cells per side of the grid a lightmap UV set is judged on. */
const LAYOUT_GRID = 256;

/**
 * How a mesh's TexCoord1 triangles sit in their square: the share of it they
 * cover, and how many layers deep they lie on themselves (1 = none overlap).
 * Counted on one grid for both, so a sliver that misses every cell centre
 * weighs on neither. Zero coverage without the channel.
 */
export function lightmapUVLayout(data: ImportedMesh['data']): { coverage: number; overlap: number } {
    const channel = data.channels.find((c) => c.semantic === MeshChannel.TexCoord1);
    if (!channel) return { coverage: 0, overlap: 1 };
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const G = LAYOUT_GRID;
    const u = (v: number) => view.getFloat32(v * data.vertexStride + channel.offset, true) * G;
    const w = (v: number) => view.getFloat32(v * data.vertexStride + channel.offset + 4, true) * G;
    const cells = new Uint8Array(G * G);
    let hits = 0, covered = 0;
    const idx = data.indices;
    for (let i = 0; i + 2 < idx.length; i += 3) {
        const x = [u(idx[i]!), u(idx[i + 1]!), u(idx[i + 2]!)];
        const y = [w(idx[i]!), w(idx[i + 1]!), w(idx[i + 2]!)];
        const area = (x[1]! - x[0]!) * (y[2]! - y[0]!) - (x[2]! - x[0]!) * (y[1]! - y[0]!);
        if (Math.abs(area) < 1e-12) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...x))), x1 = Math.min(G - 1, Math.ceil(Math.max(...x)));
        const y0 = Math.max(0, Math.floor(Math.min(...y))), y1 = Math.min(G - 1, Math.ceil(Math.max(...y)));
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const px = cx + 0.5, py = cy + 0.5;
                const w0 = ((x[1]! - px) * (y[2]! - py) - (x[2]! - px) * (y[1]! - py)) / area;
                const w1 = ((x[2]! - px) * (y[0]! - py) - (x[0]! - px) * (y[2]! - py)) / area;
                if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
                hits++;
                if (cells[cy * G + cx] === 0) { cells[cy * G + cx] = 1; covered++; }
            }
        }
    }
    return { coverage: covered / (G * G), overlap: covered > 0 ? hits / covered : 1 };
}

/**
 * Gives every mesh a bake can be read on a lightmap UV set, and says who it
 * skipped. Mutates in place: the caller holds the products it is about to write.
 * Skinned is skipped because bones move it and a bake cannot follow; one that
 * already carries a usable layout keeps it, since its art may be painted against it.
 */
export function applyLightmapUV(meshes: ImportedMesh[]): string[] {
    const warnings: string[] = [];
    for (const mesh of meshes) {
        if (mesh.skinJoints && mesh.skinJoints.length > 0) {
            warnings.push(`${mesh.name}: skinned, so it gets no lightmap UV — bones move it and`
                + ' a bake cannot');
            continue;
        }
        if (mesh.data.channels.some((c) => c.semantic === MeshChannel.TexCoord1)) {
            const { coverage, overlap } = lightmapUVLayout(mesh.data);
            if (overlap > OVERLAPPING_LIGHTMAP_UV) {
                warnings.push(`${mesh.name}: its second UV set lies ${overlap.toFixed(1)} layers deep on`
                    + ' itself, so parts of it would share light — a lightmap UV is unwrapped in its place');
            } else if (coverage < SPARSE_LIGHTMAP_UV) {
                warnings.push(`${mesh.name}: its second UV set covers ${(coverage * 100).toFixed(1)}% of its`
                    + ' square, too little to bake into — a lightmap UV is unwrapped in its place');
            } else {
                warnings.push(`${mesh.name}: already carries a second UV set, which is kept`);
                continue;
            }
        }
        try {
            const { mesh: unwrapped, charts, coverage } = unwrapLightmapUV(mesh.data);
            mesh.data = unwrapped;
            mesh.vertexCount = unwrapped.vertexCount;
            if (coverage < 0.15) {
                warnings.push(`${mesh.name}: ${charts} chart(s) fill only`
                    + ` ${Math.round(coverage * 100)}% of its atlas — a wider chart angle packs`
                    + ' tighter, at the cost of more stretch');
            }
        } catch (err) {
            warnings.push(`${mesh.name}: no lightmap UV (${(err as Error).message})`);
        }
    }
    return warnings;
}

/** What a generated level keeps and where it takes over — each level is cheaper than the last. */
const LOD_RATIOS = [0.5, 0.2, 0.07];
const LOD_SIZES = [0.4, 0.18, 0.07];
/** A level that sheds less than this share of the one above is not worth a draw swap. */
const LOD_MIN_SAVING = 0.15;
/** The collapse may move the surface this far, relative to the mesh's extent. */
const LOD_ERROR = [0.01, 0.03, 0.08];
/** What each level may do to the surface: the near one keeps its borders; the far ones, seen small, may collapse across them and shed specks. */
const LOD_FLAGS: SimplifierFlag[][] = [['LockBorder'], ['Prune', 'Permissive'], ['Prune', 'Permissive']];

export interface LodOptions {
    /** How many levels to make below the original, 1–3. */
    levels: number;
    /** A mesh with fewer triangles than this has nothing worth swapping. */
    minTriangles: number;
}

/** The file a mesh's level `n` is written to, by product name (no extension). */
export function lodName(mesh: Pick<ImportedMesh, 'name'>, level: number): string {
    return `${mesh.name}_lod${level}`;
}

/**
 * Makes the cheaper stand-ins a `LODGroup` swaps in, and says what it left alone.
 * Mutates in place, after any unwrap: a level is a collapse of the mesh as it will
 * be written, lightmap UV included. Skinned and morphing meshes keep one level.
 */
export async function generateLods(meshes: ImportedMesh[], options: LodOptions): Promise<string[]> {
    const warnings: string[] = [];
    const levels = Math.min(LOD_RATIOS.length, Math.max(0, Math.floor(options.levels)));
    if (levels === 0) return warnings;
    for (const mesh of meshes) {
        if (mesh.triangleCount < options.minTriangles) continue;
        if (!canSimplify(mesh.data)) {
            if (mesh.skinJoints?.length || mesh.data.morph) {
                warnings.push(`${mesh.name}: skinned or morphing, so it keeps a single level of detail`);
            }
            continue;
        }
        const out: GeneratedLod[] = [];
        let above = mesh.triangleCount;
        for (let level = 0; level < levels; level++) {
            // Collapse from the ORIGINAL each time: stacking collapses compounds their error.
            const made = await simplifyMesh(mesh.data, { ratio: LOD_RATIOS[level]!, maxError: LOD_ERROR[level]!, flags: LOD_FLAGS[level]! });
            if (!made || made.triangles > above * (1 - LOD_MIN_SAVING)) break;
            out.push({ data: made.data, triangleCount: made.triangles, size: LOD_SIZES[level]! });
            above = made.triangles;
        }
        if (out.length > 0) mesh.lods = out;
    }
    return warnings;
}

/** The bytes to write for a generated level. */
export function encodeGeneratedLod(lod: GeneratedLod): Uint8Array {
    return encodeMesh(lod.data);
}

/** The bytes to write for an imported mesh. */
export function encodeImportedMesh(mesh: ImportedMesh): Uint8Array {
    return encodeMesh(mesh.data);
}

/** How a product is spelled where a component refers to it. */
export interface ProductRefs {
    /** Prepended to every product name, e.g. `assets/models/` — the project-relative dir. */
    prefix?: string;
    /** Canonical geometry product stems. Nodes, materials, skin bindings and animation paths keep their own identity. */
    meshNames?: ReadonlyMap<ImportedMesh, string>;
    /** An external image uri (relative to the source) → the ref a component carries. */
    external?: (uri: string) => string;
    /** Give a skin, hair or eye material the engine's character shader instead of the Model shader (see {@link characterShading}). */
    characters?: boolean;
    /** Turn the bones a model names as hair chains, and the empties it names as colliders, into SpringBone and SpringBoneCollider (see {@link springBoneComponents}). */
    springBones?: boolean;
}

/** How the products go together. */
export interface PrefabAssembly {
    refs?: ProductRefs;
    /** The source's hierarchy; without it every mesh sits at the origin. */
    nodes?: ImportedNode[];
    /** Uniform scale on the root: a model is authored in metres, a world unit is
     *  a design pixel. */
    scale?: number;
    /** The clip the root's player points at — the products say what they have,
     *  and it is left stopped because what to play is the scene's decision. */
    timeline?: string;
}

/** How a component spells a reference to an image: a project-relative path. */
function imageRef(image: ImportedImageRef, refs: ProductRefs): string {
    return image.external
        ? refs.external?.(image.file) ?? image.file
        : (refs.prefix ?? '') + image.file;
}

/**
 * How a MATERIAL spells the same reference. It resolves a relative ref against
 * its own directory, and every product lands beside it, so a product is its bare
 * name; a file already in the project takes a logical path instead — the one
 * other spelling that resolver passes through (as `rewriteMaterialRefs` writes).
 */
function materialImageRef(image: ImportedImageRef, refs: ProductRefs): string {
    const dir = refs.prefix ?? '';
    const ref = imageRef(image, refs);
    if (ref.startsWith(dir)) {
        const beside = ref.slice(dir.length);
        if (beside.length > 0 && !beside.includes('/')) return beside;
    }
    return ref.startsWith('assets/') || ref.startsWith('/') ? ref : `/${ref}`;
}

/**
 * The Model shader's parameter each layer field becomes. A colour is a `{r, g, b, a}` object and a number is itself,
 * so one table carries them all and a field the source did not state is simply not written.
 */
const MATERIAL_LAYER_PROPERTIES: readonly [keyof ImportedMaterial, string][] = [
    ['clearcoat', 'u_clearcoat'], ['clearcoatRoughness', 'u_clearcoatRoughness'],
    ['sheenColor', 'u_sheenColor'], ['sheenRoughness', 'u_sheenRoughness'],
    ['anisotropy', 'u_anisotropy'], ['anisotropyRotation', 'u_anisotropyRotation'],
    ['ior', 'u_ior'], ['specular', 'u_specular'],
    ['translucency', 'u_translucency'], ['translucencyColor', 'u_translucencyColor'],
    ['transmission', 'u_transmission'], ['thickness', 'u_thickness'], ['attenuationColor', 'u_attenuationColor'],
    ['iridescence', 'u_iridescence'], ['iridescenceIor', 'u_iridescenceIor'],
    ['iridescenceThickness', 'u_iridescenceThickness'],
];

/**
 * Whether this material says anything a MeshRenderer's own fields cannot: shading is
 * per-material constants and samplers, and the component has neither. A metal-
 * roughness pair the engine's defaults already are needs nothing written — but
 * glTF defaults both factors to 1, so most materials do.
 */
function needsMaterial(material: ImportedMaterial | undefined): material is ImportedMaterial {
    return !!material && !!(material.unlit || material.normalTexture || material.emissive || material.emissiveTexture
        || material.occlusionTexture || material.alphaCutoff || material.metallicRoughnessTexture || material.specularGlossiness
        || (material.normalScale ?? 1) !== 1 || material.uvTransform
        || (material.metallic ?? 0) !== 0 || (material.roughness ?? 1) !== 1
        || MATERIAL_LAYER_PROPERTIES.some(([field]) => material[field] !== undefined));
}

/** The character shader a material's name asks for, when it names skin, hair or an eye. */
export type CharacterShading = 'skin' | 'hair' | 'eye';

const CHARACTER_TOKENS: readonly [CharacterShading, readonly string[]][] = [
    ['eye', ['eye', 'eyes', 'eyeball', 'eyeballs', 'iris', 'cornea']],
    ['hair', ['hair', 'hairs', 'ponytail', 'bangs', 'fringe']],
    ['skin', ['skin', 'face', 'head', 'neck']],
];

/**
 * What a material is, read from its name and its colour texture's file name, split into words (`T_C004_BodySkin` is c, body, skin):
 * a word has to BE `eye` or `hair`, so `Eyelashes` and `Headband` are neither. A name is a convention and not a fact, which is why
 * the import asks for this by setting and never assumes it.
 */
export function characterShading(material: ImportedMaterial): CharacterShading | undefined {
    const file = material.baseColorTexture?.file ?? '';
    const words = `${material.name} ${file.slice(file.lastIndexOf('/') + 1)}`
        .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/);
    for (const [shading, names] of CHARACTER_TOKENS) {
        if (words.some((word) => names.includes(word))) return shading;
    }
    return undefined;
}

/**
 * Put the triangles of every hair mesh in the order a blended draw wants them: the ones nearest the middle of the hair first, the outermost
 * last. A hair model is a shell of cards around a head, and seen from outside a card nearer the middle is behind one further out, from
 * whichever side the camera looks, so one fixed order is the back-to-front order for all of them. Draws go through the index buffer in
 * order, which is what makes this an ordering at all. It is an approximation and says so: a ponytail that leaves the shell is not ordered
 * by it. Only meshes whose material {@link characterShading} calls hair; the levels of detail are ordered too.
 */
export function orderHairTriangles(meshes: ImportedMesh[]): void {
    for (const mesh of meshes) {
        if (!mesh.material || characterShading(mesh.material) !== 'hair') continue;
        const centre = hairCentre(mesh.data);
        if (!centre) continue;
        sortTriangles(mesh.data, centre);
        for (const lod of mesh.lods ?? []) sortTriangles(lod.data, centre);
    }
}

function positionsOf(data: MeshData): Float32Array | undefined {
    const channel = data.channels.find((c) => c.semantic === MeshChannel.Position && c.type === MeshChannelType.Float32 && c.components >= 3);
    if (!channel) return undefined;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const out = new Float32Array(data.vertexCount * 3);
    for (let i = 0; i < data.vertexCount; i++) {
        for (let k = 0; k < 3; k++) out[i * 3 + k] = view.getFloat32(i * data.vertexStride + channel.offset + k * 4, true);
    }
    return out;
}

/** The middle of the mesh's bounding box. */
function hairCentre(data: MeshData): [number, number, number] | undefined {
    const [lx, ly, lz] = data.aabbMin, [hx, hy, hz] = data.aabbMax;
    return [(lx + hx) / 2, (ly + hy) / 2, (lz + hz) / 2];
}

function sortTriangles(data: MeshData, centre: [number, number, number]): void {
    const positions = positionsOf(data);
    const count = Math.floor(data.indices.length / 3);
    if (!positions || count < 2) return;
    const key = new Float64Array(count);
    for (let t = 0; t < count; t++) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) {
            const v = data.indices[t * 3 + k]! * 3;
            x += positions[v]!; y += positions[v + 1]!; z += positions[v + 2]!;
        }
        key[t] = Math.hypot(x / 3 - centre[0], y / 3 - centre[1], z / 3 - centre[2]);
    }
    const order = Array.from({ length: count }, (_, t) => t).sort((a, b) => key[a]! - key[b]! || a - b);
    const sorted = new Uint32Array(data.indices.length);
    order.forEach((from, to) => { sorted.set(data.indices.subarray(from * 3, from * 3 + 3), to * 3); });
    data.indices = sorted;
}

/** Whether a material gets a product: it says something a MeshRenderer cannot, or its name asks for a character shader. */
function hasProduct(material: ImportedMaterial, refs: ProductRefs): boolean {
    return needsMaterial(material) || (!!refs.characters && characterShading(material) !== undefined);
}

/**
 * How much of the Hair shader's strand highlight the lamps draw for a glTF's specular factor. The factor scales a Fresnel reflectance of 0.04,
 * which `u_specular` carries into the reflection of the environment; the engine's strand highlight is an authored lobe with a peak of about
 * half the light, so under a lamp it is far too bright unless it is turned down on its own. Measured against Blender's Principled at roughness
 * 0.43 and a specular level of 0.3 (tools/render-align in the star-neighbors game).
 */
const HAIR_LOBE_GAIN = 0.1;
const HAIR_ENV_GAIN = 0.65;
const HAIR_SHADOW_DENSITY = 400;

/**
 * What the character shaders read, from what the source says: the maps they share, and the cutout hair needs. What a glTF does not say it
 * does not have: it carries no subsurface scattering and no second strand highlight, so those are written as off (they stay on the shader
 * for a hand-made material), and the import shades like the Principled shader the model was authored against.
 */
function characterProperties(shading: CharacterShading, material: ImportedMaterial, properties: Record<string, unknown>,
                             bind: (name: string, image?: ImportedImageRef) => void): void {
    // Skin and hair read the glTF packing (occlusion, roughness, metalness) as their `u_ormMap`; their roughness is a SCALE on it,
    // so a factor of 0 (what an FBX without one writes) would be a mirror, and is left out.
    const rough = material.roughness !== undefined && material.roughness > 0 ? material.roughness : undefined;
    for (const key of ['u_metallic', 'u_roughness', 'u_metallicRoughnessMap', 'u_occlusionMap', 'u_occlusionStrength']) delete properties[key];
    if (shading !== 'eye') {
        bind('u_ormMap', material.metallicRoughnessTexture);
        if (rough !== undefined && !material.metallicRoughnessTexture) properties.u_roughness = rough;
    }
    if (shading === 'skin') {
        properties.u_sssWrap = 0; properties.u_translucency = 0; properties.u_lobe2 = 0; properties.u_fuzz = 0;
        properties.u_blurRed = 0; properties.u_blurGreen = 0;
    }
    if (shading === 'hair') {
        // A little of the shader's own strand character is kept (a per-strand shift of the highlight and a tinted second lobe, at a third of their
        // strength): without it the cards read as plates, not locks of hair.
        properties.u_translucency = 0; properties.u_shiftAmount = 0.3; properties.u_rootDark = 0;
        properties.u_secondaryTint = { r: 0.12, g: 0.07, b: 0.04, a: 1 };
        // The Hair shader has no use for the packed roughness (a strand's width is its own), so the factor is the whole answer.
        if (rough !== undefined) properties.u_roughness = rough;
        // Principled reflects F0 = 0.04 x the factor; the Hair shader's F0 is 0.046, so u_specular is the ratio, and its reflection of the environment at
        // this roughness comes out about half as bright again as Blender's, which HAIR_ENV_GAIN takes back.
        properties.u_specular = ((material.specular ?? 1) * 0.04 / 0.046) * HAIR_ENV_GAIN;
        properties.u_lobeGain = HAIR_LOBE_GAIN;
        // The Principled shader's diffuse, which goes dark where a card turns from the light (the strand's own diffuse keeps it lit edge-on and flattens the locks), and
        // a density of hair for the light to pass through, with the cascade the frame fits to it: what Blender gets from tracing the layers.
        properties.u_strandDiffuse = 0; properties.u_hairShadow = HAIR_SHADOW_DENSITY;
        // A card the source gave an anisotropy (KHR_materials_anisotropy, which Blender exports from its Principled anisotropy) keeps the
        // highlight it was authored with: Principled's GGX stretched along the strand, the specular factor as F0 = 0.04 x it. The strand lobes
        // above are what a card without one gets.
        if (material.anisotropy !== undefined && material.anisotropy > 0) {
            properties.u_anisotropy = material.anisotropy;
            properties.u_specular = material.specular ?? 1;
        }
        // Cards cut from one strand texture read as combed plates; drawing them as a few locks, each a little lighter or darker with its own break in the highlight
        // and a shadowed seam, gives the layers the depth Blender gets from hundreds of overlapping cards.
        properties.u_clumpCount = 7; properties.u_clumpTone = 0.4; properties.u_clumpShift = 0.5; properties.u_clumpGap = 0.55;
        properties.u_alphaCutoff = material.alphaCutoff ?? 0.5;
        bind('u_flowMap', material.flowTexture);
        bind('u_shiftMap', material.shiftTexture);
        if (material.tipSoftness !== undefined) properties.u_tipSoftness = material.tipSoftness;
    } else delete properties.u_alphaCutoff;
    if (shading === 'eye') {
        delete properties.u_normalMap;
        // What a glTF says of an eye is a painted texture and a roughness: the Principled shader it was authored against. So the Eye shader's
        // own additions are written as off (a tinted white, light wrapping past the terminator in a warm colour, which turned a painted iris
        // red, and lids darkening it), and both its glossy layers take the source's roughness instead of a near-mirror cornea. An eye given
        // a depth map and an iris normal map by hand gets them back by setting these.
        properties.u_scleraColor = { r: 1, g: 1, b: 1, a: 1 };
        properties.u_scleraWrap = 0;
        properties.u_lidShadow = 0;
        const eyeRough = rough ?? 0.5;
        properties.u_corneaRoughness = Math.max(eyeRough, 0.01);
        properties.u_scleraRoughness = Math.max(eyeRough, 0.1);
        properties.u_specular = material.specular ?? 1;
    }
}

/** `<stem>_m<source material index>` — the product a material becomes. */
function materialName(stem: string, material: ImportedMaterial): string {
    return `${stem}_m${material.index}`;
}

/**
 * The `.esmaterial` documents an import writes, one per source material that
 * needs one. The render state is written out because a material REPLACES the
 * draw's own — a model told to occlude itself would start blending the moment
 * it gained a material.
 */
/**
 * Every image the materials reference, with the import settings its references ask
 * for, merged: two materials sharing a texture (a cutout's leaves and a blended
 * wing on one atlas) each add their keys, the first to name a key keeping it.
 * Keyed by the ref's `file` as the reader spelled it.
 */
export function importedImageSettings(meshes: ImportedMesh[]):
    Map<string, { external: boolean; settings: NonNullable<ImportedImageRef['settings']> }> {
    const out = new Map<string, { external: boolean; settings: NonNullable<ImportedImageRef['settings']> }>();
    for (const mesh of meshes) {
        const m = mesh.material;
        for (const slot of IMPORTED_MATERIAL_IMAGE_SLOTS) {
            const image = m?.[slot];
            if (!image) continue;
            const seen = out.get(image.file);
            out.set(image.file, { external: image.external, settings: { ...image.settings, ...seen?.settings } });
        }
    }
    return out;
}

export function materialProducts(meshes: ImportedMesh[], stem: string,
                                 refs: ProductRefs = {}): ImportedMaterialAsset[] {
    const out: ImportedMaterialAsset[] = [];
    const seen = new Set<number>();
    for (const mesh of meshes) {
        const material = mesh.material;
        if (!material || !hasProduct(material, refs) || seen.has(material.index)) continue;
        seen.add(material.index);
        if (material.unlit) {
            out.push({
                name: materialName(stem, material),
                data: {
                    version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:sprite-unlit',
                    blendMode: material.blendMode ?? (material.opaque ? BlendMode.None : BlendMode.Normal),
                    depthTest: true, depthWrite: material.opaque,
                    cull: material.cullBackfaces ? CullMode.Back : CullMode.None,
                    properties: { u_alphaCutoff: material.alphaCutoff ?? 0 },
                },
                images: [],
            });
            continue;
        }
        // A name-based character preset cannot express specular/glossiness. Keep
        // that authored BRDF on the general Model shader instead of losing it.
        const shading = refs.characters && !material.specularGlossiness ? characterShading(material) : undefined;

        const images: ImportedImageRef[] = [];
        const properties: Record<string, unknown> = {};
        const bind = (name: string, image?: ImportedImageRef): void => {
            if (!image) return;
            images.push(image);
            properties[name] = materialImageRef(image, refs);
        };
        bind('u_normalMap', material.normalTexture);
        bind('u_emissiveMap', material.emissiveTexture);
        bind('u_occlusionMap', material.occlusionTexture);
        bind('u_metallicRoughnessMap', material.specularGlossiness ? material.specularGlossinessTexture : material.metallicRoughnessTexture);
        if (material.normalScale !== undefined) properties.u_normalScale = material.normalScale;
        if (material.specularGlossiness) {
            const [r, g, b] = material.specularGlossiness.specular;
            properties.u_specularColor = { r, g, b, a: 1 };
            properties.u_glossiness = material.specularGlossiness.glossiness;
        }
        // Written even at the engine's own defaults: glTF's are 1 and 1, so a
        // product that left them out would read as a surface it is not.
        if (material.metallic !== undefined) properties.u_metallic = material.metallic;
        if (material.roughness !== undefined) properties.u_roughness = material.roughness;
        if (material.emissive) {
            const [r, g, b] = material.emissive;
            properties.u_emissive = { r, g, b, a: 1 };
        }
        if (material.occlusionStrength !== undefined) {
            properties.u_occlusionStrength = material.occlusionStrength;
        }
        if (material.alphaCutoff !== undefined) properties.u_alphaCutoff = material.alphaCutoff;
        if (material.uvTransform && !shading) {
            const { tiling, offset, rotation } = material.uvTransform;
            properties.u_uvTiling = { x: tiling[0], y: tiling[1] };
            properties.u_uvOffset = { x: offset[0], y: offset[1] };
            if (rotation !== 0) properties.u_uvRotation = rotation;
        }
        if (shading) characterProperties(shading, material, properties, bind);
        else for (const [field, parameter] of MATERIAL_LAYER_PROPERTIES) {
            const value = material[field];
            if (value === undefined) continue;
            properties[parameter] = Array.isArray(value)
                ? { r: value[0], g: value[1], b: value[2], a: 1 } : value;
        }

        out.push({
            name: materialName(stem, material),
            data: {
                version: MATERIAL_FORMAT_VERSION,
                type: 'material',
                shader: shading ? `builtin:${shading}` : 'builtin:model',
                ...(material.specularGlossiness ? { switches: { ES_SPECULAR_GLOSSINESS: true } } : {}),
                // Hair is cut out and feathered by coverage, which only an unblended draw gets.
                blendMode: material.opaque || shading === 'hair' ? BlendMode.None : BlendMode.Normal,
                // Blended surfaces still test against opaque geometry in front.
                depthTest: true,
                depthWrite: material.opaque || shading === 'hair',
                cull: material.cullBackfaces ? CullMode.Back : CullMode.None,
                properties,
            },
            images,
        });
    }
    return out;
}

/** The `LODGroup` that points at a mesh's generated levels; none when it made none. */
function lodComponent(mesh: ImportedMesh, refs: ProductRefs): ComponentData[] {
    if (!mesh.lods || mesh.lods.length === 0) return [];
    const prefix = refs.prefix ?? '';
    const data: Record<string, unknown> = {};
    const product = { name: refs.meshNames?.get(mesh) ?? mesh.name };
    mesh.lods.forEach((lod, i) => {
        data[`lod${i + 1}`] = `${prefix}${lodName(product, i + 1)}.esmesh`;
        data[`lod${i + 1}Size`] = lod.size;
    });
    return [{ type: 'LODGroup', data }];
}

function meshComponent(mesh: ImportedMesh, stem: string, refs: ProductRefs): ComponentData {
    const prefix = refs.prefix ?? '';
    const texture = mesh.material?.baseColorTexture
        ? imageRef(mesh.material.baseColorTexture, refs) : null;
    const hasNormals = mesh.data.channels.some(c => c.semantic === MeshChannel.Normal);
    const color = mesh.material?.baseColor;
    // Shading moves WHOLE to the material when there is one: a material shader
    // reads its own samplers, so a normal map left on the component would be a
    // map nothing samples.
    const material = mesh.material && hasProduct(mesh.material, refs)
        ? `${prefix}${materialName(stem, mesh.material)}.esmaterial` : null;
    // A normal map needs normals to perturb; without them the engine draws the
    // unlit variant and the map would be a reference to nothing.
    const normalMap = !material && hasNormals && mesh.material?.normalTexture
        ? imageRef(mesh.material.normalTexture, refs) : null;
    return { type: 'MeshRenderer', data: {
        mesh: `${prefix}${refs.meshNames?.get(mesh) ?? mesh.name}.esmesh`,
        // Geometry that carries normals was authored to be shaded, so the product
        // says so. Written rather than assumed: `lit` is a field a user can turn
        // off, and an import that left it out would be one the engine had to guess.
        ...(mesh.material?.unlit ? { lit: false } : hasNormals ? { lit: true } : {}),
        ...(texture ? { texture } : {}),
        ...(normalMap ? { normalMap } : {}),
        ...(material ? { material } : {}),
        ...(color ? { color: { r: color[0], g: color[1], b: color[2], a: color[3] } } : {}),
        ...(mesh.material?.opaque ? { opaque: true } : {}),
        ...(mesh.material?.cullBackfaces ? { cullBackfaces: true } : {}),
        enabled: true,
    } };
}

/**
 * The joints that deform this mesh, named by the prefab entity each source node
 * became — the same `n<index>` ids {@link assembleModelPrefab} emits, so a
 * re-import keeps pointing at the same entities.
 */
function skinComponent(mesh: ImportedMesh): ComponentData[] {
    if (!mesh.skinJoints) return [];
    return [{ type: 'MeshSkin', data: { joints: mesh.skinJoints.map(i => `n${i}`) } }];
}

/**
 * The shape this mesh starts in. Written whenever it HAS shapes, even at rest:
 * the component is what a clip and the inspector address, and a mesh whose
 * weights arrive only once something moves them is one an author cannot open.
 */
function morphComponent(mesh: ImportedMesh): ComponentData[] {
    const targets = mesh.data.morph?.names.length ?? 0;
    if (targets === 0) return [];
    const authored = mesh.morphWeights ?? [];
    return [{ type: 'MeshMorph', data: {
        weights: Array.from({ length: targets }, (_, i) => authored[i] ?? 0),
    } }];
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

/** An unbounded light's reach, as Godot clamps one: far enough to be no reach at all. */
const UNBOUNDED_LIGHT_RANGE = 4096;
const LIGHT_TYPE = { point: 0, directional: 1, spot: 3 } as const;

/**
 * A KHR_lights_punctual light. A point or spot one is in candela and falls off as the inverse square of the distance, so
 * it is an inverse-square Light at candela over pi (a Light's intensity is what reaches a surface over pi, the unit a
 * directional one's is in); its range is in metres, so it is scaled with the model.
 */
function lightComponent(light: ImportedLight, scale = 1): ComponentData {
    const [r, g, b] = light.color;
    const positional = light.type !== 'directional';
    return { type: 'Light', data: {
        type: LIGHT_TYPE[light.type],
        color: { r, g, b, a: 1 },
        intensity: positional ? light.intensity / Math.PI : light.intensity,
        ...(positional ? { radius: (light.range ?? UNBOUNDED_LIGHT_RANGE) * scale, inverseSquare: true } : {}),
        ...(light.type === 'spot' ? { innerAngle: light.innerAngle ?? 0, outerAngle: light.outerAngle ?? 90 } : {}),
    } };
}

/** Never active: a model's camera must not take over the scene it is placed in. */
function cameraComponent(camera: ImportedCamera): ComponentData {
    return { type: 'Camera', data: {
        projectionType: camera.projection === 'perspective' ? 0 : 1,
        ...(camera.yfov !== undefined && camera.yfov > 0 ? { fov: camera.yfov } : {}),
        ...(camera.halfHeight !== undefined ? { orthoSize: camera.halfHeight } : {}),
        // A plane the file leaves at 0 is one it did not state.
        ...(camera.near > 0 ? { nearPlane: camera.near } : {}),
        ...(camera.far !== undefined && camera.far > camera.near ? { farPlane: camera.far } : {}),
        ...(camera.aspect ? { aspectRatio: camera.aspect } : {}),
        isActive: false,
    } };
}

function entity(id: string, name: string, parent: string | null,
                components: ComponentData[]): PrefabEntityData {
    return { prefabEntityId: id, name, parent, children: [], visible: true, components };
}

/** The spring data a source stated for this node: a SpringBone on it, and an entity below it for each collider it hosts. Lengths are the model's metres times the import scale. */
function addExplicitSpringBones(node: ImportedNode, self: PrefabEntityData, entities: PrefabEntityData[], scale: number): void {
    (node.springColliders ?? []).forEach((c, i) => {
        const id = `${self.prefabEntityId}_sbc${i}`;
        const [x, y, z] = c.offset ?? [0, 0, 0];
        const [rx, ry, rz, rw] = c.rotation ?? [0, 0, 0, 1];
        self.children.push(id);
        entities.push(entity(id, `${node.name}_collider${i}`, self.prefabEntityId, [
            { type: 'Transform', data: {
                ...(x || y || z ? { position: { x, y, z } } : {}),
                ...(rx || ry || rz || rw !== 1 ? { rotation: { w: rw, x: rx, y: ry, z: rz } } : {}),
            } },
            { type: 'SpringBoneCollider', data: { shape: c.shape, radius: c.radius, ...(c.shape === 1 ? { height: c.height ?? 0 } : {}) } },
        ]));
    });
    const s = node.springBone;
    if (!s) return;
    self.components.push({ type: 'SpringBone', data: {
        ...(s.stiffness !== undefined ? { stiffness: s.stiffness } : {}),
        ...(s.drag !== undefined ? { drag: s.drag } : {}),
        ...(s.gravity ? { gravity: { x: s.gravity[0] * scale, y: s.gravity[1] * scale, z: s.gravity[2] * scale } } : {}),
        ...(s.radius !== undefined ? { radius: s.radius * scale } : {}),
        ...(s.endLength !== undefined ? { endLength: s.endLength * scale } : {}),
        ...(s.colliders ? { colliders: [...s.colliders] } : {}),
    } });
}

/** A hair chain's root bone: `Hair_<region>_<chain>_00`, the joint the body or the animation drives and the chain hangs from. */
const HAIR_CHAIN_ROOT = /^Hair_([A-Za-z]+(?:_[A-Za-z]+)*)_(\d{2})_00$/;
/** A collider an artist left in the model: `SBC_Sphere_<name>_r<cm>` or `SBC_Capsule_<name>_r<cm>_h<cm>`; the node's own transform places it, a capsule runs along its local +Y. */
const SPRING_COLLIDER = /^SBC_(Sphere|Capsule)_(.+?)_r(\d+)(?:_h(\d+))?$/;

/** How loose each kind of strand hangs. A fringe is held close, a ponytail swings; the numbers are the starting point an artist adjusts in Details, not a claim about hair. */
const HAIR_FEEL: Record<string, { stiffness: number; drag: number }> = {
    Ponytail: { stiffness: 0.06, drag: 0.35 },
    Temple: { stiffness: 0.12, drag: 0.4 },
    Fringe: { stiffness: 0.2, drag: 0.45 },
    Crest: { stiffness: 0.15, drag: 0.3 },
    Crown: { stiffness: 0.2, drag: 0.5 },
};

/**
 * Builds hair motion from names: a `Hair_<region>_<chain>_00` bone with a child is a SpringBone, an `SBC_` node a SpringBoneCollider,
 * and every chain is kept out of every collider the model has. Sizes are the model's metres times the import scale; gravity is Earth's.
 * Returns the counts it made.
 */
export function springBoneComponents(entities: PrefabEntityData[], scale = 1): { chains: number; colliders: number } {
    const has = (e: PrefabEntityData, type: string): boolean => e.components.some(c => c.type === type);
    // What the file stated outright is already on the entities; names only fill in what it did not.
    const colliders: string[] = entities.filter(e => has(e, 'SpringBoneCollider')).map(e => e.prefabEntityId);
    for (const e of entities) {
        for (const c of e.components) {
            if (c.type === 'SpringBone' && c.data.colliders === undefined) c.data.colliders = [...colliders];
        }
    }
    for (const e of entities) {
        if (has(e, 'SpringBoneCollider')) continue;
        const m = SPRING_COLLIDER.exec(e.name);
        if (!m) continue;
        const radius = Number(m[3]) / 100;
        const capsule = m[1] === 'Capsule';
        if (capsule && m[4] === undefined) continue;
        e.components.push({ type: 'SpringBoneCollider', data: {
            shape: capsule ? 1 : 0, radius, ...(capsule ? { height: Number(m[4]) / 100 } : {}),
        } });
        colliders.push(e.prefabEntityId);
    }
    let chains = 0;
    for (const e of entities) {
        const m = HAIR_CHAIN_ROOT.exec(e.name);
        if (!m || e.children.length === 0 || has(e, 'SpringBone')) continue;
        const feel = HAIR_FEEL[m[1]!.split('_')[0]!] ?? { stiffness: 0.1, drag: 0.5 };
        e.components.push({ type: 'SpringBone', data: {
            stiffness: feel.stiffness, drag: feel.drag,
            gravity: { x: 0, y: -9.8 * scale, z: 0 },
            endLength: 0.04 * scale, radius: 0.005 * scale,
            colliders: [...colliders],
        } });
        chains++;
    }
    return { chains, colliders: colliders.length };
}

/**
 * The import's assembly: where each piece of geometry sits, and which image and
 * tint it is drawn with. The products are separate files and nothing else
 * records how they go together, so without this a model arrives as a pile of
 * parts to be re-connected by hand.
 */
export function assembleModelPrefab(name: string, meshes: ImportedMesh[],
                                    options: PrefabAssembly = {}): PrefabData {
    const refs = options.refs ?? {};
    const entities: PrefabEntityData[] = [];
    const nodes = options.nodes ?? [];

    const emitNode = (node: ImportedNode, parent: string | null, rootScale?: number): string => {
        const id = `n${node.index}`;
        const drawn = node.meshes.map(i => meshes[i]).filter((m): m is ImportedMesh => !!m);
        // One primitive rides the node itself; several cannot, since a MeshRenderer
        // draws one mesh — they become its children, at its own origin.
        const own = drawn.length === 1 && drawn[0]
            ? [meshComponent(drawn[0], name, refs), ...lodComponent(drawn[0], refs), ...skinComponent(drawn[0]),
               ...morphComponent(drawn[0])] : [];
        const self = entity(id, node.name, parent, [
            transformComponent(node, rootScale), ...own,
            ...(node.light ? [lightComponent(node.light, options.scale ?? 1)] : []),
            ...(node.camera ? [cameraComponent(node.camera)] : []),
            ...(node.visibility !== undefined ? [{ type: 'NodeVisibility', data: { visible: node.visibility } }] : []),
        ]);
        entities.push(self);
        if (node.billboard !== undefined) self.components.push({ type: 'Billboard', data: { mode: node.billboard, enabled: true } });
        if (node.particle) self.components.push({ type: 'ParticleEmitter', data: { ...node.particle.emitter,
            ...(node.particle.texture ? { texture: imageRef(node.particle.texture, options.refs ?? {}) } : {}) } },
            { type: 'ParticleModelUnits', data: node.particle.units });
        if (node.physics) {
            const physics = node.physics;
            if (physics.parts.length) self.components.push(
                { type: 'RigidBody3D', data: { bodyType: physics.bodyType, ...physics.settings } },
                { type: 'CompoundCollider3D', data: { parts: physics.parts, mass: physics.mass, isSensor: physics.isSensor, enabled: true } },
            );
            if (physics.triangleMesh !== undefined) {
                const mesh = meshes[physics.triangleMesh]!;
                const collisionId = `${id}_collision`;
                self.children.push(collisionId);
                entities.push(entity(collisionId, `${node.name}_Collision`, id, [transformComponent(),
                    { type: 'RigidBody3D', data: { bodyType: 0 } },
                    { type: 'MeshCollider3D', data: { mesh: `${refs.prefix ?? ''}${refs.meshNames?.get(mesh) ?? mesh.name}.esmesh`, enabled: true } },
                ]));
            }
        }
        if (refs.springBones) addExplicitSpringBones(node, self, entities, options.scale ?? 1);
        if (own.length === 0) {
            drawn.forEach((mesh, i) => {
                const childId = `${id}_p${i}`;
                self.children.push(childId);
                entities.push(entity(childId, mesh.name, id,
                                     [transformComponent(), meshComponent(mesh, name, refs),
                                      ...lodComponent(mesh, refs), ...skinComponent(mesh), ...morphComponent(mesh)]));
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
                                 [transformComponent(), meshComponent(mesh, name, refs),
                                  ...lodComponent(mesh, refs)]));
        });
    }
    if (refs.springBones) springBoneComponents(entities, options.scale ?? 1);
    // The player rides the root, which is the entity a clip's childPaths are
    // resolved from — the same root the tracks were addressed against.
    if (options.timeline && entities[0]) {
        entities[0].components.push({ type: 'TimelinePlayer', data: {
            timeline: options.timeline, playing: false,
        } });
    }
    return {
        version: PREFAB_FORMAT_VERSION, name,
        rootEntityId: entities[0]!.prefabEntityId, entities,
    };
}
