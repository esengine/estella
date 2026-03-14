import type { World } from './world';
import type { Entity } from './types';
import type { Assets } from './asset/Assets';
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
    const prefabCache = new Map<string, PrefabData>();

    if (options?.assets) {
        const assets = options.assets;
        await preloadNestedPrefabs(
            prefab,
            async (path) => {
                const result = await assets.loadPrefab(path);
                return result.data as PrefabData;
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
        assets: options?.assets,
        assetBaseUrl: options?.assetBaseUrl,
    });

    const root = entityMap.get(rootId)!;
    if (options?.parent !== undefined) {
        world.setParent(root, options.parent);
    }

    return { root, entities: entityMap };
}
