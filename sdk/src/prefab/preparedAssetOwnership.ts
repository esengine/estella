// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AssetScope, type AssetLease } from '../asset/AssetLease';
import type { SceneAssetResult } from '../asset/Assets';
import { indexSceneAssets, SceneAssetOwners, type RefResolver } from '../asset/discoverAssets';
import type { EntityAssetScopes } from '../asset/entityAssetScopes';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { SceneData } from '../scene/scene';

/** Resources retained before a spawn; attachment transfers them to entity scopes. */
export interface PreparedSpawnOwnership {
    attach(world: World, entities: ReadonlyMap<number, Entity>): void;
    release(): void;
}

/** Project successful acquisitions onto immutable authored entities once, at bake time. */
export function prepareSpawnOwnership(
    scene: SceneData, result: SceneAssetResult, owners: EntityAssetScopes | undefined,
    resolveRef?: RefResolver,
): (() => PreparedSpawnOwnership) | undefined {
    if (!owners || !result.acquisitions?.length) return undefined;
    // A structural preload provider may return receipts without entity information.
    let fallback: SceneAssetOwners | undefined;
    if (result.acquisitions.some(receipt => !receipt.entityIds)) {
        fallback = new SceneAssetOwners(true);
        indexSceneAssets(scene, resolveRef, fallback);
    }
    const sources = new Map<number, Set<AssetLease>>();
    for (const { type, path, lease, entityIds } of result.acquisitions) {
        const entities = entityIds ?? fallback?.get(type, path);
        if (!entities) continue;
        for (const id of entities) {
            let selected = sources.get(id);
            if (!selected) sources.set(id, selected = new Set());
            selected.add(lease);
        }
    }
    if (!sources.size) return undefined;
    return () => {
        const retained = new Map<number, AssetScope>();
        const release = (): void => {
            for (const scope of retained.values()) scope.releaseAll();
            retained.clear();
        };
        try {
            for (const [id, leases] of sources) {
                const scope = new AssetScope(); retained.set(id, scope);
                for (const source of leases) {
                    const lease = source.retain();
                    if (!lease) throw new Error(`Cannot spawn retired prefab: resource "${source.key}" was released`);
                    scope.add(lease);
                }
            }
        } catch (error) { release(); throw error; }
        return {
            attach(world, entities) {
                for (const [id, scope] of retained) {
                    const entity = entities.get(id);
                    if (entity !== undefined && world.valid(entity)) owners.ensure(world, entity).absorb(scope);
                }
                // Unspawned entities release their receipts; absorbed scopes are empty.
                release();
            },
            release,
        };
    };
}
