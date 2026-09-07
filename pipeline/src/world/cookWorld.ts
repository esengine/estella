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
import type { SceneData, PrefabRoot } from 'esengine';
import { cutWorld, worldManifestPath, registryEntityFields, WORLD_DIR } from 'esengine/node';
import { readCachedAssetIndex, scanAssetDatabase, type AssetIndex } from '../assets/assetDb';

/** One streamed scene, as `game.config.json` names it. */
export interface CookedWorld {
    scene: string;
    manifest: string;
}

export interface CookWorldsResult {
    worlds: CookedWorld[];
    warnings: string[];
}

/**
 * Read the prefab an instance names, for the position an instance that does not
 * override it inherits. From the PROJECT rather than the payload: a prefab is
 * content-addressed by then, and where its root sits is the same either way.
 */
function prefabResolver(root: string, index: AssetIndex): (ref: string) => Promise<PrefabRoot | null> {
    const byUuid = new Map<string, string>();
    for (const entry of index.entries) byUuid.set(entry.uuid, entry.path);
    return async (ref: string): Promise<PrefabRoot | null> => {
        const uuid = ref.startsWith('@uuid:') ? ref.slice('@uuid:'.length) : null;
        const relative = uuid !== null ? byUuid.get(uuid) : ref;
        if (!relative) return null;
        try {
            const prefab = JSON.parse(await readFile(path.join(root, relative), 'utf8')) as {
                rootEntityId?: string;
                entities?: Array<{
                    prefabEntityId?: string;
                    components?: Array<{ type: string; data: Record<string, unknown> }>;
                }>;
            };
            const rootId = prefab.rootEntityId ?? '0';
            const rootEntity = (prefab.entities ?? []).find((e) => e.prefabEntityId === rootId);
            const transform = rootEntity?.components?.find((c) => c.type === 'Transform');
            const at = (transform?.data.position ?? {}) as Partial<{ x: number; y: number; z: number }>;
            return { rootId, position: { x: at.x ?? 0, y: at.y ?? 0, z: at.z ?? 0 } };
        } catch {
            return null;
        }
    };
}

/**
 * Which of `scenes` declare themselves streamed worlds.
 *
 * By the text, not by parsing: the answer decides whether a whole engine's
 * component registry gets loaded, and most scenes are not worlds.
 */
export async function streamedScenes(
    root: string, scenes: ReadonlyArray<{ name: string; path: string }>,
): Promise<string[]> {
    const declared: string[] = [];
    for (const scene of scenes) {
        try {
            if ((await readFile(path.join(root, scene.path), 'utf8')).includes('"StreamedWorld"')) {
                declared.push(scene.name);
            }
        } catch { /* not a file this target has */ }
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
): Promise<CookWorldsResult> {
    const worlds: CookedWorld[] = [];
    const warnings: string[] = [];
    let index: AssetIndex | null = null;
    let resolve: ((ref: string) => Promise<PrefabRoot | null>) | null = null;

    for (const scene of scenes) {
        const staged = path.join(payloadDir, scene.path);
        let text: string;
        try {
            text = await readFile(staged, 'utf8');
        } catch {
            continue;  // not staged for this target
        }
        // Cheap first: most scenes are not worlds, and the registry behind the
        // reference check costs a whole engine to load.
        if (!text.includes('"StreamedWorld"')) continue;

        if (resolve === null) {
            index = await readCachedAssetIndex(root)
                ?? (await scanAssetDatabase(root, { write: false, adopt: false })).index;
            resolve = prefabResolver(root, index);
        }
        // Prefab roots are read up front: partitioning is synchronous so a cook
        // that had to await inside it could not stay a pure function.
        const document = JSON.parse(text) as SceneData;
        const roots = new Map<string, PrefabRoot | null>();
        for (const entry of (document.entities ?? []) as Array<{ prefab?: string }>) {
            if (typeof entry.prefab === 'string' && !roots.has(entry.prefab)) {
                roots.set(entry.prefab, await resolve(entry.prefab));
            }
        }

        const cut = cutWorld(document, scene.name, {
            entityFieldsOf: registryEntityFields(),
            resolvePrefab: (ref) => roots.get(ref) ?? null,
        });
        if (cut === null) continue;
        if (cut.errors.length > 0) {
            throw new Error(
                `scene "${scene.name}" cannot be cut into cells:\n`
                + cut.errors.map((e) => `  ${e}`).join('\n'),
            );
        }
        warnings.push(...cut.warnings.map((w) => `${scene.name}: ${w}`));

        await mkdir(path.join(payloadDir, WORLD_DIR), { recursive: true });
        for (const cell of cut.manifest.cells) {
            await writeFile(
                path.join(payloadDir, cell.path),
                JSON.stringify(cut.documents.get(cell.name)) + '\n',
            );
        }
        const manifestPath = worldManifestPath(scene.name);
        await writeFile(
            path.join(payloadDir, manifestPath), JSON.stringify(cut.manifest, null, 2) + '\n',
        );
        // The staged scene becomes the PERSISTENT world. What a package boots is
        // then the thing residency never removes, and the places arrive later.
        await writeFile(staged, JSON.stringify(cut.persistent) + '\n');
        worlds.push({ scene: scene.name, manifest: manifestPath });
    }

    return { worlds, warnings };
}
