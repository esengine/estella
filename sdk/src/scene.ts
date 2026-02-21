/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from './world';
import { Entity, INVALID_ENTITY } from './types';
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

export type AssetFieldType = 'texture' | 'material' | 'font';

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
    ['Image', {
        fields: [
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
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

export function getComponentAssetFieldDescriptors(
    componentType: string,
): readonly { field: string; type: AssetFieldType }[] {
    return COMPONENT_ASSET_FIELDS.get(componentType)?.fields ?? [];
}

export function getComponentSpineFieldDescriptor(
    componentType: string,
): { skeletonField: string; atlasField: string } | null {
    return COMPONENT_ASSET_FIELDS.get(componentType)?.spine ?? null;
}

export function getRegisteredAssetComponentTypes(): string[] {
    return Array.from(COMPONENT_ASSET_FIELDS.keys());
}

// =============================================================================
// Component Entity Reference Fields Registry
// =============================================================================

const COMPONENT_ENTITY_FIELDS = new Map<string, string[]>([
    ['Slider', ['fillEntity', 'handleEntity']],
    ['ProgressBar', ['fillEntity']],
    ['Toggle', ['graphicEntity', 'group']],
    ['ScrollView', ['contentEntity']],
    ['Dropdown', ['listEntity', 'labelEntity']],
]);

export function registerComponentEntityFields(
    componentType: string,
    fields: string[]
): void {
    COMPONENT_ENTITY_FIELDS.set(componentType, fields);
}

function remapEntityFields(compData: SceneComponentData, entityMap: Map<number, Entity>): void {
    const fields = COMPONENT_ENTITY_FIELDS.get(compData.type);
    if (!fields) return;
    const data = compData.data as Record<string, unknown>;
    for (const field of fields) {
        const editorId = data[field];
        if (typeof editorId === 'number' && editorId !== INVALID_ENTITY) {
            const runtimeId = entityMap.get(editorId);
            data[field] = runtimeId !== undefined ? runtimeId : INVALID_ENTITY;
        }
    }
}

// =============================================================================
// Scene Loader
// =============================================================================

function spawnAndLoadEntities(world: World, sceneData: SceneData): Map<number, Entity> {
    const entityMap = new Map<number, Entity>();

    for (const entityData of sceneData.entities) {
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);
        world.insert(entity, Name, { value: entityData.name });
    }

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;
        const entity = entityMap.get(entityData.id)!;
        for (const compData of entityData.components) {
            remapEntityFields(compData, entityMap);
            loadComponent(world, entity, compData, entityData.name);
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

    return entityMap;
}

export function loadSceneData(world: World, sceneData: SceneData): Map<number, Entity> {
    return spawnAndLoadEntities(world, sceneData);
}

export async function loadSceneWithAssets(
    world: World,
    sceneData: SceneData,
    options?: SceneLoadOptions
): Promise<Map<number, Entity>> {
    const assetServer = options?.assetServer;
    const baseUrl = options?.assetBaseUrl;
    const texturePathToUrl = new Map<string, string>();

    if (assetServer) {
        await preloadSceneAssets(sceneData, assetServer, baseUrl, texturePathToUrl);
    }

    const entityMap = spawnAndLoadEntities(world, sceneData);

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

interface AssetFieldHandler {
    load(paths: Set<string>, assetServer: AssetServer, baseUrl: string | undefined,
         texturePathToUrl: Map<string, string>): Promise<Map<string, number>>;
}

const ASSET_FIELD_HANDLERS = new Map<AssetFieldType, AssetFieldHandler>([
    ['texture', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const handles = new Map<string, number>();
            const promises = [...paths].map(async (texturePath) => {
                try {
                    const isDataUrl = texturePath.startsWith('data:');
                    const url = isDataUrl ? texturePath : baseUrl ? `${baseUrl}/${texturePath}` : `/${texturePath}`;
                    const info = await assetServer.loadTexture(url);
                    handles.set(texturePath, info.handle);
                    texturePathToUrl.set(texturePath, url);
                } catch (err) {
                    console.warn(`Failed to load texture: ${texturePath}`, err);
                    handles.set(texturePath, 0);
                }
            });
            await Promise.all(promises);
            return handles;
        },
    }],
    ['material', {
        async load(paths, assetServer, baseUrl) {
            const handles = new Map<string, number>();
            const promises = [...paths].map(async (materialPath) => {
                try {
                    const loaded = await assetServer.loadMaterial(materialPath, baseUrl);
                    handles.set(materialPath, loaded.handle);
                } catch (err) {
                    console.warn(`Failed to load material: ${materialPath}`, err);
                    handles.set(materialPath, 0);
                }
            });
            await Promise.all(promises);
            return handles;
        },
    }],
    ['font', {
        async load(paths, assetServer, baseUrl) {
            const handles = new Map<string, number>();
            const promises = [...paths].map(async (fontPath) => {
                try {
                    const handle = await assetServer.loadBitmapFont(fontPath, baseUrl);
                    handles.set(fontPath, handle);
                } catch (err) {
                    console.warn(`Failed to load bitmap font: ${fontPath}`, err);
                    handles.set(fontPath, 0);
                }
            });
            await Promise.all(promises);
            return handles;
        },
    }],
]);

async function preloadSceneAssets(
    sceneData: SceneData,
    assetServer: AssetServer,
    baseUrl: string | undefined,
    texturePathToUrl: Map<string, string>,
): Promise<void> {
    sceneData = JSON.parse(JSON.stringify(sceneData));

    const assetPaths = new Map<AssetFieldType, Set<string>>();
    for (const type of ASSET_FIELD_HANDLERS.keys()) {
        assetPaths.set(type, new Set());
    }
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
                    assetPaths.get(desc.type)?.add(value);
                }
            }
        }
    }

    const assetHandles = new Map<AssetFieldType, Map<string, number>>();
    const loadPromises = [...ASSET_FIELD_HANDLERS.entries()].map(async ([type, handler]) => {
        const handles = await handler.load(assetPaths.get(type)!, assetServer, baseUrl, texturePathToUrl);
        assetHandles.set(type, handles);
    });

    const spinePromises = spines.map(async (spine) => {
        const result = await assetServer.loadSpine(spine.skeleton, spine.atlas, baseUrl);
        if (!result.success) {
            console.warn(`Failed to load Spine: ${result.error}`);
        }
    });

    await Promise.all([...loadPromises, ...spinePromises]);

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            const config = COMPONENT_ASSET_FIELDS.get(compData.type);
            if (!config?.fields) continue;

            const data = compData.data as Record<string, unknown>;
            for (const desc of config.fields) {
                const value = data[desc.field];
                if (typeof value !== 'string' || !value) continue;
                data[desc.field] = assetHandles.get(desc.type)?.get(value) ?? 0;
            }
        }
    }
}

export function loadComponent(world: World, entity: Entity, compData: SceneComponentData, entityName?: string): void {
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
        const context = entityName ? ` on entity "${entityName}"` : '';
        console.warn(`Unknown component type: ${compData.type}${context}`);
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

