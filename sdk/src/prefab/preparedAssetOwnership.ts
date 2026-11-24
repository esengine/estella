// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AssetScope, type AssetLease, type FieldLeaseBinding } from '../asset/AssetLease';
import type { SceneAssetResult } from '../asset/Assets';
import { indexSceneAssets, SceneAssetOwners, type RefResolver } from '../asset/discoverAssets';
import type { EntityAssetScopes } from '../asset/entityAssetScopes';
import { bindingSlotOf } from '../asset/leaseBindings';
import type { World } from '../ecs/world';
import { getComponent, type AnyComponentDef } from '../ecs/component';
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
    // Older preload providers can omit ownership or the distinction between fields and other dependencies.
    let fallback: SceneAssetOwners | undefined;
    if (result.acquisitions.some(receipt => !receipt.entityIds || receipt.auxiliaryEntityIds === undefined)) {
        fallback = new SceneAssetOwners(true);
        indexSceneAssets(scene, result.resolveRef ?? resolveRef, fallback);
    }
    const sources = new Map<number, Map<object, { lease: AssetLease; auxiliary: boolean }>>();
    for (const { type, path, lease, entityIds, auxiliaryEntityIds } of result.acquisitions) {
        const inferred = fallback?.get(type, path);
        const entities = entityIds ?? inferred;
        if (!entities) continue;
        const auxiliary = auxiliaryEntityIds === undefined ? fallback?.auxiliaryFor(type, path) : auxiliaryEntityIds;
        const key = bindingSlotOf(lease) ?? lease;
        for (const id of entities) {
            const independent = !!auxiliary?.has(id) || (auxiliaryEntityIds === undefined && !inferred?.has(id));
            let selected = sources.get(id);
            if (!selected) sources.set(id, selected = new Map());
            const source = selected.get(key);
            if (!source) selected.set(key, { lease, auxiliary: independent });
            else if (independent) source.auxiliary = true;
        }
    }
    if (!sources.size) return undefined;
    const components = new Map<number, AnyComponentDef[]>();
    for (const source of scene.entities) {
        if (!sources.has(source.id)) continue;
        const bound = source.components.map(row => getComponent(row.type)).filter((def): def is AnyComponentDef => !!def?.assetFields.length);
        components.set(source.id, bound);
    }
    return () => {
        const retained = new Map<number, AssetScope>();
        const auxiliary = new Set<AssetLease>();
        const release = (): void => {
            const scopes = [...retained.values()];
            retained.clear();
            auxiliary.clear();
            AssetScope.closeAll(scopes);
        };
        try {
            for (const [id, leases] of sources) {
                const scope = new AssetScope(); retained.set(id, scope);
                for (const { lease: source, auxiliary: independent } of leases.values()) {
                    const lease = source.retain();
                    if (!lease) throw new Error(`Cannot spawn retired prefab: resource "${source.key}" was released`);
                    scope.add(lease);
                    if (independent) auxiliary.add(lease);
                }
            }
        } catch (error) { release(); throw error; }
        return {
            attach(world, entities) {
                for (const [id, scope] of retained) {
                    const entity = entities.get(id);
                    if (entity === undefined || !world.valid(entity)) continue;
                    const fields = new Map<AssetLease, FieldLeaseBinding>();
                    for (const component of components.get(id) ?? []) {
                        const data = world.tryGet(entity, component);
                        if (!data) continue;
                        for (const { type, field } of component.assetFields) {
                            const value = data[field];
                            if (!value || (typeof value !== 'number' && typeof value !== 'string')) continue;
                            const held = owners.leaseForBinding(scope, type, value);
                            if (held && !auxiliary.has(held)) fields.set(held, { type, value });
                        }
                    }
                    let kept = fields.size;
                    if (kept !== scope.size) {
                        for (const lease of scope.leases()) {
                            if (fields.has(lease)) continue;
                            // A slot uniquely identifies a named field. Other acquisitions can share a native handle or be opaque.
                            if (!bindingSlotOf(lease)) auxiliary.add(lease);
                            if (auxiliary.has(lease)) kept++;
                        }
                    }
                    if (kept) owners.ensure(world, entity).absorbFieldLeases(scope, fields, kept === scope.size ? undefined : auxiliary);
                }
                // Give back unspawned rows and bindings superseded before ownership attached.
                release();
            },
            release,
        };
    };
}
