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
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideRoot, resolveInside } from '../fs/pathSandbox';
import { adoptOrphan } from './assetMeta';
import {
    encodeImportedMesh, assembleModelPrefab, materialProducts, applyLightmapUV, importedImageSettings,
    generateLods, lodName, encodeGeneratedLod, orderHairTriangles,
    type ImportedNode, type SpecularMapReading,
} from './modelImport';
import { modelStem, readModelSource } from './readModelSource';

export interface ModelImportSettings {
    scale: number;
    lightmapUV: boolean;
    specularMap: SpecularMapReading;
    lodLevels: number;
    lodMinTriangles: number;
    characters: boolean;
    springBones: boolean;
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

export interface ImportModelOptions {
    /** The project root; every product lands inside it. */
    root: string;
    /** Project-relative folder for the products. */
    destDir: string;
    /** The model file. It may lie outside the project (a source being taken over), in which case it is only read. */
    absSource: string;
    /** Where the source's own relative uris resolve from, when it is not beside the source. */
    originDir?: string;
    /** Overrides for what the source's `.meta` says. */
    settings?: Partial<ModelImportSettings>;
    /** Called with the project-relative path just before a file is written. */
    beforeWrite?(rel: string): Promise<void> | void;
}

const DEFAULTS: ModelImportSettings = {
    scale: 1, lightmapUV: false, specularMap: 'color', lodLevels: 0, lodMinTriangles: 256, characters: false, springBones: false,
};

/** What a model's `.meta` asks of the import; the schema's defaults where it is silent or unreadable. One read, because two would be two chances to disagree. */
export function modelSettings(absSource: string): ModelImportSettings {
    try {
        const meta = JSON.parse(readFileSync(`${absSource}.meta`, 'utf8')) as
            { importer?: { scale?: unknown; lightmapUV?: unknown; specularMap?: unknown;
                lodLevels?: unknown; lodMinTriangles?: unknown; characterMaterials?: unknown; springBones?: unknown } };
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
            characters: imp?.characterMaterials === 'auto',
            springBones: imp?.springBones === 'auto',
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

/**
 * Import `absSource` into `destDir` of the project at `root`, writing the meshes, the images it carries, the materials, the clips and the
 * prefab that assembles them.
 */
export async function importModelFile(opts: ImportModelOptions): Promise<ImportedModel> {
    const { root, destDir, absSource } = opts;
    const absDir = destDir ? resolveInside(root, destDir, 'model destination') : path.resolve(root);
    await mkdir(absDir, { recursive: true });
    const sourceDir = opts.originDir ?? path.dirname(absSource);
    const stem = modelStem(absSource);
    const projectRef = (abs: string): string => path.relative(path.resolve(root), abs).split(path.sep).join('/');
    const { scale, lightmapUV, specularMap, lodLevels, lodMinTriangles, characters, springBones } = { ...modelSettings(absSource), ...opts.settings };

    const { meshes, textures, nodes, animations, externalFiles, warnings } = await readModelSource(
        new Uint8Array(readFileSync(absSource)), stem,
        {
            filename: absSource,
            externalBuffers: (uri) => {
                const abs = path.join(sourceDir, decodeURIComponent(uri));
                return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
            },
            specularMap,
        },
    );

    // Before anything is written, because it splits vertices: every product below is built from the mesh data this leaves behind.
    if (lightmapUV) warnings.push(...applyLightmapUV(meshes));
    // After it, because a level is a collapse of the mesh as it will be written.
    warnings.push(...await generateLods(meshes, { levels: lodLevels, minTriangles: lodMinTriangles }));
    if (characters) orderHairTriangles(meshes);

    // What each image's sampler asked for, by product name — applied when its `.meta` is first minted and never after: the file's settings are the user's.
    const imageSettings = new Map<string, Record<string, unknown>>(
        [...importedImageSettings(meshes)].map(([file, { settings }]) => [file, { ...settings }]));

    const products: string[] = [];
    const write = async (name: string, bytes: Uint8Array | string): Promise<string> => {
        const rel = destDir ? `${destDir}/${name}` : name;
        await opts.beforeWrite?.(rel);
        await writeFile(path.join(absDir, name), bytes);
        // keeps the uuid a re-import must not change
        await adoptOrphan(path.join(absDir, name), imageSettings.get(name));
        products.push(rel);
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
            await adoptOrphan(abs, imageSettings.get(uri));
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
        externalRefs.set(uri, rel);
    }

    const meshFiles: string[] = [];
    for (const mesh of meshes) {
        meshFiles.push(await write(`${mesh.name}.esmesh`, encodeImportedMesh(mesh)));
        for (const [i, lod] of (mesh.lods ?? []).entries()) {
            await write(`${lodName(mesh, i + 1)}.esmesh`, encodeGeneratedLod(lod));
        }
    }
    for (const texture of textures) await write(texture.name, texture.bytes);
    const refs = { prefix: destDir ? `${destDir}/` : '', external, characters, springBones };
    for (const material of materialProducts(meshes, stem, refs)) {
        await write(`${material.name}.esmaterial`, `${JSON.stringify(material.data, null, 2)}\n`);
    }
    let firstClip: string | undefined;
    const clips = new Map<string, string>();
    for (const animation of animations) {
        const rel = await write(`${animation.name}.estimeline`, `${JSON.stringify(animation.document, null, 2)}\n`);
        firstClip ??= rel;
        clips.set(animation.name.startsWith(`${stem}_`) ? animation.name.slice(stem.length + 1) : animation.name, rel);
    }
    let prefabRef: string | undefined;
    if (meshes.length > 0) {
        const prefab = assembleModelPrefab(stem, meshes, { refs, nodes, scale, timeline: firstClip });
        prefabRef = await write(`${stem}.esprefab`, `${JSON.stringify(prefab, null, 2)}\n`);
        // Models are authored in metres and a world unit is a design pixel, so a real-world model arrives a few pixels across. Said, not
        // guessed at: the scale is the user's, and this is where they find out they have one.
        const extent = Math.max(...meshes.flatMap((m) => m.data.aabbMax.map((v, i) => v - (m.data.aabbMin[i] ?? 0))));
        if (scale === 1 && extent < 8) {
            warnings.push(`the model is ${extent.toFixed(2)} units across — set Scale in its import settings and reimport if it should be bigger`);
        }
    }

    const nodeMeshes = new Map<string, string[]>();
    collectNodeMeshes(nodes, meshFiles, nodeMeshes);
    return { products, warnings, stem, prefab: prefabRef, nodeMeshes, clips };
}
