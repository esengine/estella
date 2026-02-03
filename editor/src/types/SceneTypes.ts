/**
 * @file    SceneTypes.ts
 * @brief   Scene data types for the Web Editor
 */

import type { Entity } from 'esengine';

// =============================================================================
// Scene Data Types
// =============================================================================

export interface SceneData {
    version: string;
    name: string;
    entities: EntityData[];
}

export interface EntityData {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
}

export interface ComponentData {
    type: string;
    data: Record<string, unknown>;
}

// =============================================================================
// Editor Types
// =============================================================================

export interface SelectionState {
    entity: Entity | null;
    entities: Entity[];
}

export interface ViewportState {
    width: number;
    height: number;
    zoom: number;
    panX: number;
    panY: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createEmptyScene(name: string = 'Untitled'): SceneData {
    return {
        version: '1.0',
        name,
        entities: [],
    };
}

export function createEntityData(
    id: number,
    name: string = `Entity_${id}`,
    parent: number | null = null
): EntityData {
    return {
        id,
        name,
        parent,
        children: [],
        components: [],
    };
}
