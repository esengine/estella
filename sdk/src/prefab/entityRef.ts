import type { ComponentData } from './types';
import { getComponentEntityFields } from '../scene';

export function remapComponentEntityRefs(
    components: ComponentData[],
    idMapping: Map<number, number>,
): void {
    for (const comp of components) {
        const fields = getComponentEntityFields(comp.type);
        if (!fields) continue;
        for (const field of fields) {
            const value = comp.data[field];
            if (typeof value === 'number' && value !== 0) {
                const mapped = idMapping.get(value);
                if (mapped !== undefined) {
                    comp.data[field] = mapped;
                }
            }
        }
    }
}
