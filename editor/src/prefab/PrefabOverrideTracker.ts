/**
 * @file    PrefabOverrideTracker.ts
 * @brief   Override recording and querying for prefab instances
 */

import type { EntityData, SceneData } from '../types/SceneTypes';
import type { PrefabOverride } from '../types/PrefabTypes';

// =============================================================================
// Query
// =============================================================================

export function isPropertyOverridden(
    scene: SceneData,
    entityId: number,
    componentType: string,
    propertyName: string
): boolean {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return false;

    const root = findInstanceRoot(scene, entity.prefab.instanceId);
    if (!root?.prefab) return false;

    return root.prefab.overrides.some(
        o => o.prefabEntityId === entity.prefab!.prefabEntityId &&
            o.type === 'property' &&
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

    const root = findInstanceRoot(scene, entity.prefab.instanceId);
    if (!root?.prefab) return [];

    return root.prefab.overrides.filter(
        o => o.prefabEntityId === entity.prefab!.prefabEntityId
    );
}

export function hasAnyOverrides(scene: SceneData, instanceId: string): boolean {
    const root = findInstanceRoot(scene, instanceId);
    return (root?.prefab?.overrides.length ?? 0) > 0;
}

// =============================================================================
// Recording
// =============================================================================

export function recordPropertyOverride(
    scene: SceneData,
    entityId: number,
    componentType: string,
    propertyName: string,
    value: unknown
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const root = findInstanceRoot(scene, entity.prefab.instanceId);
    if (!root?.prefab) return;

    const existing = root.prefab.overrides.findIndex(
        o => o.prefabEntityId === entity.prefab!.prefabEntityId &&
            o.type === 'property' &&
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
        root.prefab.overrides[existing] = override;
    } else {
        root.prefab.overrides.push(override);
    }
}

export function recordNameOverride(
    scene: SceneData,
    entityId: number,
    name: string
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const root = findInstanceRoot(scene, entity.prefab.instanceId);
    if (!root?.prefab) return;

    const existing = root.prefab.overrides.findIndex(
        o => o.prefabEntityId === entity.prefab!.prefabEntityId && o.type === 'name'
    );

    const override: PrefabOverride = {
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'name',
        value: name,
    };

    if (existing !== -1) {
        root.prefab.overrides[existing] = override;
    } else {
        root.prefab.overrides.push(override);
    }
}

export function recordVisibilityOverride(
    scene: SceneData,
    entityId: number,
    visible: boolean
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const root = findInstanceRoot(scene, entity.prefab.instanceId);
    if (!root?.prefab) return;

    const existing = root.prefab.overrides.findIndex(
        o => o.prefabEntityId === entity.prefab!.prefabEntityId && o.type === 'visibility'
    );

    const override: PrefabOverride = {
        prefabEntityId: entity.prefab.prefabEntityId,
        type: 'visibility',
        value: visible,
    };

    if (existing !== -1) {
        root.prefab.overrides[existing] = override;
    } else {
        root.prefab.overrides.push(override);
    }
}

export function removePropertyOverride(
    scene: SceneData,
    entityId: number,
    componentType: string,
    propertyName: string
): void {
    const entity = scene.entities.find(e => e.id === entityId);
    if (!entity?.prefab) return;

    const root = findInstanceRoot(scene, entity.prefab.instanceId);
    if (!root?.prefab) return;

    root.prefab.overrides = root.prefab.overrides.filter(
        o => !(o.prefabEntityId === entity.prefab!.prefabEntityId &&
            o.type === 'property' &&
            o.componentType === componentType &&
            o.propertyName === propertyName)
    );
}

// =============================================================================
// Helpers
// =============================================================================

function findInstanceRoot(scene: SceneData, instanceId: string): EntityData | undefined {
    return scene.entities.find(
        e => e.prefab?.instanceId === instanceId && e.prefab?.isRoot
    );
}
