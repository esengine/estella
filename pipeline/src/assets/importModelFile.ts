// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Importing one model file into a project: the meshes, the images it carries, the materials, the clips and the prefab that
 *        assembles them.
 *
 * The editor imports a model dropped into the project, and the Cocos importer imports the models a Cocos project uses; both ask for the
 * same thing, so the writing is here and each caller says only where the source is, where the products go and what to do just before
 * a file is written (the editor journals it for undo).
 */
import { rebindStrayVertices } from './strayJoints';
import { extractRootMotion } from './rootMotionExtract';
import { maxBonesFor, type SkinningConfig } from '../project/skinning';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isInsideRoot, resolveInside } from '../fs/pathSandbox';
import { adoptOrphan, importSourceOf } from './assetMeta';
import { META_EXT } from './contentPolicy';
import { contentHashOf } from '../../../sdk/src/asset/contentHash';
import { sourceProductWriter, type SourceFileLocation } from './sourceProducts';
import {
    encodeImportedMesh, assembleModelPrefab, materialProducts, applyLightmapUV, importedImageSettings,
    capTriangles, clusterMeshes, generateLods, buildSkins, lodName, encodeGeneratedLod, orderHairTriangles, IMPORTED_MATERIAL_IMAGE_SLOTS,
    type ImportedMesh, type ImportedNode, type ImportedTexture, type SpecularMapReading,
    trimClipLeadIn,
} from './modelImport';
import { modelStem, readModelSource } from './readModelSource';
import { modelGIProducts } from './modelGIProducts';
import { parseManifest } from '../project/format';

export interface ModelImportSettings {
    scale: number;
    lightmapUV: boolean;
    specularMap: SpecularMapReading;
    lodLevels: number;
    lodMinTriangles: number;
    /** Cut the model to at most this many triangles on import; 0 leaves it as it is. */
    maxTriangles: number;
    /** Give each dense static mesh a cluster hierarchy, so a view draws only the triangles it can tell apart (clusterLod.ts). */
    clusterLod: boolean;
    characters: boolean;
    springBones: boolean;
    /**
     * Take each clip's ground travel out of its skeleton's top joint and state it as a root track (rootMotionExtract.ts):
     * `steady` at one rate (a loop), `path` along the joint's own course (a clip whose pace changes). Off leaves it.
     */
    rootMotion: 'off' | 'steady' | 'path';
    /** Bake the distance field and surface cards used for dynamic lighting of each static mesh. */
    dynamicGI: boolean;
    /** Joints one skinned vertex may be moved by, 1..4; 0 takes the project's (Project Settings, Rendering, Skinning). */
    boneInfluenceLimit: number;
    /** Skin weights at 16 bits; null takes the project's. */
    highPrecisionSkinWeights: boolean | null;
}

export interface ImportedModel {
    /** Project-relative paths of everything written, in the order it was produced. */
    products: string[];
    /** What the source says that this engine cannot draw — reported, never dropped. */
    warnings: string[];
    /** The name the prefab and the products are stemmed from. */
    stem: string;
    /** Project-relative path of the prefab that assembles the model; absent when the file held no mesh. */
    prefab?: string;
    /** Each node of the source's hierarchy by its name, with the project-relative `.esmesh` of every primitive it draws. */
    nodeMeshes: Map<string, string[]>;
    /** The clips written, by the animation's own name (the product name without the `<stem>_` prefix). */
    clips: Map<string, string>;
}

export interface ImportModelOptions extends SourceFileLocation {
    /** Where the source's own relative uris resolve from, when it is not beside the source. */
    originDir?: string;
    /** Overrides for what the source's `.meta` says. */
    settings?: Partial<ModelImportSettings>;
    /** Optional diagnostics for the command-line import. */
    onProduct?(rel: string, detail: string): void;
}

const DEFAULTS: ModelImportSettings = {
    scale: 1, lightmapUV: false, specularMap: 'color', lodLevels: 0, lodMinTriangles: 256, maxTriangles: 0, clusterLod: false, characters: false, springBones: false, rootMotion: 'off', dynamicGI: false,
    boneInfluenceLimit: 0, highPrecisionSkinWeights: null,
};

/** What a model's `.meta` asks of the import; the schema's defaults where it is silent or unreadable. One read, because two would be two chances to disagree. */
export function modelSettings(absSource: string): ModelImportSettings {
    try {
        const meta = JSON.parse(readFileSync(`${absSource}.meta`, 'utf8')) as
            { importer?: { scale?: unknown; lightmapUV?: unknown; specularMap?: unknown;
                lodLevels?: unknown; lodMinTriangles?: unknown; maxTriangles?: unknown; clusterLod?: unknown; characterMaterials?: unknown; springBones?: unknown; rootMotion?: unknown; dynamicGI?: unknown;
                boneInfluenceLimit?: unknown; highPrecisionSkinWeights?: unknown } };
        const imp = meta.importer;
        const scale = imp?.scale;
        const levels = imp?.lodLevels;
        const minTriangles = imp?.lodMinTriangles;
        return {
            scale: typeof scale === 'number' && scale > 0 ? scale : 1,
            lightmapUV: imp?.lightmapUV === true,
            specularMap: imp?.specularMap === 'orm' ? 'orm' : 'color',
            lodLevels: typeof levels === 'number' ? Math.min(3, Math.max(0, Math.floor(levels))) : 0,
            lodMinTriangles: typeof minTriangles === 'number' && minTriangles >= 0 ? minTriangles : 256,
            maxTriangles: typeof imp?.maxTriangles === 'number' && imp.maxTriangles > 0 ? Math.floor(imp.maxTriangles) : 0,
            clusterLod: imp?.clusterLod === true,
            characters: imp?.characterMaterials === 'auto',
            springBones: imp?.springBones === 'auto',
            rootMotion: imp?.rootMotion === 'skeleton' ? 'steady' : imp?.rootMotion === 'skeleton-path' ? 'path' : 'off',
            dynamicGI: imp?.dynamicGI === true,
            boneInfluenceLimit: typeof imp?.boneInfluenceLimit === 'number' && imp.boneInfluenceLimit >= 1 && imp.boneInfluenceLimit <= 4
                ? Math.floor(imp.boneInfluenceLimit) : 0,
            highPrecisionSkinWeights: imp?.highPrecisionSkinWeights === 'on' ? true : imp?.highPrecisionSkinWeights === 'off' ? false : null,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

function collectNodeMeshes(nodes: ImportedNode[], meshFiles: string[], out: Map<string, string[]>): void {
    for (const node of nodes) {
        if (node.meshes.length > 0) {
            const files = node.meshes.map((i) => meshFiles[i]).filter((f): f is string => f !== undefined);
            out.set(node.name, [...(out.get(node.name) ?? []), ...files]);
        }
        collectNodeMeshes(node.children, meshFiles, out);
    }
}

/** Keep generated images on paths owned by this model. A collision must not
 *  replace another asset's pixels or transfer its existing UUID. */
async function placeModelTextures(
    textures: ImportedTexture[], meshes: ImportedMesh[], externalFiles: string[], absDir: string, sourceUuid: string,
): Promise<void> {
    const authored = new Set(externalFiles.map(file => path.posix.normalize(file.replace(/\\/g, '/')).toLowerCase()));
    const reserved = new Set([...authored, ...textures.map(texture => texture.name.toLowerCase())]);
    const replacements = new Map<string, string>();
    const stateOf = async (name: string) => {
        const abs = resolveInside(absDir, name, 'product directory');
        if (existsSync(abs + META_EXT)) {
            resolveInside(absDir, name + META_EXT, 'product directory');
            return await importSourceOf(abs) === sourceUuid ? 'owned' : 'occupied';
        }
        return existsSync(abs) ? 'occupied' : 'free';
    };
    for (const texture of textures) {
        const original = texture.name;
        const preferred = authored.has(original.toLowerCase()) ? 'occupied' : await stateOf(original);
        if (preferred === 'owned') continue;
        const { name, ext } = path.posix.parse(original);
        const stem = `${name}_${contentHashOf(`${sourceUuid}:${original}`)}`;
        let candidate = `${stem}${ext}`;
        let state = await stateOf(candidate);
        for (let n = 2; reserved.has(candidate.toLowerCase()) || state === 'occupied'; n++) {
            candidate = `${stem}_${n}${ext}`;
            state = await stateOf(candidate);
        }
        if (preferred === 'free' && state !== 'owned') continue;
        reserved.add(candidate.toLowerCase());
        replacements.set(original, candidate);
        texture.name = candidate;
    }
    if (!replacements.size) return;
    for (const mesh of meshes) {
        if (!mesh.material) continue;
        for (const slot of IMPORTED_MATERIAL_IMAGE_SLOTS) {
            const image = mesh.material[slot];
            const replacement = image && !image.external ? replacements.get(image.file) : undefined;
            if (image && replacement) image.file = replacement;
        }
    }
}

/** The project's skinning settings (`features.rendering.skinning`), or none when it states none or is no project. */
function projectSkinning(root: string): SkinningConfig | undefined {
  try {
    const file = path.join(root, 'project.esproject');
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, 'utf8');
    return parseManifest(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)).features?.rendering?.skinning;
  } catch {
    return undefined;
  }
}

/** The project's units per metre (`features.physics.world3d.unitsPerMeter`), or the engine's 100 when it states none or is no project. */
function projectUnitsPerMeter(root: string): number {
  try {
    const file = path.join(root, 'project.esproject');
    if (!existsSync(file)) return 100;
    const text = readFileSync(file, 'utf8');
    return parseManifest(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)).features?.physics?.world3d?.unitsPerMeter ?? 100;
  } catch {
    return 100;
  }
}

/** Write the model's meshes, images, materials, animation clips and assembled prefab into the destination. */
export async function importModelFile(opts: ImportModelOptions): Promise<ImportedModel> {
    const { root, projectRoot = root, destDir, absSource } = opts;
    const sourceDir = opts.originDir ?? path.dirname(absSource);
    const stem = modelStem(absSource);
    const projectRef = (abs: string): string => path.relative(path.resolve(root), abs).split(path.sep).join('/');
    const { scale, lightmapUV, specularMap, lodLevels, lodMinTriangles, maxTriangles, clusterLod, characters, springBones, rootMotion, dynamicGI,
        boneInfluenceLimit, highPrecisionSkinWeights } = { ...modelSettings(absSource), ...opts.settings };

    const { meshes, textures, nodes, animations, externalFiles, warnings } = await readModelSource(
        new Uint8Array(readFileSync(absSource)), stem,
        {
            filename: absSource,
            externalBuffers: (file) => {
                const abs = path.join(sourceDir, file);
                return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
            },
            specularMap,
        },
    );

    // A model exported with the path its artist had on their machine (`E:/props/road/wall.png`) names an image that is not there, and which sits
    // beside the model in the project it was brought into: the name alone finds it, as a DCC tool's own import does.
    const beside = new Map<string, string>();
    for (const [i, uri] of externalFiles.entries()) {
        if (existsSync(path.join(sourceDir, uri))) continue;
        const name = uri.split(/[\\/]/).pop() ?? '';
        if (name === '' || name === uri || !existsSync(path.join(sourceDir, name))) continue;
        beside.set(uri, name);
        externalFiles[i] = name;
    }
    if (beside.size > 0) {
        for (const mesh of meshes) {
            const material = mesh.material as Record<string, unknown> | undefined;
            if (!material) continue;
            for (const slot of IMPORTED_MATERIAL_IMAGE_SLOTS) {
                const image = material[slot] as { external?: boolean; file?: string } | undefined;
                const found = image?.external && image.file !== undefined ? beside.get(image.file) : undefined;
                if (image && found !== undefined) image.file = found;
            }
        }
    }

    // Before any product is made from the skin: a vertex left on a joint nothing moves would be a sliver in every one.
    warnings.push(...rebindStrayVertices(meshes, nodes, animations.map((a) => a.document)));
    // First of all: the unwrap, the levels and every product below are made from what the budget leaves.
    warnings.push(...await capTriangles(meshes, maxTriangles));
    // Before anything is written, because it splits vertices: every product below is built from the mesh data this leaves behind.
    if (lightmapUV) warnings.push(...applyLightmapUV(meshes));
    // After the unwrap too: a hierarchy's indices name the vertices as they will be written. Before the levels, which a
    // mesh drawn through its clusters has no use for.
    if (clusterLod) warnings.push(...await clusterMeshes(meshes));
    // After it, because a level is a collapse of the mesh as it will be written.
    warnings.push(...await generateLods(meshes, { levels: lodLevels, minTriangles: lodMinTriangles }));
    if (characters) orderHairTriangles(meshes);
    // Last of the geometry: a chunk is a run of the triangles in the order they are written. Every platform's bone budget;
    // an export for a platform with a smaller one splits again (cookAssets).
    const skinning = projectSkinning(projectRoot);
    warnings.push(...buildSkins(meshes, {
        maxBonesPerChunk: maxBonesFor(skinning),
        influenceLimit: boneInfluenceLimit || skinning?.boneInfluenceLimit || 0,
        highPrecisionWeights: highPrecisionSkinWeights ?? skinning?.highPrecisionWeights ?? false,
    }));

    const writer = await sourceProductWriter(opts);
    const { absDir, products, sourceUuid } = writer;
    if (sourceUuid) await placeModelTextures(textures, meshes, externalFiles, absDir, sourceUuid);

    // What each image's sampler asked for, by product name — applied when its `.meta` is first minted and never after: the file's settings are the user's.
    const imageSettings = new Map<string, Record<string, unknown>>(
        [...importedImageSettings(meshes)].map(([file, { settings }]) => [file, { ...settings }]));

    const unitsPerMeter = projectUnitsPerMeter(projectRoot);
    const gi = await modelGIProducts(opts, writer, unitsPerMeter / Math.max(scale, 1e-6), dynamicGI, opts.onProduct);
    const write = async (name: string, bytes: Uint8Array | string, detail?: string, settle?: (abs: string) => Promise<unknown>): Promise<string> => {
        const rel = await writer.write(name, bytes, settle ?? (abs => adoptOrphan(abs, imageSettings.get(name))));
        opts.onProduct?.(rel, detail ?? `${bytes.length} bytes`);
        return rel;
    };

    // A file already in the project is left where it lies; one from outside comes WITH the model, at the same relative path. That is what
    // keeps the copied .gltf pointing at its own .bin, so re-importing it still works.
    const externalRefs = new Map<string, string>();
    const external = (uri: string): string => externalRefs.get(uri) ?? uri;
    for (const uri of externalFiles) {
        const abs = path.join(sourceDir, uri);
        if (!existsSync(abs)) continue;
        if (isInsideRoot(root, abs)) {
            // Minted only if it has no `.meta` yet: a data map must not arrive as colour.
            if (await adoptOrphan(abs, imageSettings.get(uri)) === 'adopted') opts.onProduct?.(projectRef(abs), 'registered');
            externalRefs.set(uri, projectRef(abs));
            continue;
        }
        // A uri that reaches outside the model's own folder cannot keep its shape in the project: it lands beside the model, and the
        // source's link to it stays broken — said out loud rather than silently rewritten.
        const keepsShape = isInsideRoot(absDir, path.resolve(absDir, uri));
        if (!keepsShape) warnings.push(`${uri} came from outside the model's folder; the copy is beside it`);
        const name = keepsShape ? uri : path.basename(uri);
        const rel = destDir ? `${destDir}/${name}` : name;
        const absDest = path.join(absDir, name);
        await opts.beforeWrite?.(rel);
        await mkdir(path.dirname(absDest), { recursive: true });
        await copyFile(abs, absDest);
        await adoptOrphan(absDest, imageSettings.get(uri));
        products.push(rel);
        opts.onProduct?.(rel, 'copied');
        externalRefs.set(uri, rel);
    }

    // A texture the model names whose file is not there is left off the material, and said: a reference that resolves to nothing fails to
    // load every time the model is used, and the material is no better for it (a model exported from a tool that kept its own paths names a
    // `.psd` the project never had).
    const lost = new Set(externalFiles.filter((uri) => !externalRefs.has(uri) && !existsSync(path.join(sourceDir, uri))));
    if (lost.size > 0) {
        for (const mesh of meshes) {
            const material = mesh.material as Record<string, unknown> | undefined;
            if (!material) continue;
            for (const slot of IMPORTED_MATERIAL_IMAGE_SLOTS) {
                const image = material[slot] as { external?: boolean; file?: string } | undefined;
                if (image?.external && image.file !== undefined && lost.has(image.file)) delete material[slot];
            }
        }
        for (const uri of lost) warnings.push(`${uri} is not there; the material is left without that texture`);
    }

    const meshFiles: string[] = [];
    const meshNames = new Map<ImportedMesh, string>();
    const geometryProducts = new Map<string, string>();
    for (const mesh of meshes) {
        const bytes = encodeImportedMesh(mesh);
        const levels = (mesh.lods ?? []).map(encodeGeneratedLod);
        // Exporters can repeat a mesh definition for every placed grid cell. Distinct
        // paths give identical geometry distinct GPU handles and prevent instancing.
        // Compare the complete encoded geometry (UVs, skin/morph data and every LOD),
        // not its name, bounds or vertex count. Per-instance bindings stay on the node.
        const hash = createHash('sha256');
        for (const part of [bytes, ...levels]) {
            const length = Buffer.allocUnsafe(4);
            length.writeUInt32LE(part.byteLength);
            hash.update(length).update(part);
        }
        // A different baked albedo or emission belongs to a different logical mesh, even when the cooked geometry shares bytes.
        if (dynamicGI && !mesh.data.inverseBindMatrices && !mesh.data.morph) {
            hash.update(JSON.stringify([mesh.material?.baseColor.slice(0, 3) ?? [1, 1, 1], mesh.material?.emissive ?? [0, 0, 0]]));
        }
        const signature = hash.digest('hex');
        const previous = geometryProducts.get(signature);
        const name = previous ?? mesh.name;
        geometryProducts.set(signature, name);
        meshNames.set(mesh, name);
        meshFiles.push(destDir ? `${destDir}/${name}.esmesh` : `${name}.esmesh`);
        // Keep old standalone references and UUIDs working when reimporting a model
        // first imported before sharing was supported. New imports write only the
        // canonical product; the prefab always references it, including its LODs.
        if (previous === undefined || existsSync(path.join(absDir, `${mesh.name}.esmesh`))) {
            const file = mesh.name + '.esmesh';
            await write(file, bytes, `${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles`, gi.bind(file, mesh));
            for (const [i, lodBytes] of levels.entries()) {
                const level = lodName(mesh, i + 1) + '.esmesh';
                await write(level, lodBytes, `LOD ${i + 1}: ${mesh.lods![i]!.triangleCount} triangles`, gi.bind(level));
            }
        }
    }
    for (const texture of textures) await write(texture.name, texture.bytes);
    const refs = { prefix: destDir ? `${destDir}/` : '', external, characters, springBones, meshNames };
    for (const material of materialProducts(meshes, stem, refs)) {
        await write(`${material.name}.esmaterial`, `${JSON.stringify(material.data, null, 2)}\n`, Object.keys(material.data.properties).join(', '));
    }
    let firstClip: string | undefined;
    const clips = new Map<string, string>();
    for (const animation of animations) {
        trimClipLeadIn(animation.document);
        if (rootMotion !== 'off') {
            const taken = extractRootMotion(animation.document, nodes, rootMotion);
            if (typeof taken === 'string') warnings.push(`${animation.name}: ${taken}`);
        }
        const tracks = Array.isArray(animation.document.tracks) ? animation.document.tracks.length : 0;
        const rel = await write(`${animation.name}.estimeline`, `${JSON.stringify(animation.document, null, 2)}\n`,
            `${animation.document.duration}s, ${tracks} track${tracks === 1 ? '' : 's'}`);
        firstClip ??= rel;
        clips.set(animation.name.startsWith(`${stem}_`) ? animation.name.slice(stem.length + 1) : animation.name, rel);
    }
    let prefabRef: string | undefined;
    if (meshes.length > 0) {
        const prefab = assembleModelPrefab(stem, meshes, { refs, nodes, scale, timeline: firstClip });
        prefabRef = await write(`${stem}.esprefab`, `${JSON.stringify(prefab, null, 2)}\n`,
            `${prefab.entities.length} entit${prefab.entities.length === 1 ? 'y' : 'ies'}`);
        // A model is authored in metres; what it measures in this project depends on the project's units per metre (Project Settings →
        // Physics → 3D: 100 unless set, 1 in a metre project). Under 8 cm in real terms, it is almost always a model whose Scale does not
        // match the project — said, not guessed at: the scale is the user's, and this is where they find out they have one.
        const extent = Math.max(...meshes.flatMap((m) => m.data.aabbMax.map((v, i) => v - (m.data.aabbMin[i] ?? 0))));
        const metres = (extent * scale) / unitsPerMeter;
        if (metres < 0.08 && scale !== unitsPerMeter) {
            warnings.push(`the model is ${metres.toFixed(3)} m across in this project (${unitsPerMeter} units a metre) — `
                + `set Scale to ${unitsPerMeter} in its import settings and reimport if it is a real-world size`);
        }
    }

    await gi.finish();
    const nodeMeshes = new Map<string, string[]>();
    collectNodeMeshes(nodes, meshFiles, nodeMeshes);
    return { products, warnings, stem, prefab: prefabRef, nodeMeshes, clips };
}
