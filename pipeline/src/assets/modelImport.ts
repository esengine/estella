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
    MeshChannel, encodeMesh, PREFAB_FORMAT_VERSION, TIMELINE_FORMAT_VERSION,
    MATERIAL_FORMAT_VERSION, BlendMode, CullMode,
    type MeshData, type MaterialAssetData, type PrefabData, type PrefabEntityData,
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
    /** Source node indices of the joints its `Joints` channel indexes, in order.
     *  Absent for geometry nothing skins. */
    skinJoints?: number[];
}

/** Where a material's image comes from: a product this import writes, or a file already on disk. */
export interface ImportedImageRef {
    /** Product name (no directory) when written, else the source's own uri. */
    file: string;
    /** True for a uri the source points at — an existing file is referenced, never copied. */
    external: boolean;
    /** Import settings the source's sampler asks for, in the engine's own words.
     *  Absent where the source names no sampler (its defaults are the engine's). */
    settings?: { filterMode?: 'nearest' | 'linear'; wrapMode?: 'repeat' | 'clamp' | 'mirror' };
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
    baseColorTexture?: ImportedImageRef;
    /** Tangent-space normal map; the engine derives its tangent frame per pixel. */
    normalTexture?: ImportedImageRef;
    /** Light the surface makes, unaffected by the scene's lights. */
    emissive?: [number, number, number];
    emissiveTexture?: ImportedImageRef;
    /** Ambient occlusion in the map's red channel, scaled by @ref occlusionStrength. */
    occlusionTexture?: ImportedImageRef;
    occlusionStrength?: number;
    /** How metal and how rough the surface is, as constants. */
    metallic?: number;
    roughness?: number;
    /** glTF's packing: roughness in green, metal in blue, multiplying the factors. */
    metallicRoughnessTexture?: ImportedImageRef;
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
}

/** One of the source's animations as the `.estimeline` document it will be written to. */
export interface ImportedAnimation {
    /** `<stem>_<animation name>` — named for the file it will be written to. */
    name: string;
    document: Record<string, unknown>;
}

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
    channels: Map<string, OutKeyframe[]>;
}

/**
 * An animation as an `.estimeline` document. Channels are grouped per target
 * node, since a track drives one component on one entity and the runtime reads
 * and writes that component once per track.
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
        tracks: [...byNode].map(([childPath, entry]) => ({
            type: 'property', name: entry.node, childPath, component: 'Transform',
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

/** The bytes to write for an imported mesh. */
export function encodeImportedMesh(mesh: ImportedMesh): Uint8Array {
    return encodeMesh(mesh.data);
}

/** How a product is spelled where a component refers to it. */
export interface ProductRefs {
    /** Prepended to every product name, e.g. `assets/models/` — the project-relative dir. */
    prefix?: string;
    /** An external image uri (relative to the source) → the ref a component carries. */
    external?: (uri: string) => string;
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
 * Whether this material says anything a MeshRenderer's own fields cannot: shading is
 * per-material constants and samplers, and the component has neither. A metal-
 * roughness pair the engine's defaults already are needs nothing written — but
 * glTF defaults both factors to 1, so most materials do.
 */
function needsMaterial(material: ImportedMaterial | undefined): material is ImportedMaterial {
    return !!material && !!(material.normalTexture || material.emissive || material.emissiveTexture
        || material.occlusionTexture || material.alphaCutoff || material.metallicRoughnessTexture
        || (material.metallic ?? 0) !== 0 || (material.roughness ?? 1) !== 1);
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
export function materialProducts(meshes: ImportedMesh[], stem: string,
                                 refs: ProductRefs = {}): ImportedMaterialAsset[] {
    const out: ImportedMaterialAsset[] = [];
    const seen = new Set<number>();
    for (const mesh of meshes) {
        const material = mesh.material;
        if (!needsMaterial(material) || seen.has(material.index)) continue;
        seen.add(material.index);

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
        bind('u_metallicRoughnessMap', material.metallicRoughnessTexture);
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

        out.push({
            name: materialName(stem, material),
            data: {
                version: MATERIAL_FORMAT_VERSION,
                type: 'material',
                shader: 'builtin:model',
                blendMode: material.opaque ? BlendMode.None : BlendMode.Normal,
                depthTest: material.opaque,
                depthWrite: material.opaque,
                cull: material.cullBackfaces ? CullMode.Back : CullMode.None,
                properties,
            },
            images,
        });
    }
    return out;
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
    const material = needsMaterial(mesh.material)
        ? `${prefix}${materialName(stem, mesh.material)}.esmaterial` : null;
    // A normal map needs normals to perturb; without them the engine draws the
    // unlit variant and the map would be a reference to nothing.
    const normalMap = !material && hasNormals && mesh.material?.normalTexture
        ? imageRef(mesh.material.normalTexture, refs) : null;
    return { type: 'MeshRenderer', data: {
        mesh: `${prefix}${mesh.name}.esmesh`,
        // Geometry that carries normals was authored to be shaded, so the product
        // says so. Written rather than assumed: `lit` is a field a user can turn
        // off, and an import that left it out would be one the engine had to guess.
        ...(hasNormals ? { lit: true } : {}),
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
            ? [meshComponent(drawn[0], name, refs), ...skinComponent(drawn[0])] : [];
        const self = entity(id, node.name, parent,
                            [transformComponent(node, rootScale), ...own]);
        entities.push(self);
        if (own.length === 0) {
            drawn.forEach((mesh, i) => {
                const childId = `${id}_p${i}`;
                self.children.push(childId);
                entities.push(entity(childId, mesh.name, id,
                                     [transformComponent(), meshComponent(mesh, name, refs),
                                      ...skinComponent(mesh)]));
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
                                 [transformComponent(), meshComponent(mesh, name, refs)]));
        });
    }
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
