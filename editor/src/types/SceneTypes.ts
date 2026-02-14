/**
 * @file    SceneTypes.ts
 * @brief   Scene data types for the Web Editor
 */

import type { Entity } from 'esengine';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT, DEFAULT_PIXELS_PER_UNIT } from 'esengine';
import type { TextureMetadata } from './TextureMetadata';
import type { PrefabInstanceData } from './PrefabTypes';

// =============================================================================
// Scene Data Types
// =============================================================================

export interface SceneData {
    version: string;
    name: string;
    entities: EntityData[];
    textureMetadata?: Record<string, TextureMetadata>;
}

export interface EntityData {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
    prefab?: PrefabInstanceData;
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

export function createEmptyScene(
    name: string = 'Untitled',
    designResolution?: { width: number; height: number },
): SceneData {
    const res = designResolution ?? { width: DEFAULT_DESIGN_WIDTH, height: DEFAULT_DESIGN_HEIGHT };
    const pixelsPerUnit = DEFAULT_PIXELS_PER_UNIT;
    const orthoSize = res.height / 2;

    return {
        version: '2.0',
        name,
        entities: [
            {
                id: 1,
                name: 'Camera',
                parent: null,
                children: [],
                components: [
                    {
                        type: 'LocalTransform',
                        data: {
                            position: { x: 0, y: 0, z: 10 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    },
                    {
                        type: 'Camera',
                        data: {
                            isActive: true,
                            projectionType: 1,
                            orthoSize,
                            fov: 60,
                            nearPlane: 0.1,
                            farPlane: 1000,
                            showFrustum: true,
                            viewportX: 0,
                            viewportY: 0,
                            viewportW: 1,
                            viewportH: 1,
                            clearFlags: 3,
                        },
                    },
                ],
                visible: true,
            },
            {
                id: 2,
                name: 'Canvas',
                parent: null,
                children: [],
                components: [
                    {
                        type: 'LocalTransform',
                        data: {
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    },
                    {
                        type: 'Canvas',
                        data: {
                            designResolution: { x: res.width, y: res.height },
                            pixelsPerUnit,
                            scaleMode: 1,
                            matchWidthOrHeight: 0.5,
                            backgroundColor: { r: 0, g: 0, b: 0, a: 1 },
                        },
                    },
                ],
                visible: true,
            },
        ],
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
        visible: true,
    };
}
