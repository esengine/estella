/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from './world';
import { Entity, INVALID_ENTITY } from './types';
import { getComponent, Name, Camera } from './component';
import type { AssetServer } from './asset/AssetServer';
import { getAssetHandlers, type AssetFieldHandler } from './asset/AssetHandlerRegistry';
import { discoverSceneAssets } from './asset/discoverAssets';
import './asset/builtinAssetHandlers';

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

export interface LoadedSceneAssets {
    textureUrls: Set<string>;
    materialHandles: Set<number>;
    fontPaths: Set<string>;
    spineKeys: Set<string>;
}

export interface SceneLoadOptions {
    assetServer?: AssetServer;
    assets?: import('./asset/Assets').Assets;
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
}

// =============================================================================
// Asset Field Types
// =============================================================================

export type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'tilemap' | 'timeline';

// =============================================================================
// Component Query Helpers (read from self-describing ComponentDef)
// =============================================================================

export function getComponentAssetFields(componentType: string): string[] {
    const comp = getComponent(componentType);
    if (!comp) return [];
    const fields: string[] = [];
    for (const { field } of comp.assetFields) {
        fields.push(field);
    }
    if (comp.spineFields) {
        fields.push(comp.spineFields.skeletonField);
        fields.push(comp.spineFields.atlasField);
    }
    return fields;
}

export function getComponentAssetFieldDescriptors(
    componentType: string,
): readonly { field: string; type: AssetFieldType }[] {
    return getComponent(componentType)?.assetFields ?? [];
}

export function getComponentSpineFieldDescriptor(
    componentType: string,
): { skeletonField: string; atlasField: string } | null {
    return getComponent(componentType)?.spineFields ?? null;
}

// =============================================================================
// Entity Reference Remapping
// =============================================================================

export function remapEntityFields(compData: SceneComponentData, entityMap: Map<number, Entity>): void {
    const comp = getComponent(compData.type);
    if (!comp || comp.entityFields.length === 0) return;
    const data = compData.data as Record<string, unknown>;
    for (const field of comp.entityFields) {
        const editorId = data[field];
        if (typeof editorId === 'number' && editorId !== INVALID_ENTITY) {
            const runtimeId = entityMap.get(editorId);
            if (runtimeId === undefined) {
                console.warn(
                    `[Scene] Entity reference not found: ${compData.type}.${field} ` +
                    `references entity ${editorId} which does not exist`,
                );
            }
            data[field] = runtimeId !== undefined ? runtimeId : INVALID_ENTITY;
        }
    }
}

// =============================================================================
// Scene Migration
// =============================================================================

function migrateToUIRenderer(entityData: SceneEntityData): void {
    const hasUIRect = entityData.components.some(c => c.type === 'UIRect');
    const spriteIdx = entityData.components.findIndex(c => c.type === 'Sprite');
    const hasUIRenderer = entityData.components.some(c => c.type === 'UIRenderer');

    if (!hasUIRect || spriteIdx === -1 || hasUIRenderer) return;

    const sprite = entityData.components[spriteIdx].data;
    const tex = sprite.texture as number | undefined;
    entityData.components.push({
        type: 'UIRenderer',
        data: {
            visualType: tex ? 2 : 1,
            texture: tex ?? 0,
            color: sprite.color ?? { r: 1, g: 1, b: 1, a: 1 },
            uvOffset: sprite.uvOffset ?? { x: 0, y: 0 },
            uvScale: sprite.uvScale ?? { x: 1, y: 1 },
            sliceBorder: sprite.sliceBorder ?? { x: 0, y: 0, z: 0, w: 0 },
            material: sprite.material ?? 0,
            enabled: sprite.enabled ?? true,
        },
    });
    entityData.components.splice(spriteIdx, 1);
}

// =============================================================================
// Scene Loader
// =============================================================================

function spawnAndLoadEntities(world: World, sceneData: SceneData): Map<number, Entity> {
    const entityMap = new Map<number, Entity>();

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);
        world.insert(entity, Name, { value: entityData.name });
    }

    try {
        for (const entityData of sceneData.entities) {
            if (entityData.visible === false) continue;
            migrateToUIRenderer(entityData);
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
    } catch (e) {
        for (const entity of entityMap.values()) {
            try { world.despawn(entity); } catch { /* ignore cleanup errors */ }
        }
        throw e;
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
    if (options?.assets) {
        const assets = options.assets;
        const result = await assets.preloadSceneAssets(sceneData);
        assets.resolveSceneAssetPaths(sceneData, result);
        return spawnAndLoadEntities(world, sceneData);
    }

    const assetServer = options?.assetServer;
    const baseUrl = options?.assetBaseUrl ?? assetServer?.baseUrl;
    const texturePathToUrl = new Map<string, string>();

    if (assetServer) {
        await preloadSceneAssets(sceneData, assetServer, baseUrl, texturePathToUrl, options?.collectAssets);
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

export { type AssetFieldHandler } from './asset/AssetHandlerRegistry';

async function preloadSceneAssets(
    sceneData: SceneData,
    assetServer: AssetServer,
    baseUrl: string | undefined,
    texturePathToUrl: Map<string, string>,
    collectAssets?: LoadedSceneAssets,
): Promise<void> {
    const handlers = getAssetHandlers();
    const discovered = discoverSceneAssets(sceneData);
    const assetPaths = discovered.byType;
    const spines = discovered.spines;

    const assetHandles = new Map<string, Map<string, number>>();
    const loadPromises = [...handlers.entries()].map(async ([type, handler]) => {
        const paths = assetPaths.get(type);
        if (!paths || paths.size === 0) return;
        const handles = await handler.load(paths, assetServer, baseUrl, texturePathToUrl);
        assetHandles.set(type, handles);
    });

    const spinePromises = spines.map(async (spine) => {
        const result = await assetServer.loadSpine(spine.skeleton, spine.atlas, baseUrl);
        if (!result.success) {
            console.warn(`Failed to load Spine: ${result.error}`);
        }
    });

    await Promise.all([...loadPromises, ...spinePromises]);

    if (collectAssets) {
        for (const url of texturePathToUrl.values()) {
            collectAssets.textureUrls.add(url);
        }
        const materialHandles = assetHandles.get('material');
        if (materialHandles) {
            for (const handle of materialHandles.values()) {
                if (handle > 0) collectAssets.materialHandles.add(handle);
            }
        }
        const fontPaths = assetPaths.get('font');
        if (fontPaths) {
            for (const path of fontPaths) {
                collectAssets.fontPaths.add(path);
            }
        }
        for (const spine of spines) {
            collectAssets.spineKeys.add(`${spine.skeleton}:${spine.atlas}`);
        }
    }

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            const comp = getComponent(compData.type);
            if (!comp || comp.assetFields.length === 0) continue;

            const data = compData.data as Record<string, unknown>;
            for (const desc of comp.assetFields) {
                const handles = assetHandles.get(desc.type);
                if (!handles) continue;
                const value = data[desc.field];
                if (typeof value !== 'string' || !value) continue;
                const handle = handles.get(value);
                if (handle !== undefined) {
                    data[desc.field] = handle;
                }
            }
        }
    }
}

export function loadComponent(world: World, entity: Entity, compData: SceneComponentData, entityName?: string): void {
    if (compData.type === 'LocalTransform' || compData.type === 'WorldTransform') {
        compData.type = 'Transform';
    }
    if (compData.type === 'UIRect') {
        const rectData = compData.data as Record<string, unknown>;
        if (rectData.anchor && !rectData.anchorMin) {
            rectData.anchorMin = { ...(rectData.anchor as Record<string, unknown>) };
            rectData.anchorMax = { ...(rectData.anchor as Record<string, unknown>) };
            delete rectData.anchor;
        }
    }
    if (compData.type === 'UIMask') {
        const maskData = compData.data as Record<string, unknown>;
        if (maskData.mode === 'scissor') maskData.mode = 0;
        else if (maskData.mode === 'stencil') maskData.mode = 1;
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
    return world.findEntityByName(name);
}

