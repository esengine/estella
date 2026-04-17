/**
 * @file    discoverAssets.ts
 * @brief   Unified asset discovery from scene/prefab data.
 *
 * Each component may reference assets in three ways: a custom
 * `discoverAssets` callback, declared `assetFields`, or paired
 * `spineFields`. This module walks a SceneData and buckets every
 * such ref by asset type.
 *
 * Refs in serialized data may be either a concrete path
 * (`"assets/player.png"`, legacy) or a UUID reference
 * (`"@uuid:xxxxxxxx-..."`, produced by the meta-driven pipeline).
 * An optional `refResolver` callback translates a ref to its
 * current path before bucketing. Without a resolver the ref is
 * passed through unchanged — works for legacy scenes that still
 * store paths directly.
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
    /**
     * Refs seen during discovery that could not be resolved to a path
     * (e.g. unknown UUID). Callers surface this to the user so missing
     * assets don't silently turn into texture handle 0.
     */
    unresolved: string[];
}

/** Turns a raw serialized ref into a concrete path (or null if unknown). */
export type RefResolver = (ref: string) => string | null;

export function discoverSceneAssets(
    sceneData: SceneData,
    refResolver?: RefResolver,
): SceneAssetRefs {
    const byType = new Map<string, Set<string>>();
    const spines: SpineAssetRef[] = [];
    const spineKeys = new Set<string>();
    const unresolved: string[] = [];

    const resolve = (raw: string): string | null => {
        const r = refResolver ? refResolver(raw) : raw;
        if (r == null || r === '') {
            unresolved.push(raw);
            return null;
        }
        return r;
    };

    const addAsset = (type: string, raw: string): void => {
        const path = resolve(raw);
        if (path == null) return;
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
                const skelRaw = data[comp.spineFields.skeletonField] as string;
                const atlasRaw = data[comp.spineFields.atlasField] as string;
                if (skelRaw && atlasRaw) {
                    const skel = resolve(skelRaw);
                    const atlas = resolve(atlasRaw);
                    if (skel != null && atlas != null) {
                        const key = `${skel}:${atlas}`;
                        if (!spineKeys.has(key)) {
                            spineKeys.add(key);
                            spines.push({ skeleton: skel, atlas });
                        }
                    }
                }
            }
        }
    }

    return { byType, spines, unresolved };
}

export function getAssetPathsByType(refs: SceneAssetRefs, type: AssetFieldType): Set<string> {
    return refs.byType.get(type) ?? new Set();
}
