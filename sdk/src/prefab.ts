// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { DeferredRecord } from './prefab/deferred';
import { registerDeferredInstances } from './scene/deferredInstances';
import type { World } from './ecs/world';
import type { Entity } from './types';
import type { Assets } from './asset/Assets';
import { loadOwnedSceneWithAssets, SCENE_FORMAT_VERSION, type SceneData } from './scene/scene';
import {
    flattenPrefab,
    preloadNestedPrefabs,
    migratePrefabData,
    type PrefabData,
    type PrefabOverride,
    type FlattenContext,
} from './prefab/index';

export type {
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
    NestedPrefabRef,
    ProcessedEntity,
    MigrationResult,
    DiffOptions,
    ValidateResult,
    StaleOverride,
} from './prefab/index';
export {
    migratePrefabData,
    diffAgainstSource,
    validateOverrides,
    PREFAB_FORMAT_VERSION,
    cloneComponentData,
    cloneMetadata,
    bucketOverridesByEntity,
} from './prefab/index';

export interface InstantiatePrefabOptions {
    assets?: Assets;
    assetBaseUrl?: string;
    /** The parent must still accept the root after loading; failure rolls back the instance. */
    parent?: Entity;
    overrides?: PrefabOverride[];
    /**
     * Make the virtual instances nested in this prefab whole as well (see prefab/deferred.ts). By default they are made as roots
     * and left to be opened.
     */
    expandDeferred?: boolean;
}

/**
 * What instantiating a prefab answers: the root, and every entity the prefab
 * brought with it.
 *
 * @beta
 */
export interface InstantiatePrefabResult {
    root: Entity;
    entities: Map<number, Entity>;
}

export async function instantiatePrefab(
    world: World,
    prefab: PrefabData,
    options?: InstantiatePrefabOptions,
): Promise<InstantiatePrefabResult> {
    // Accept both current and legacy formats — callers that hand us raw JSON
    // from disk no longer have to migrate it themselves.
    const migratedTop = migratePrefabData(prefab);
    const normalized = migratedTop.data;

    const prefabCache = new Map<string, PrefabData>();

    if (options?.assets) {
        const assets = options.assets;
        await preloadNestedPrefabs(
            normalized,
            async (path) => {
                const lease = await assets.acquireTyped<{ data: PrefabData }>('prefab', path);
                try {
                    return migratePrefabData(lease.value.data).data;
                } finally { lease.release(); }
            },
            prefabCache,
        );
    }

    let nextId = 0;
    const deferred: DeferredRecord[] = [];

    const ctx: FlattenContext = {
        allocateId: () => nextId++,
        loadPrefab: (path: string) => prefabCache.get(path) ?? null,
        visited: new Set<string>(),
        ...(options?.expandDeferred ? {} : { deferred }),
    };

    const { entities: processed, rootId } = flattenPrefab(
        normalized,
        options?.overrides ?? [],
        ctx,
    );

    const sceneData: SceneData = {
        // The produced value is a SCENE, so it carries the scene format version —
        // not the prefab's format version (which `normalized` just migrated).
        version: SCENE_FORMAT_VERSION,
        name: normalized.name,
        entities: processed.map(e => ({
            id: e.id,
            name: e.name,
            parent: e.parent,
            children: e.children,
            components: e.components,
            visible: e.visible,
        })),
    };

    const entityMap = await loadOwnedSceneWithAssets(world, sceneData, {
        assets: options?.assets,
        assetBaseUrl: options?.assetBaseUrl,
    });

    registerDeferredInstances(world, deferred, entityMap);
    const root = entityMap.get(rootId)!;
    if (options?.parent !== undefined && !world.trySetParent(root, options.parent)) {
        for (const entity of entityMap.values()) {
            if (world.valid(entity)) world.despawn(entity);
        }
        throw new Error(`Prefab "${normalized.name}" could not attach to parent ${options.parent}`);
    }

    return { root, entities: entityMap };
}
