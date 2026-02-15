/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from './world';
import { Entity } from './types';
import { getComponent, Name, Camera } from './component';
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
    visible?: boolean;
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
// Component Asset Field Registry
// =============================================================================

type AssetFieldType = 'texture' | 'material' | 'font';

interface AssetFieldDescriptor {
    field: string;
    type: AssetFieldType;
}

interface SpineFieldDescriptor {
    skeletonField: string;
    atlasField: string;
}

interface ComponentAssetFields {
    fields?: AssetFieldDescriptor[];
    spine?: SpineFieldDescriptor;
}

const COMPONENT_ASSET_FIELDS = new Map<string, ComponentAssetFields>([
    ['Sprite', {
        fields: [
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ],
    }],
    ['SpineAnimation', {
        spine: { skeletonField: 'skeletonPath', atlasField: 'atlasPath' },
        fields: [
            { field: 'material', type: 'material' },
        ],
    }],
    ['BitmapText', {
        fields: [
            { field: 'font', type: 'font' },
        ],
    }],
]);

export function registerComponentAssetFields(
    componentType: string,
    config: ComponentAssetFields
): void {
    COMPONENT_ASSET_FIELDS.set(componentType, config);
}

export function getComponentAssetFields(componentType: string): string[] {
    const config = COMPONENT_ASSET_FIELDS.get(componentType);
    if (!config) return [];

    const fields: string[] = [];
    if (config.fields) {
        for (const { field } of config.fields) {
            fields.push(field);
        }
    }
    if (config.spine) {
        fields.push(config.spine.skeletonField);
        fields.push(config.spine.atlasField);
    }
    return fields;
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

        if (entityData.visible !== false) {
            for (const compData of entityData.components) {
                loadComponent(world, entity, compData);
            }
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
    const baseUrl = options?.assetBaseUrl;
    const texturePathToUrl = new Map<string, string>();

    if (assetServer) {
        await preloadSceneAssets(sceneData, assetServer, baseUrl, texturePathToUrl);
    }

    for (const entityData of sceneData.entities) {
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);
        world.insert(entity, Name, { value: entityData.name });

        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
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

async function preloadSceneAssets(
    sceneData: SceneData,
    assetServer: AssetServer,
    baseUrl: string | undefined,
    texturePathToUrl: Map<string, string>,
): Promise<void> {
    sceneData = JSON.parse(JSON.stringify(sceneData));

    const textures = new Set<string>();
    const materials = new Set<string>();
    const fonts = new Set<string>();
    const spines: { skeleton: string; atlas: string }[] = [];
    const spineKeys = new Set<string>();

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            const config = COMPONENT_ASSET_FIELDS.get(compData.type);
            if (!config) continue;

            const data = compData.data as Record<string, unknown>;

            if (config.spine) {
                const skelPath = data[config.spine.skeletonField] as string;
                const atlasPath = data[config.spine.atlasField] as string;
                if (skelPath && atlasPath) {
                    const key = `${skelPath}:${atlasPath}`;
                    if (!spineKeys.has(key)) {
                        spineKeys.add(key);
                        spines.push({ skeleton: skelPath, atlas: atlasPath });
                    }
                }
            }

            if (config.fields) {
                for (const desc of config.fields) {
                    const value = data[desc.field];
                    if (typeof value !== 'string' || !value) continue;

                    switch (desc.type) {
                        case 'texture': textures.add(value); break;
                        case 'material': materials.add(value); break;
                        case 'font': fonts.add(value); break;
                    }
                }
            }
        }
    }

    const textureHandles = new Map<string, number>();
    const materialHandles = new Map<string, number>();
    const fontHandles = new Map<string, number>();

    const promises: Promise<void>[] = [];

    for (const texturePath of textures) {
        promises.push((async () => {
            try {
                const isDataUrl = texturePath.startsWith('data:');
                const url = isDataUrl
                    ? texturePath
                    : baseUrl ? `${baseUrl}/${texturePath}` : `/${texturePath}`;
                const info = await assetServer.loadTexture(url);
                textureHandles.set(texturePath, info.handle);
                texturePathToUrl.set(texturePath, url);
            } catch (err) {
                console.warn(`Failed to load texture: ${texturePath}`, err);
                textureHandles.set(texturePath, 0);
            }
        })());
    }

    for (const materialPath of materials) {
        promises.push((async () => {
            try {
                const loaded = await assetServer.loadMaterial(materialPath, baseUrl);
                materialHandles.set(materialPath, loaded.handle);
            } catch (err) {
                console.warn(`Failed to load material: ${materialPath}`, err);
                materialHandles.set(materialPath, 0);
            }
        })());
    }

    for (const fontPath of fonts) {
        promises.push((async () => {
            try {
                const handle = await assetServer.loadBitmapFont(fontPath, baseUrl);
                fontHandles.set(fontPath, handle);
            } catch (err) {
                console.warn(`Failed to load bitmap font: ${fontPath}`, err);
                fontHandles.set(fontPath, 0);
            }
        })());
    }

    for (const spine of spines) {
        promises.push((async () => {
            const result = await assetServer.loadSpine(spine.skeleton, spine.atlas, baseUrl);
            if (!result.success) {
                console.warn(`Failed to load Spine: ${result.error}`);
            }
        })());
    }

    await Promise.all(promises);

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            const config = COMPONENT_ASSET_FIELDS.get(compData.type);
            if (!config?.fields) continue;

            const data = compData.data as Record<string, unknown>;
            for (const desc of config.fields) {
                const value = data[desc.field];
                if (typeof value !== 'string' || !value) continue;

                switch (desc.type) {
                    case 'texture':
                        data[desc.field] = textureHandles.get(value) ?? 0;
                        break;
                    case 'material':
                        data[desc.field] = materialHandles.get(value) ?? 0;
                        break;
                    case 'font':
                        data[desc.field] = fontHandles.get(value) ?? 0;
                        break;
                }
            }
        }
    }
}

export function loadComponent(world: World, entity: Entity, compData: SceneComponentData): void {
    if (compData.type === 'UIRect') {
        const rectData = compData.data as Record<string, unknown>;
        if (rectData.anchor && !rectData.anchorMin) {
            rectData.anchorMin = { ...(rectData.anchor as Record<string, unknown>) };
            rectData.anchorMax = { ...(rectData.anchor as Record<string, unknown>) };
            delete rectData.anchor;
        }
    }
    const comp = getComponent(compData.type);
    if (comp) {
        world.insert(entity, comp, compData.data);
    } else {
        console.warn(`Unknown component type: ${compData.type}`);
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

