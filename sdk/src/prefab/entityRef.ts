import type { ComponentData, PrefabEntityId } from './types';
import { getComponent } from '../component';
import { INVALID_ENTITY } from '../types';

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
    for (const comp of components) {
        const def = getComponent(comp.type);
        if (!def || def.entityFields.length === 0) continue;
        for (const field of def.entityFields) {
            const value = comp.data[field];
            if (typeof value === 'string') {
                const mapped = idMapping.get(value);
                if (mapped !== undefined) {
                    comp.data[field] = mapped;
                }
            } else if (typeof value === 'number' && value !== INVALID_ENTITY) {
                // Already a numeric id; if a caller authored components with
                // numeric refs, fall back to numeric→numeric mapping for
                // legacy compatibility (no-op when the id isn't in the map).
                const mapped = (idMapping as Map<unknown, number>).get(value);
                if (mapped !== undefined) {
                    comp.data[field] = mapped;
                }
            }
        }
    }
}
