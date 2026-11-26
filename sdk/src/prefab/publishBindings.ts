// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { INVALID_ENTITY } from '../types';
import { baselineRefIds, type DiffBaselineEntity } from './diff';
import { mapComponentRefs, mapOverrideRefs } from './entityRef';
import type { SourceDelta } from './sceneInstance';
import type { PrefabOverride } from './types';
import { PREFAB_ADDRESS_SEP } from './types';

type AssetEdits = Pick<SourceDelta, 'overrides' | 'added'>;

/** A collapsed scene delta uses strings for prefab links and numbers for live scene targets. */
export function isSceneTarget(value: unknown): value is number {
    return typeof value === 'number' && value > 0 && value !== 0xffffffff;
}

/** Keep each external binding on the scene instance. A shared list keeps its local entries and order. */
export function sharedPrefabEdits(delta: AssetEdits, readBaseline: () => readonly DiffBaselineEntity[]): AssetEdits {
    // An asset's entity table can attach children only to its own authored ids.
    // A scene attachment below a mounted member, and its subtree, stay on the instance.
    const local = new Set<string>();
    if (delta.added.some(a => a.parentId?.includes(PREFAB_ADDRESS_SEP))) {
        const children = new Map<string, string[]>();
        for (const a of delta.added) {
            if (!a.parentId) continue;
            if (a.parentId.includes(PREFAB_ADDRESS_SEP)) local.add(a.prefabEntityId);
            const group = children.get(a.parentId);
            if (group) group.push(a.prefabEntityId);
            else children.set(a.parentId, [a.prefabEntityId]);
        }
        for (const parent of local) for (const child of children.get(parent) ?? []) local.add(child);
    }
    const privateTarget = (v: unknown) => isSceneTarget(v) || (typeof v === 'string' && local.has(v));
    let entities: Map<string, DiffBaselineEntity> | undefined;
    let ids: Map<number, string>;
    const sourceField = (entity: string, type: string, field: string): unknown => {
        if (!entities) {
            const baseline = readBaseline();
            entities = new Map(baseline.map(e => [e.prefabEntityId, e]));
            ids = baselineRefIds(baseline);
        }
        return entities.get(entity)?.components.find(c => c.type === type)?.data[field];
    };
    const stableRef = (ref: unknown) => typeof ref === 'string' ? ref : typeof ref === 'number' ? ids.get(ref) ?? INVALID_ENTITY : INVALID_ENTITY;

    const overrides: PrefabOverride[] = [];
    for (const patch of delta.overrides) {
        if (patch.type === 'parent' && typeof patch.value === 'string' && local.has(patch.value)) continue;
        let privateBinding = false;
        const next = mapOverrideRefs(patch, (v, field, index) => {
            if (!privateTarget(v)) return typeof v === 'number' ? INVALID_ENTITY : v;
            privateBinding = true;
            if (patch.type === 'property' && index === undefined) return INVALID_ENTITY;
            const value = sourceField(patch.prefabEntityId, patch.componentData?.type ?? patch.componentType!, field);
            return stableRef(index === undefined ? value : Array.isArray(value) ? value[index] : undefined);
        });
        if (privateBinding && patch.type === 'property') {
            if (!Array.isArray(patch.value) || patch.value.every(privateTarget)) continue;
            const base = sourceField(patch.prefabEntityId, patch.componentType!, patch.propertyName!);
            if (Array.isArray(base) && Array.isArray(next.value) && base.length === next.value.length
                && next.value.every((v, i) => v === stableRef(base[i]))) continue;
        }
        overrides.push(next);
    }
    const added = delta.added.filter(entity => !local.has(entity.prefabEntityId)).map(entity => ({
        ...entity,
        components: entity.components.map(source => {
            const comp = { ...source, data: { ...source.data } };
            mapComponentRefs(comp, v => typeof v === 'number' || privateTarget(v) ? INVALID_ENTITY : v);
            return comp;
        }),
    }));
    return { overrides, added };
}
