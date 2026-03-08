import type { ProcessedEntity, PrefabOverride } from './types';
import { cloneComponentData } from './clone';

export function applyOverrides(entity: ProcessedEntity, overrides: PrefabOverride[]): void {
    for (const override of overrides) {
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
            case 'component_removed':
                if (override.componentType) {
                    entity.components = entity.components.filter(
                        c => c.type !== override.componentType,
                    );
                }
                break;
        }
    }
}
