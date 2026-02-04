/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from './world';
import { Entity } from './types';
import {
    LocalTransform,
    Sprite,
    Camera,
    type LocalTransformData,
    type SpriteData,
    type CameraData,
} from './component';

// =============================================================================
// Types
// =============================================================================

export interface SceneEntityData {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: SceneComponentData[];
}

export interface SceneComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface SceneData {
    version: string;
    name: string;
    entities: SceneEntityData[];
}

// =============================================================================
// Scene Loader
// =============================================================================

export function loadSceneData(world: World, sceneData: SceneData): Map<number, Entity> {
    const entityMap = new Map<number, Entity>();

    for (const entityData of sceneData.entities) {
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);

        for (const compData of entityData.components) {
            loadComponent(world, entity, compData);
        }
    }

    return entityMap;
}

function loadComponent(world: World, entity: Entity, compData: SceneComponentData): void {
    const data = compData.data as unknown;
    switch (compData.type) {
        case 'LocalTransform':
            world.insert(entity, LocalTransform, data as LocalTransformData);
            break;
        case 'Sprite':
            world.insert(entity, Sprite, data as SpriteData);
            break;
        case 'Camera':
            world.insert(entity, Camera, data as CameraData);
            break;
        default:
            console.warn(`Unknown component type: ${compData.type}`);
    }
}
