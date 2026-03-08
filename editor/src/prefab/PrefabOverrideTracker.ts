import type { EntityData, SceneData } from '../types/SceneTypes';
import type { PrefabOverride } from '../types/PrefabTypes';

export function isPropertyOverridden(
    scene: SceneData,
    entityId: number,
    componentType: string,
    propertyName: string
): boolean {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return false;

    return entity.prefab.overrides.some(
        o => o.type === 'property' &&
            o.componentType === componentType &&
            o.propertyName === propertyName
    );
}

export function getOverridesForEntity(
    scene: SceneData,
    entityId: number
): PrefabOverride[] {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return [];
    return entity.prefab.overrides;
}

export function hasAnyOverrides(scene: SceneData, instanceId: string): boolean {
    return scene.entities.some(
        e => e.prefab?.instanceId === instanceId && e.prefab.overrides.length > 0
    );
}

export function recordPropertyOverride(
    scene: SceneData,
    entityId: number,
    componentType: string,
    propertyName: string,
    value: unknown
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const existing = entity.prefab.overrides.findIndex(
        o => o.type === 'property' &&
            o.componentType === componentType &&
            o.propertyName === propertyName
    );

    const override: PrefabOverride = {
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'property',
        componentType,
        propertyName,
        value: JSON.parse(JSON.stringify(value)),
    };

    if (existing !== -1) {
        entity.prefab.overrides[existing] = override;
    } else {
        entity.prefab.overrides.push(override);
    }
}

export function recordNameOverride(
    scene: SceneData,
    entityId: number,
    name: string
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const existing = entity.prefab.overrides.findIndex(o => o.type === 'name');

    const override: PrefabOverride = {
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'name',
        value: name,
    };

    if (existing !== -1) {
        entity.prefab.overrides[existing] = override;
    } else {
        entity.prefab.overrides.push(override);
    }
}

export function recordVisibilityOverride(
    scene: SceneData,
    entityId: number,
    visible: boolean
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const existing = entity.prefab.overrides.findIndex(o => o.type === 'visibility');

    const override: PrefabOverride = {
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'visibility',
        value: visible,
    };

    if (existing !== -1) {
        entity.prefab.overrides[existing] = override;
    } else {
        entity.prefab.overrides.push(override);
    }
}

export function recordComponentAddedOverride(
    scene: SceneData,
    entityId: number,
    componentType: string,
    componentData: Record<string, unknown>
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const existing = entity.prefab.overrides.findIndex(
        o => o.type === 'component_added' &&
            o.componentData?.type === componentType
    );

    const override: PrefabOverride = {
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'component_added',
        componentData: { type: componentType, data: JSON.parse(JSON.stringify(componentData)) },
    };

    if (existing !== -1) {
        entity.prefab.overrides[existing] = override;
    } else {
        entity.prefab.overrides.push(override);
    }
}

export function recordComponentRemovedOverride(
    scene: SceneData,
    entityId: number,
    componentType: string
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const exists = entity.prefab.overrides.some(
        o => o.type === 'component_removed' &&
            o.componentType === componentType
    );

    if (exists) return;

    entity.prefab.overrides.push({
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'component_removed',
        componentType,
    });
}

export function removePropertyOverride(
    scene: SceneData,
    entityId: number,
    componentType: string,
    propertyName: string
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    entity.prefab.overrides = entity.prefab.overrides.filter(
        o => !(o.type === 'property' &&
            o.componentType === componentType &&
            o.propertyName === propertyName)
    );
}
