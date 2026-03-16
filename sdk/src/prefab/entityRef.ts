import type { ComponentData } from './types';
import { getComponent } from '../component';
import { INVALID_ENTITY } from '../types';

export function remapComponentEntityRefs(
    components: ComponentData[],
    idMapping: Map<number, number>,
): void {
    for (const comp of components) {
        const def = getComponent(comp.type);
        if (!def || def.entityFields.length === 0) continue;
        for (const field of def.entityFields) {
            const value = comp.data[field];
            if (typeof value === 'number' && value !== INVALID_ENTITY) {
                const mapped = idMapping.get(value);
                if (mapped !== undefined) {
                    comp.data[field] = mapped;
                }
            }
        }
    }
}
