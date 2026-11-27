// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cutWorld.ts
 * @brief   One authored world, cut — the entry both hosts of a streamed world go
 *          through.
 *
 * @details A cook writes the result to files and a play realm keeps it in memory,
 *          and that is the ONLY difference between them: same partition, same
 *          manifest, same cell names, same paths. Two hosts assembling their own
 *          manifests is how a world comes to mean one thing in the editor and
 *          another in the package — the failure this module exists to make
 *          impossible, because there is nowhere left to disagree.
 */

import { partitionWorld, type PartitionOptions, type PrefabRoot } from './partitionWorld';
import type { WorldCell, WorldManifest } from './cells';
import type { SceneData } from '../scene/scene';
import { flattenPrefab } from '../prefab/flatten';
import { createPrefabSourceLoader } from '../prefab/source';
import type { PrefabData, PrefabEntityData } from '../prefab/types';
import { cloneComponentData } from '../prefab/clone';
import { RuntimeConfig } from '../defaults';
import { runWithConcurrency } from '../util/runWithConcurrency';

/** Where cooked world content goes, package-relative. */
export const WORLD_DIR = 'world';

/** A package-relative file stem shared by a world's documents and meshes. Escape the marker too so names stay distinct. */
export function worldFileStem(name: string): string {
    const stem = name.replace(/[^\p{L}\p{N}_.-]/gu, char => `~${char.codePointAt(0)!.toString(16)}~`);
    return `${WORLD_DIR}/${stem}`;
}

/**
 * Where a cell's document ships. A realm that delivers cells from memory never
 * fetches this, but it carries the same value: two manifests that differ in a
 * field one side ignores are still two manifests, and nothing would catch it.
 */
export function cellDocumentPath(cellName: string): string {
    return `${worldFileStem(cellName)}.json`;
}

/** Where a world's manifest ships, package-relative. */
export function worldManifestPath(sceneName: string): string {
    return `${worldFileStem(sceneName)}.world.json`;
}

/** An authored world, cut into what ships and what arrives. @experimental */
export interface CutWorld {
    /** What residency is told about the world — byte-identical on both hosts. */
    manifest: WorldManifest;
    /** The entry scene as it now boots: everything residency never removes. */
    persistent: SceneData;
    /** Cell name → its document, for a host that delivers cells from memory. */
    documents: Map<string, SceneData>;
    /**
     * Why this world cannot be cut. A hard reference across a residency boundary
     * is one: shipping it produces a handle that dangles the first time a player
     * walks away. Non-empty means refuse — in a build AND in Play, because a
     * world the editor agreed to run is one the author will ship.
     */
    errors: readonly string[];
    warnings: readonly string[];
    /** The effective declaration, including prefab inheritance and instance overrides. */
    streamedWorld?: Readonly<Record<string, unknown>>;
}

/**
 * Cut `scene`, or answer null when it never declared itself a streamed world —
 * which is every scene that came before this and every small one that stays whole.
 */
export function cutWorld(
    scene: SceneData, sceneName: string, options: PartitionOptions,
): CutWorld | null {
    const partition = partitionWorld(scene, sceneName, options);
    if (partition === null) return null;

    const cells: WorldCell[] = partition.cells.map((cell) => ({
        name: cell.name,
        path: cellDocumentPath(cell.name),
        x: cell.x, z: cell.z,
        minX: cell.minX, minZ: cell.minZ, maxX: cell.maxX, maxZ: cell.maxZ,
        entityCount: cell.entityCount,
        rootCount: cell.rootCount,
    }));
    const documents = new Map<string, SceneData>();
    for (const cell of partition.cells) documents.set(cell.name, cell.data);

    return {
        manifest: {
            version: 1,
            scene: sceneName,
            cellSize: partition.cellSize,
            ...(partition.plane === 'xy' ? { plane: 'xy' as const } : {}),
            persistentRefs: partition.persistentRefs,
            cells,
        },
        persistent: partition.persistent,
        documents,
        errors: partition.errors,
        warnings: partition.warnings,
        streamedWorld: partition.streamedWorld,
    };
}

/** The shape of a `.esprefab` this reads — only the root's placement. */
interface PrefabDocument {
    rootEntityId?: string;
    basePrefab?: string;
    overrides?: unknown[];
    entities?: Array<Pick<PrefabEntityData, 'prefabEntityId'> & Partial<Pick<PrefabEntityData, 'components' | 'nestedPrefab'>>>;
}

/** Where a prefab asset's root sits, from its document. Null if it has no root. */
export function prefabRootOf(document: unknown): PrefabRoot | null {
    const root = authoredPrefabRoot(document as PrefabDocument | null);
    if (!root) return null;
    const { transform: _transform, ...placement } = rootPlacement(root.prefabEntityId, root.components);
    return placement;
}

function authoredPrefabRoot(prefab: PrefabDocument | null) {
    if (!Array.isArray(prefab?.entities)) return undefined;
    const rootId = prefab.rootEntityId ?? '0';
    return prefab.entities.find(entity => entity?.prefabEntityId === rootId);
}

function rootPlacement(rootId: string, components: PrefabEntityData['components'] | undefined): PrefabRoot {
    const data = components?.find((c) => c.type === 'Transform')?.data;
    const declaration = components?.find((c) => c.type === 'StreamedWorld');
    const at = (data?.position ?? {}) as Partial<PrefabRoot['position']>;
    return {
        rootId,
        position: { x: at.x ?? 0, y: at.y ?? 0, z: at.z ?? 0 },
        transform: data ? cloneComponentData(data) : null,
        ...(components?.some(component => component.type === 'WorldPersistent') ? { worldPersistent: true } : {}),
        ...(declaration ? { streamedWorld: cloneComponentData(declaration.data ?? {}) } : {}),
    };
}

/**
 * Read every prefab `scene` instances, and answer where each one's root sits.
 *
 * A synchronous lookup, resolved up front, because the partition is pure and one
 * that could await inside it would not be. Both hosts come through here; they
 * differ only in how the bytes are fetched.
 */
export async function resolvePrefabRoots(
    scene: SceneData, read: (ref: string) => Promise<unknown | null>,
): Promise<(ref: string) => PrefabRoot | null> {
    const documents = new Map<string, Promise<PrefabData | null>>();
    const readDocument = (ref: string) => {
        let pending = documents.get(ref);
        if (!pending) {
            pending = Promise.resolve().then(() => read(ref) as Promise<PrefabData | null>).catch(() => null);
            documents.set(ref, pending);
        }
        return pending;
    };
    const readSource = createPrefabSourceLoader(readDocument);
    const roots = new Map<string, PrefabRoot | null>();
    const refs = new Set<string>();
    for (const entry of (scene.entities ?? []) as unknown as Array<{ prefab?: string }>) {
        if (typeof entry.prefab === 'string') refs.add(entry.prefab);
    }
    // The cook and Play share the same preload limit and the same in-flight
    // document cache, including reads started while expanding variants.
    await runWithConcurrency(Array.from(refs, ref => async () => {
        const document = await readDocument(ref);
        const authoredRoot = authoredPrefabRoot(document);
        let placement: PrefabRoot | null;
        // A plain root can be read without expanding the rest of its subtree.
        if (document?.basePrefab || document?.overrides?.length || authoredRoot?.nestedPrefab) {
            try {
                const source = await readSource(ref);
                let nextId = 1;
                const { entities, rootId } = flattenPrefab(source.prefab, [], {
                    allocateId: () => nextId++,
                    loadPrefab: dependency => source.dependencies.get(dependency) ?? null,
                });
                const root = entities.find(entity => entity.id === rootId);
                placement = root ? rootPlacement(root.prefabEntityId, root.components) : null;
            } catch {
                placement = null;
            }
        } else {
            placement = authoredRoot ? rootPlacement(authoredRoot.prefabEntityId, authoredRoot.components) : null;
        }
        roots.set(ref, placement);
    }), RuntimeConfig.preloadConcurrency);
    return (ref) => roots.get(ref) ?? null;
}
