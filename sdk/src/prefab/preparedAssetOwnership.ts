// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AssetScope, type AssetLease, type FieldLeaseBinding } from '../asset/AssetLease';
import type { SceneAssetResult } from '../asset/Assets';
import { indexSceneAssets, SceneAssetOwners, type RefResolver } from '../asset/discoverAssets';
import { recordSceneDependencies, type EntityAssetScopes } from '../asset/entityAssetScopes';
import { namedBindingOf } from '../asset/leaseBindings';
import type { World } from '../ecs/world';
import { getComponent, type AnyComponentDef } from '../ecs/component';
import type { Entity } from '../types';
import type { SceneData } from '../scene/scene';

/** Resources retained before a spawn; attachment transfers them to entity scopes. */
export interface PreparedSpawnOwnership {
    attach(world: World, entities: ReadonlyMap<number, Entity>): void;
    release(): void;
}

type EntitySources = Map<number, Map<object, { lease: AssetLease; auxiliary: boolean }>>;

/** Index authored owners before scene fields are rewritten to runtime handles. */
function sceneAcquisitionSources(
    scene: SceneData, result: SceneAssetResult, resolveRef?: RefResolver, auxiliaryOnly = false,
): EntitySources {
    const sources: EntitySources = new Map();
    if (!result.acquisitions?.length) return sources;
    // Older preload providers can omit ownership or the distinction between fields and other dependencies.
    let fallback: SceneAssetOwners | undefined;
    if (result.acquisitions.some(receipt => receipt.auxiliaryEntityIds === undefined || (!auxiliaryOnly && !receipt.entityIds))) {
        fallback = new SceneAssetOwners({ entityOwnership: true, includeAliases: true });
        indexSceneAssets(scene, result.resolveRef ?? resolveRef, { owners: fallback });
    }
    for (const { type, path, lease, entityIds, auxiliaryEntityIds } of result.acquisitions) {
        if (auxiliaryOnly && auxiliaryEntityIds !== undefined && !auxiliaryEntityIds?.size) continue;
        const inferred = fallback?.get(type, path);
        const auxiliary = auxiliaryEntityIds === undefined ? fallback?.auxiliaryFor(type, path) : auxiliaryEntityIds;
        const entities = auxiliaryOnly && auxiliaryEntityIds !== undefined ? auxiliaryEntityIds : entityIds ?? inferred;
        if (!entities) continue;
        const key = namedBindingOf(lease) ?? lease;
        for (const id of entities) {
            const independent = !!auxiliary?.has(id) || (auxiliaryEntityIds === undefined && !inferred?.has(id));
            if (auxiliaryOnly && !independent) continue;
            let selected = sources.get(id);
            if (!selected) sources.set(id, selected = new Map());
            const source = selected.get(key);
            if (!source) selected.set(key, { lease, auxiliary: independent });
            else if (independent) source.auxiliary = true;
        }
    }
    return sources;
}

/** Borrow the scene's own receipts until a declared entity moves to another owner. */
export function prepareSceneAuxiliaryAssets(scene: SceneData, result: SceneAssetResult, resolveRef?: RefResolver) {
    const sources = sceneAcquisitionSources(scene, result, resolveRef, true);
    if (!sources.size) return undefined;
    return (world: World, entities: ReadonlyMap<number, Entity>, target = new Map<Entity, readonly AssetLease[]>(), scope?: AssetScope) => {
        for (const [id, leases] of sources) {
            const entity = entities.get(id);
            if (entity !== undefined && world.valid(entity)) {
                recordSceneDependencies(target, entity, Array.from(leases.values(), source => source.lease), scope);
            }
        }
        return target;
    };
}

/** Project successful acquisitions onto immutable authored entities once, at bake time. */
export function prepareSpawnOwnership(
    scene: SceneData, result: SceneAssetResult, owners: EntityAssetScopes | undefined,
    resolveRef?: RefResolver,
): (() => PreparedSpawnOwnership) | undefined {
    if (!owners) return undefined;
    const sources = sceneAcquisitionSources(scene, result, resolveRef);
    const inputs = owners.textureInputsOf(result.scope);
    if (!sources.size && !inputs) return undefined;
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
                if (inputs) owners.inheritEntityInputs(world, entities.values(), inputs);
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
                            // Named fields resolve to one source. Other acquisitions can share a native handle or be opaque.
                            if (!namedBindingOf(lease)) auxiliary.add(lease);
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
