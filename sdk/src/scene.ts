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
    BitmapText,
    SpineAnimation,
    RigidBody,
    BoxCollider,
    CircleCollider,
    CapsuleCollider,
    Name,
    getUserComponent,
    type LocalTransformData,
    type SpriteData,
    type CameraData,
    type CanvasData,
    type BitmapTextData,
    type SpineAnimationData,
    type RigidBodyData,
    type BoxColliderData,
    type CircleColliderData,
    type CapsuleColliderData,
    type NameData,
} from './component';
import { Text, type TextData } from './ui/text';
import { UIRect, type UIRectData } from './ui/UIRect';
import { UIMask, type UIMaskData } from './ui/UIMask';
import { Interactable, type InteractableData } from './ui/Interactable';
import { Button, type ButtonData } from './ui/Button';
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
        world.insert(entity, Name, { value: entityData.name });

        for (const compData of entityData.components) {
            loadComponent(world, entity, compData);
        }
    }

    // Set parent-child relationships
    for (const entityData of sceneData.entities) {
        if (entityData.parent !== null) {
            const entity = entityMap.get(entityData.id);
            const parentEntity = entityMap.get(entityData.parent);
            if (entity !== undefined && parentEntity !== undefined) {
                world.setParent(entity, parentEntity);
            }
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
        world.insert(entity, Name, { value: entityData.name });

        for (const compData of entityData.components) {
            if (compData.type === 'Sprite' && assetServer) {
                const data = compData.data as Record<string, unknown>;
                if (typeof data.texture === 'string' && data.texture) {
                    const texturePath = data.texture;
                    const isDataUrl = texturePath.startsWith('data:');
                    const url = isDataUrl
                        ? texturePath
                        : options?.assetBaseUrl
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
                if (typeof data.material === 'string' && data.material) {
                    try {
                        const loaded = await assetServer.loadMaterial(
                            data.material,
                            options?.assetBaseUrl
                        );
                        data.material = loaded.handle;
                    } catch (err) {
                        console.warn(`Failed to load material: ${data.material}`, err);
                        data.material = 0;
                    }
                }
            }

            if (compData.type === 'BitmapText' && assetServer) {
                const data = compData.data as Record<string, unknown>;
                if (typeof data.font === 'string' && data.font) {
                    try {
                        const handle = await assetServer.loadBitmapFont(
                            data.font,
                            options?.assetBaseUrl
                        );
                        data.font = handle;
                    } catch (err) {
                        console.warn(`Failed to load bitmap font: ${data.font}`, err);
                        data.font = 0;
                    }
                }
            }

            if (compData.type === 'SpineAnimation' && assetServer) {
                const data = compData.data as Record<string, unknown>;
                const skeletonPath = data.skeletonPath as string;
                const atlasPath = data.atlasPath as string;
                if (skeletonPath && atlasPath) {
                    const result = await assetServer.loadSpine(
                        skeletonPath,
                        atlasPath,
                        options?.assetBaseUrl
                    );
                    if (!result.success) {
                        console.warn(`Failed to load Spine: ${result.error}`);
                    }
                }
                if (typeof data.material === 'string' && data.material) {
                    try {
                        const loaded = await assetServer.loadMaterial(
                            data.material,
                            options?.assetBaseUrl
                        );
                        data.material = loaded.handle;
                    } catch (err) {
                        console.warn(`Failed to load material: ${data.material}`, err);
                        data.material = 0;
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

export function loadComponent(world: World, entity: Entity, compData: SceneComponentData): void {
    const data = compData.data;
    switch (compData.type) {
        case 'LocalTransform':
            world.insert(entity, LocalTransform, data as Partial<LocalTransformData>);
            break;
        case 'Sprite':
            world.insert(entity, Sprite, data as Partial<SpriteData>);
            break;
        case 'Camera':
            world.insert(entity, Camera, data as Partial<CameraData>);
            break;
        case 'Canvas':
            world.insert(entity, Canvas, data as Partial<CanvasData>);
            break;
        case 'Text':
            world.insert(entity, Text, data as Partial<TextData>);
            break;
        case 'BitmapText':
            world.insert(entity, BitmapText, data as Partial<BitmapTextData>);
            break;
        case 'SpineAnimation':
            world.insert(entity, SpineAnimation, data as Partial<SpineAnimationData>);
            break;
        case 'UIRect': {
            const rectData = data as Record<string, unknown>;
            if (rectData.anchor && !rectData.anchorMin) {
                rectData.anchorMin = { ...(rectData.anchor as Record<string, unknown>) };
                rectData.anchorMax = { ...(rectData.anchor as Record<string, unknown>) };
                delete rectData.anchor;
            }
            world.insert(entity, UIRect, rectData as Partial<UIRectData>);
            break;
        }
        case 'UIMask':
            world.insert(entity, UIMask, data as Partial<UIMaskData>);
            break;
        case 'Interactable':
            world.insert(entity, Interactable, data as Partial<InteractableData>);
            break;
        case 'Button':
            world.insert(entity, Button, data as Partial<ButtonData>);
            break;
        case 'RigidBody':
            world.insert(entity, RigidBody, data as Partial<RigidBodyData>);
            break;
        case 'BoxCollider':
            world.insert(entity, BoxCollider, data as Partial<BoxColliderData>);
            break;
        case 'CircleCollider':
            world.insert(entity, CircleCollider, data as Partial<CircleColliderData>);
            break;
        case 'CapsuleCollider':
            world.insert(entity, CapsuleCollider, data as Partial<CapsuleColliderData>);
            break;
        default: {
            const userComp = getUserComponent(compData.type);
            if (userComp) {
                world.insert(entity, userComp, data);
            } else {
                console.warn(`Unknown component type: ${compData.type}`);
            }
            break;
        }
    }
}

export function updateCameraAspectRatio(world: World, aspectRatio: number): void {
    const cameraEntities = world.getEntitiesWithComponents([Camera]);
    for (const entity of cameraEntities) {
        const camera = world.get(entity, Camera);
        if (camera) {
            camera.aspectRatio = aspectRatio;
            world.insert(entity, Camera, camera);
        }
    }
}

export function findEntityByName(world: World, name: string): Entity | null {
    const entities = world.getEntitiesWithComponents([Name]);
    for (const entity of entities) {
        const data = world.get(entity, Name);
        if (data && data.value === name) {
            return entity;
        }
    }
    return null;
}

