// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ComponentData, PrefabEntityId } from './types';
import { getComponent } from '../ecs/component';
import { mapEntityRefField } from '../ecs/entityRefField';
import { INVALID_ENTITY } from '../types';

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
    const one = (value: unknown): unknown => {
        if (typeof value === 'string') {
            const mapped = idMapping.get(value);
            // A DANGLING prefab-local ref (target deleted, or a stale Apply).
            // Cleared rather than leaked as a string into a field the World reads
            // as a number — an ABI fault on spawn. So does captureEntityRefs.
            return mapped !== undefined ? mapped : INVALID_ENTITY;
        }
        if (typeof value === 'number' && value !== INVALID_ENTITY) {
            // A number is a reference written in the numeric-id format, which names the entity whose prefab-local id is
            // that number: the migration turns those ids into their strings and leaves the components' references as
            // numbers. Found by the string first. It used to reach the right entity only because ids were handed out
            // from 0 in file order, so the number was its own allocated id; from 1 (0 is no entity) it would name the
            // next one. A number that names no prefab entity is a runtime id a caller passed, and is left alone.
            const mapped = idMapping.get(String(value)) ?? (idMapping as Map<unknown, number>).get(value);
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
