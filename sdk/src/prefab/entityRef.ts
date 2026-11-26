// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ComponentData, PrefabEntityId, PrefabOverride } from './types';
import { getComponent } from '../ecs/component';
import { mapEntityRefField } from '../ecs/entityRefField';
import { INVALID_ENTITY } from '../types';
import { hasOwn } from '../util/ownProperties';

type RefMapper = (value: unknown, field: string, index?: number) => unknown;

/** Translate only declared fields present on this component. The caller owns its data. */
export function mapComponentRefs(component: ComponentData, map: RefMapper): void {
    for (const field of getComponent(component.type)?.entityFields ?? []) {
        if (hasOwn(component.data, field)) component.data[field] = mapEntityRefField(component.data[field], (v, i) => map(v, field, i));
    }
}

/** Translate the references written by one edit, leaving the input and inherited fields alone. */
export function mapOverrideRefs(patch: PrefabOverride, map: RefMapper): PrefabOverride {
    if (patch.type === 'property' && patch.componentType && patch.propertyName !== undefined
        && getComponent(patch.componentType)?.entityFields.includes(patch.propertyName)) {
        const field = patch.propertyName;
        return { ...patch, value: mapEntityRefField(patch.value, (v, i) => map(v, field, i)) };
    }
    if ((patch.type === 'component_added' || patch.type === 'component_replaced') && patch.componentData) {
        const componentData = { ...patch.componentData, data: { ...patch.componentData.data } };
        mapComponentRefs(componentData, map);
        return { ...patch, componentData };
    }
    return patch;
}

/** Asset files may use numeric local ids. Scene deltas use strings for local links and numbers for scene links. */
export function prefabRef(value: unknown, ids: ReadonlyMap<PrefabEntityId, number>): unknown {
    if (typeof value === 'string') return ids.get(value);
    if (typeof value === 'number' && value !== INVALID_ENTITY) {
        return ids.get(String(value)) ?? (ids as ReadonlyMap<unknown, number>).get(value) ?? value;
    }
    return value;
}

export function instanceRef(value: unknown, ids: ReadonlyMap<PrefabEntityId, number>): unknown {
    return typeof value === 'string' ? ids.get(value) ?? INVALID_ENTITY : value;
}

/**
 * Remap entity-typed component fields from prefab-local ids to runtime ids.
 *
 * The mapping is keyed by `PrefabEntityId` (string) → runtime entity (number),
 * matching what flatten built. A component field whose value is a string —
 * the authored prefab-local reference — gets resolved through the mapping;
 * so does a number naming a prefab entity (the numeric-id format). Any other
 * number is treated as already a runtime id (or zero/INVALID) and left
 * alone, so partially-instantiated/mutated components round-trip.
 */
export function remapComponentEntityRefs(
    components: ComponentData[],
    idMapping: Map<PrefabEntityId, number>,
): void {
    const resolve = (value: unknown) => typeof value === 'string' ? instanceRef(value, idMapping) : prefabRef(value, idMapping);
    for (const comp of components) mapComponentRefs(comp, resolve);
}
