import type { World } from './world';
import type { Entity } from './types';
import type { AssetServer } from './asset/AssetServer';
import { loadSceneWithAssets, type SceneData } from './scene';
import {
    flattenPrefab,
    preloadNestedPrefabs,
    type PrefabData,
    type PrefabOverride,
    type FlattenContext,
} from './prefab/index';

export type { PrefabData, PrefabEntityData, PrefabOverride, NestedPrefabRef } from './prefab/index';

export interface InstantiatePrefabOptions {
    assetServer?: AssetServer;
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
    const prefabCache = new Map<string, PrefabData>();

    if (options?.assetServer) {
        await preloadNestedPrefabs(
            prefab,
            (path) => options.assetServer!.loadPrefab(path, options.assetBaseUrl),
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
        prefab,
        options?.overrides ?? [],
        ctx,
    );

    const sceneData: SceneData = {
        version: prefab.version,
        name: prefab.name,
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
        assetServer: options?.assetServer,
        assetBaseUrl: options?.assetBaseUrl,
    });

    const root = entityMap.get(rootId)!;
    if (options?.parent !== undefined) {
        world.setParent(root, options.parent);
    }

    return { root, entities: entityMap };
}
