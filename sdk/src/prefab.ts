import type { World } from './world';
import type { Entity } from './types';
import type { Assets } from './asset/Assets';
import { loadSceneWithAssets, type SceneData } from './scene';
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
    parent?: Entity;
    overrides?: PrefabOverride[];
}

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
                const result = await assets.loadPrefab(path);
                // Safety net: asset loader already migrates, but if a caller
                // side-loaded a PrefabData manually, re-migration is idempotent.
                return migratePrefabData(result.data as PrefabData).data;
            },
            prefabCache,
        );
    }

    let nextId = 0;

    const ctx: FlattenContext = {
        allocateId: () => nextId++,
        loadPrefab: (path: string) => prefabCache.get(path) ?? null,
        visited: new Set<string>(),
    };

    const { entities: processed, rootId } = flattenPrefab(
        normalized,
        options?.overrides ?? [],
        ctx,
    );

    const sceneData: SceneData = {
        version: normalized.version,
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

    const entityMap = await loadSceneWithAssets(world, sceneData, {
        assets: options?.assets,
        assetBaseUrl: options?.assetBaseUrl,
    });

    const root = entityMap.get(rootId)!;
    if (options?.parent !== undefined) {
        world.setParent(root, options.parent);
    }

    return { root, entities: entityMap };
}
