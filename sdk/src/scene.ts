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
    Canvas,
    type LocalTransformData,
    type SpriteData,
    type CameraData,
    type CanvasData,
} from './component';
import { Text, type TextData } from './ui/text';
import type { AssetServer } from './asset/AssetServer';

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

export interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface TextureMetadata {
    version: string;
    type: 'texture';
    sliceBorder: SliceBorder;
}

export interface SceneData {
    version: string;
    name: string;
    entities: SceneEntityData[];
    textureMetadata?: Record<string, TextureMetadata>;
}

export interface SceneLoadOptions {
    assetServer?: AssetServer;
    assetBaseUrl?: string;
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

export async function loadSceneWithAssets(
    world: World,
    sceneData: SceneData,
    options?: SceneLoadOptions
): Promise<Map<number, Entity>> {
    const entityMap = new Map<number, Entity>();
    const assetServer = options?.assetServer;
    const texturePathToUrl = new Map<string, string>();

    for (const entityData of sceneData.entities) {
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);

        for (const compData of entityData.components) {
            if (compData.type === 'Sprite' && assetServer) {
                const data = compData.data as Record<string, unknown>;
                if (typeof data.texture === 'string' && data.texture) {
                    const texturePath = data.texture;
                    const url = options?.assetBaseUrl
                        ? `${options.assetBaseUrl}/${texturePath}`
                        : `/${texturePath}`;
                    try {
                        const info = await assetServer.loadTexture(url);
                        data.texture = info.handle;
                        texturePathToUrl.set(texturePath, url);
                    } catch (err) {
                        console.warn(`Failed to load texture: ${url}`, err);
                        data.texture = 0;
                    }
                }
            }

            loadComponent(world, entity, compData);
        }
    }

    for (const entityData of sceneData.entities) {
        if (entityData.parent !== null) {
            const entity = entityMap.get(entityData.id);
            const parentEntity = entityMap.get(entityData.parent);
            if (entity !== undefined && parentEntity !== undefined) {
                world.setParent(entity, parentEntity);
            }
        }
    }

    if (assetServer && sceneData.textureMetadata) {
        for (const [texturePath, metadata] of Object.entries(sceneData.textureMetadata)) {
            const url = texturePathToUrl.get(texturePath);
            if (url && metadata.sliceBorder) {
                assetServer.setTextureMetadataByPath(url, metadata.sliceBorder);
            }
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
        case 'Canvas':
            world.insert(entity, Canvas, data as CanvasData);
            break;
        case 'Text':
            world.insert(entity, Text, data as TextData);
            break;
        default:
            console.warn(`Unknown component type: ${compData.type}`);
    }
}
