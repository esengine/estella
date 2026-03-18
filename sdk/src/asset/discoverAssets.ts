/**
 * @file    discoverAssets.ts
 * @brief   Unified asset discovery from scene/prefab data
 */

import { getComponent } from '../component';
import type { SceneData, AssetFieldType } from '../scene';

export interface SpineAssetRef {
    skeleton: string;
    atlas: string;
}

export interface SceneAssetRefs {
    byType: Map<string, Set<string>>;
    spines: SpineAssetRef[];
}

export function discoverSceneAssets(sceneData: SceneData): SceneAssetRefs {
    const byType = new Map<string, Set<string>>();
    const spines: SpineAssetRef[] = [];
    const spineKeys = new Set<string>();

    const addAsset = (type: string, path: string): void => {
        let set = byType.get(type);
        if (!set) {
            set = new Set();
            byType.set(type, set);
        }
        set.add(path);
    };

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            const comp = getComponent(compData.type);
            if (!comp) continue;

            const data = compData.data as Record<string, unknown>;

            if (comp.discoverAssets) {
                for (const ref of comp.discoverAssets(data)) {
                    if (typeof ref.path === 'string' && ref.path) {
                        addAsset(ref.type, ref.path);
                    }
                }
            }

            for (const desc of comp.assetFields) {
                const value = data[desc.field];
                if (typeof value === 'string' && value) {
                    addAsset(desc.type, value);
                }
            }

            if (comp.spineFields) {
                const skelPath = data[comp.spineFields.skeletonField] as string;
                const atlasPath = data[comp.spineFields.atlasField] as string;
                if (skelPath && atlasPath) {
                    const key = `${skelPath}:${atlasPath}`;
                    if (!spineKeys.has(key)) {
                        spineKeys.add(key);
                        spines.push({ skeleton: skelPath, atlas: atlasPath });
                    }
                }
            }
        }
    }

    return { byType, spines };
}

export function getAssetPathsByType(refs: SceneAssetRefs, type: AssetFieldType): Set<string> {
    return refs.byType.get(type) ?? new Set();
}
