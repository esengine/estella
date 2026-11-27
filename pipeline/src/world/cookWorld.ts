// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cookWorld.ts
 * @brief   Writing a cut world to a package.
 *
 * @details The cut itself is `cutWorld`, which the editor's play realm also goes
 *          through; what is here is the half only a build does — reading prefab
 *          roots off disk, and putting the documents where the manifest says.
 *
 *          Runs over the COOKED payload rather than the project: by then every
 *          asset reference is in the form the runtime resolves, so a cell is the
 *          same bytes the whole scene would have been, minus the places that are
 *          somewhere else.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { decodeMesh, getComponentRegistry, type FarProxyHost, type PrefabData, type SceneData } from 'esengine';
import {
    assembleFarProxies, cutWorld, resolvePrefabRoots, worldManifestPath, registryEntityFields, farProxySettings, WORLD_DIR,
} from 'esengine/node';
import { readCachedAssetIndex, scanAssetDatabase, type AssetIndex } from '../assets/assetDb';
import { resolveIndexedAssetRef } from '../../../sdk/src/asset/AssetRegistry';
import { assertWorldManifest } from '../../../sdk/src/residency/manifest';
import { streamedWorldDeclaration } from '../../../sdk/src/residency/partitionWorld';
import { simplifyFarProxyMesh } from '../assets/meshSimplify';
import { resolveInside } from '../fs/pathSandbox';
import { writeFarProxies, type FarProxyCookResult } from './farProxy';
import { extractProjectSchemas } from '../project/extractSchemas';
import { readManifest } from '../project/readProject';
import { resolveScripts } from '../project/format';

/** One streamed scene, as `game.config.json` names it. */
export interface CookedWorld {
    scene: string;
    manifest: string;
}

export interface CookWorldsResult {
    worlds: CookedWorld[];
    warnings: string[];
    /** Per world that asked for far proxies, what baking them did. */
    farProxies: Array<{ scene: string } & FarProxyCookResult>;
}

/** Partitioning and far proxies read source geometry from the same project index, before packaging renames the files. */
function worldAssets(root: string, index: AssetIndex): FarProxyHost {
    const paths = new Map(index.entries.map(entry => [entry.uuid.toLowerCase(), entry.path]));
    return {
        async loadPrefab(ref) {
            const relative = resolveIndexedAssetRef(ref, paths);
            if (!relative) return null;
            const file = resolveInside(root, relative.replace(/^\//, ''), 'project root');
            return JSON.parse(await readFile(file, 'utf8')) as PrefabData;
        },
        async readMesh(ref) {
            const relative = resolveIndexedAssetRef(ref, paths);
            if (!relative?.endsWith('.esmesh')) return null;
            return decodeMesh(new Uint8Array(await readFile(path.join(root, relative))));
        },
    };
}

function lazyWorldAssets(root: string): () => Promise<FarProxyHost> {
    let assets: Promise<FarProxyHost> | undefined;
    return () => assets ??= (async () => {
        const index = await readCachedAssetIndex(root)
            ?? (await scanAssetDatabase(root, { write: false, adopt: false })).index;
        return worldAssets(root, index);
    })();
}

/** Which of `scenes` have a streamed world declaration understood by Play and the world cooker. */
export async function streamedScenes(
    root: string, scenes: ReadonlyArray<{ name: string; path: string }>,
): Promise<string[]> {
    const declared: string[] = [];
    const assets = lazyWorldAssets(root);
    for (const scene of scenes) {
        try {
            const document = JSON.parse(await readFile(path.join(root, scene.path), 'utf8')) as SceneData;
            const resolvePrefab = await resolvePrefabRoots(document, async ref => (await assets()).loadPrefab(ref));
            if (streamedWorldDeclaration(document, resolvePrefab)) {
                declared.push(scene.name);
            }
        } catch { /* The scene loader handles unreadable documents. */ }
    }
    return declared;
}

/**
 * Cut every staged scene that declares itself streamed.
 *
 * Throws on a partition error. A hard reference across a residency boundary is
 * not a warning: shipping it produces a handle that dangles the first time a
 * player walks away, which is the failure this whole stage exists to prevent.
 */
export async function cookWorlds(
    root: string, payloadDir: string, scenes: ReadonlyArray<{ name: string; path: string }>,
    declarations?: { sdkDir: string; packagesDir: string },
): Promise<CookWorldsResult> {
    const worlds: CookedWorld[] = [];
    const warnings: string[] = [];
    const farProxies: CookWorldsResult['farProxies'] = [];
    const sceneNames = new Set(scenes.map(scene => scene.name));
    const assets = lazyWorldAssets(root);
    let entityFieldsOf = registryEntityFields();
    let projectFieldsLoaded = false;

    for (const scene of scenes) {
        const staged = path.join(payloadDir, scene.path);
        let text: string;
        try {
            text = await readFile(staged, 'utf8');
        } catch {
            continue;  // not staged for this target
        }
        const document = JSON.parse(text) as SceneData;
        const resolvePrefab = await resolvePrefabRoots(document, async ref => (await assets()).loadPrefab(ref));
        if (declarations && !projectFieldsLoaded) {
            if (!streamedWorldDeclaration(document, resolvePrefab)) continue;
            const manifest = await readManifest(root);
            const entry = resolveScripts(manifest).register;
            const result = await extractProjectSchemas(root, {
                ...declarations, entry, required: manifest.scripts?.register !== undefined, writeCache: false,
            });
            if (!result.ok) throw new Error(`Cannot validate streamed world component references from ${entry}:\n${result.errors.join('\n')}`);
            warnings.push(...result.warnings);
            const projectFields = new Map(result.schemas.map(schema => [schema.name, schema.entityFields]));
            const registry = getComponentRegistry();
            entityFieldsOf = type => registry.get(type)?.entityFields ?? projectFields.get(type) ?? [];
            projectFieldsLoaded = true;
        }
        const cut = cutWorld(document, scene.name, {
            entityFieldsOf, resolvePrefab,
        });
        if (cut === null) continue;
        if (cut.errors.length > 0) {
            throw new Error(
                `scene "${scene.name}" cannot be cut into cells:\n`
                + cut.errors.map((e) => `  ${e}`).join('\n'),
            );
        }
        warnings.push(...cut.warnings.map((w) => `${scene.name}: ${w}`));

        const far = farProxySettings(document, cut);
        const proxies = far !== null && far.farDistance > 0
            ? await assembleFarProxies(cut, far, { ...await assets(), simplify: simplifyFarProxyMesh })
            : null;
        const manifestPath = worldManifestPath(scene.name);
        assertWorldManifest(cut.manifest, { scene: scene.name, path: manifestPath, sceneNames });

        await mkdir(path.join(payloadDir, WORLD_DIR), { recursive: true });
        if (proxies !== null) {
            const baked = await writeFarProxies(payloadDir, proxies);
            warnings.push(...baked.warnings.map((w) => `${scene.name}: ${w}`));
            farProxies.push({ scene: scene.name, ...baked });
        }
        for (const cell of cut.manifest.cells) {
            await writeFile(
                path.join(payloadDir, cell.path),
                JSON.stringify(cut.documents.get(cell.name)) + '\n',
            );
        }
        await writeFile(
            path.join(payloadDir, manifestPath), JSON.stringify(cut.manifest, null, 2) + '\n',
        );
        // The staged scene becomes the PERSISTENT world. What a package boots is
        // then the thing residency never removes, and the places arrive later.
        await writeFile(staged, JSON.stringify(cut.persistent) + '\n');
        worlds.push({ scene: scene.name, manifest: manifestPath });
    }

    return { worlds, warnings, farProxies };
}
