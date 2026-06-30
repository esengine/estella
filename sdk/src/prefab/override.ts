// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type {
    ComponentData,
    PrefabData,
    PrefabEntityId,
    PrefabOverride,
} from './types';
import { cloneComponentData } from './clone';

/**
 * The fields {@link applyOverrides} reads/writes. Both `ProcessedEntity` (a
 * flattened instance entity) and `PrefabEntityData` (a source-file entity)
 * satisfy it structurally, so the same override logic bakes overrides into a
 * live instance *or* into the prefab source.
 */
export interface OverrideTarget {
    prefabEntityId: PrefabEntityId;
    name: string;
    visible: boolean;
    components: ComponentData[];
    metadata?: Record<string, unknown>;
}

/**
 * Group overrides by their target entity once so flatten can apply each
 * entity's overrides in O(K) instead of O(N×M) per scene tree.
 */
export function bucketOverridesByEntity(
    overrides: readonly PrefabOverride[],
): Map<PrefabEntityId, PrefabOverride[]> {
    const buckets = new Map<PrefabEntityId, PrefabOverride[]>();
    for (const o of overrides) {
        const list = buckets.get(o.prefabEntityId);
        if (list) list.push(o);
        else buckets.set(o.prefabEntityId, [o]);
    }
    return buckets;
}

export function applyOverrides(
    entity: OverrideTarget,
    overrides: readonly PrefabOverride[] | undefined,
): void {
    if (!overrides || overrides.length === 0) return;
    for (const override of overrides) {
        // Bucket pre-filters by entity, but allow callers to pass the raw
        // list too — we still gate here so this function stays standalone.
        if (override.prefabEntityId !== entity.prefabEntityId) continue;

        switch (override.type) {
            case 'property':
                if (override.componentType && override.propertyName !== undefined) {
                    const comp = entity.components.find(c => c.type === override.componentType);
                    if (comp) {
                        comp.data[override.propertyName] = override.value;
                    }
                }
                break;
            case 'name':
                if (typeof override.value === 'string') {
                    entity.name = override.value;
                }
                break;
            case 'visibility':
                if (typeof override.value === 'boolean') {
                    entity.visible = override.value;
                }
                break;
            case 'component_added':
                if (override.componentData) {
                    const exists = entity.components.some(
                        c => c.type === override.componentData!.type,
                    );
                    if (!exists) {
                        entity.components.push({
                            type: override.componentData.type,
                            data: cloneComponentData(override.componentData.data),
                        });
                    }
                }
                break;
            case 'component_replaced':
                if (override.componentData) {
                    const type = override.componentData.type;
                    const existing = entity.components.find(c => c.type === type);
                    if (existing) {
                        existing.data = cloneComponentData(override.componentData.data);
                    } else {
                        entity.components.push({
                            type,
                            data: cloneComponentData(override.componentData.data),
                        });
                    }
                }
                break;
            case 'component_removed':
                if (override.componentType) {
                    entity.components = entity.components.filter(
                        c => c.type !== override.componentType,
                    );
                }
                break;
            case 'metadata_set':
                if (typeof override.metadataKey === 'string') {
                    if (!entity.metadata) entity.metadata = {};
                    entity.metadata[override.metadataKey] = override.value;
                }
                break;
            case 'metadata_removed':
                if (typeof override.metadataKey === 'string' && entity.metadata) {
                    Reflect.deleteProperty(entity.metadata, override.metadataKey);
                    if (Object.keys(entity.metadata).length === 0) {
                        delete entity.metadata;
                    }
                }
                break;
        }
    }
}

/**
 * Bake a set of overrides into a prefab's source, returning a NEW PrefabData with
 * the changes applied as the base (entity identities preserved). This is the core
 * of editor "Apply to Prefab": an instance's overrides (from {@link diffAgainstSource})
 * become the prefab's new base, so every instance re-derives from them.
 *
 * Scope matches {@link diffAgainstSource}: property / name / visibility /
 * component add·replace·remove / metadata overrides on existing prefab entities.
 * Structural changes (entities the instance added or removed) are not folded in —
 * the caller surfaces those separately. Pure: the input `source` is not mutated.
 */
export function applyOverridesToSource(
    source: PrefabData,
    overrides: readonly PrefabOverride[],
): PrefabData {
    const next = JSON.parse(JSON.stringify(source)) as PrefabData;
    if (overrides.length === 0) return next;
    const buckets = bucketOverridesByEntity(overrides);
    for (const entity of next.entities) {
        const bucket = buckets.get(entity.prefabEntityId);
        if (bucket) applyOverrides(entity, bucket);
    }
    return next;
}
