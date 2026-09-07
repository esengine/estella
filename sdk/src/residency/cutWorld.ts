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

import { partitionWorld, type PartitionOptions } from './partitionWorld';
import type { WorldCell, WorldManifest } from './cells';
import type { SceneData } from '../scene/scene';

/** Where cooked world content goes, package-relative. */
export const WORLD_DIR = 'world';

/** A file name that survives a scene living in a subdirectory. */
function fileSafe(name: string): string {
    return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * Where a cell's document ships. A realm that delivers cells from memory never
 * fetches this, but it carries the same value: two manifests that differ in a
 * field one side ignores are still two manifests, and nothing would catch it.
 */
export function cellDocumentPath(cellName: string): string {
    return `${WORLD_DIR}/${fileSafe(cellName)}.json`;
}

/** Where a world's manifest ships, package-relative. */
export function worldManifestPath(sceneName: string): string {
    return `${WORLD_DIR}/${fileSafe(sceneName)}.world.json`;
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
            persistentRefs: partition.persistentRefs,
            cells,
        },
        persistent: partition.persistent,
        documents,
        errors: partition.errors,
        warnings: partition.warnings,
    };
}
