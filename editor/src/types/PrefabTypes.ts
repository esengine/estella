/**
 * @file    PrefabTypes.ts
 * @brief   Prefab system type definitions
 */

import type { ComponentData } from './SceneTypes';

// =============================================================================
// Prefab File Data (.esprefab)
// =============================================================================

export interface PrefabData {
    version: string;
    name: string;
    rootEntityId: number;
    entities: PrefabEntityData[];
}

export interface PrefabEntityData {
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
    nestedPrefab?: NestedPrefabRef;
}

export interface NestedPrefabRef {
    prefabPath: string;
    overrides: PrefabOverride[];
}

// =============================================================================
// Prefab Instance Data (stored in scene EntityData.prefab)
// =============================================================================

export interface PrefabInstanceData {
    prefabPath: string;
    prefabEntityId: number;
    isRoot: boolean;
    instanceId: string;
    overrides: PrefabOverride[];
}

export interface PrefabOverride {
    prefabEntityId: number;
    type: 'property' | 'component_added' | 'component_removed' | 'name' | 'visibility';
    componentType?: string;
    propertyName?: string;
    value?: unknown;
    componentData?: ComponentData;
}
