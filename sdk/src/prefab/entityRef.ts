// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ComponentData, PrefabEntityId } from './types';
import { getComponent } from '../ecs/component';
import { INVALID_ENTITY } from '../types';

/**
 * Apply @p one to an entity-ref field, which holds one ref or a LIST of them —
 * `MeshSkin.joints` is a list, and a bare `typeof` test leaves those untouched.
 * All three translation directions come through here, so none can disagree.
 */
export function mapEntityRefField(value: unknown, one: (ref: unknown) => unknown): unknown {
    return Array.isArray(value) ? value.map(one) : one(value);
}

/**
 * Remap entity-typed component fields from prefab-local ids to runtime ids.
 *
 * The mapping is keyed by `PrefabEntityId` (string) → runtime entity (number),
 * matching what flatten built. A component field whose value is a string —
 * the authored prefab-local reference — gets resolved through the mapping;
 * a numeric value is treated as already a runtime id (or zero/INVALID) and
 * left alone, so partially-instantiated/mutated components round-trip.
 */
export function remapComponentEntityRefs(
    components: ComponentData[],
    idMapping: Map<PrefabEntityId, number>,
): void {
    const one = (value: unknown): unknown => {
        if (typeof value === 'string') {
            const mapped = idMapping.get(value);
            // A DANGLING prefab-local ref (target deleted, or a stale Apply).
            // Cleared rather than leaked as a string into a field the World reads
            // as a number — an ABI fault on spawn. So does captureEntityRefs.
            return mapped !== undefined ? mapped : INVALID_ENTITY;
        }
        if (typeof value === 'number' && value !== INVALID_ENTITY) {
            // Already a numeric id; if a caller authored components with
            // numeric refs, fall back to numeric→numeric mapping for
            // legacy compatibility (no-op when the id isn't in the map).
            const mapped = (idMapping as Map<unknown, number>).get(value);
            if (mapped !== undefined) return mapped;
        }
        return value;
    };
    for (const comp of components) {
        const def = getComponent(comp.type);
        if (!def || def.entityFields.length === 0) continue;
        for (const field of def.entityFields) {
            comp.data[field] = mapEntityRefField(comp.data[field], one);
        }
    }
}
