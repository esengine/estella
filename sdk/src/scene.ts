/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from './world';
import { Entity, INVALID_ENTITY } from './types';
import { getComponent, Name, Camera } from './component';
import type { AssetServer } from './asset/AssetServer';
import { extractAnimClipTexturePaths, parseAnimClipData, type AnimClipAssetData } from './animation/AnimClipLoader';
import { registerAnimClip } from './animation/SpriteAnimator';
import { Audio } from './audio/Audio';
import { registerTilemapSource } from './tilemap/tilesetCache';
import { parseTmjJson, resolveRelativePath } from './tilemap/tiledLoader';
import { parseTimelineAsset, extractTimelineAssetPaths } from './timeline/TimelineLoader';
import { registerTimelineAsset, registerTimelineTextureHandles } from './timeline/TimelinePlugin';

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
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
}

// =============================================================================
// Component Asset Field Registry
// =============================================================================

export type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'tilemap' | 'timeline';

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
    ['UIRenderer', {
        fields: [
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ],
    }],
    ['SpriteAnimator', {
        fields: [
            { field: 'clip', type: 'anim-clip' },
        ],
    }],
    ['AudioSource', {
        fields: [
            { field: 'clip', type: 'audio' },
        ],
    }],
    ['ParticleEmitter', {
        fields: [
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ],
    }],
    ['Tilemap', {
        fields: [
            { field: 'source', type: 'tilemap' },
        ],
    }],
    ['TilemapLayer', {
        fields: [
            { field: 'texture', type: 'texture' },
        ],
    }],
    ['TimelinePlayer', {
        fields: [
            { field: 'timeline', type: 'timeline' },
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

export {
    registerComponentEntityFields,
    getComponentEntityFields,
} from './componentEntityFields';

import { getComponentEntityFields } from './componentEntityFields';

export function remapEntityFields(compData: SceneComponentData, entityMap: Map<number, Entity>): void {
    const fields = getComponentEntityFields(compData.type);
    if (!fields) return;
    const data = compData.data as Record<string, unknown>;
    for (const field of fields) {
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
    ['anim-clip', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const promises = [...paths].map(async (clipPath) => {
                try {
                    const data = await assetServer.loadJson<AnimClipAssetData>(clipPath);
                    const texturePaths = extractAnimClipTexturePaths(data);
                    const textureHandles = new Map<string, number>();

                    const texPromises = texturePaths.map(async (texPath) => {
                        try {
                            const url = baseUrl ? `${baseUrl}/${texPath}` : `/${texPath}`;
                            const info = await assetServer.loadTexture(url);
                            textureHandles.set(texPath, info.handle);
                            texturePathToUrl.set(texPath, url);
                        } catch (err) {
                            console.warn(`Failed to load anim texture: ${texPath}`, err);
                            textureHandles.set(texPath, 0);
                        }
                    });
                    await Promise.all(texPromises);

                    const clip = parseAnimClipData(clipPath, data, textureHandles);
                    registerAnimClip(clip);
                } catch (err) {
                    console.warn(`Failed to load animation clip: ${clipPath}`, err);
                }
            });
            await Promise.all(promises);
            return new Map();
        },
    }],
    ['audio', {
        async load(paths, _assetServer, baseUrl) {
            const urls = [...paths].map(p => baseUrl ? `${baseUrl}/${p}` : `/${p}`);
            await Audio.preloadAll(urls).catch(err => {
                console.warn('Failed to preload audio assets:', err);
            });
            return new Map();
        },
    }],
    ['tilemap', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const promises = [...paths].map(async (tmjPath) => {
                try {
                    const json = await assetServer.loadJson<Record<string, unknown>>(tmjPath);
                    const mapData = parseTmjJson(json);
                    if (!mapData) {
                        console.warn(`Failed to parse tilemap: ${tmjPath}`);
                        return;
                    }

                    const tilesets = [];
                    for (const ts of mapData.tilesets) {
                        const imagePath = resolveRelativePath(tmjPath, ts.image);
                        let textureHandle = 0;
                        try {
                            const url = baseUrl ? `${baseUrl}/${imagePath}` : `/${imagePath}`;
                            const info = await assetServer.loadTexture(url);
                            textureHandle = info.handle;
                            texturePathToUrl.set(imagePath, url);
                        } catch (err) {
                            console.warn(`Failed to load tileset texture: ${imagePath}`, err);
                        }
                        tilesets.push({ textureHandle, columns: ts.columns });
                    }

                    registerTilemapSource(tmjPath, {
                        tileWidth: mapData.tileWidth,
                        tileHeight: mapData.tileHeight,
                        layers: mapData.layers.map(l => ({
                            name: l.name,
                            width: l.width,
                            height: l.height,
                            tiles: l.tiles,
                            chunks: l.chunks ?? [],
                            infinite: l.infinite ?? false,
                        })),
                        tilesets,
                    });
                } catch (err) {
                    console.warn(`Failed to load tilemap: ${tmjPath}`, err);
                }
            });
            await Promise.all(promises);
            return new Map();
        },
    }],
    ['timeline', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const promises = [...paths].map(async (tlPath) => {
                try {
                    const raw = await assetServer.loadJson<Record<string, unknown>>(tlPath);
                    const asset = parseTimelineAsset(raw);
                    registerTimelineAsset(tlPath, asset);

                    const assetPaths = extractTimelineAssetPaths(asset);
                    if (assetPaths.textures.length > 0) {
                        const handles = new Map<string, number>();
                        const texPromises = assetPaths.textures.map(async (texPath) => {
                            try {
                                const url = baseUrl ? `${baseUrl}/${texPath}` : `/${texPath}`;
                                const info = await assetServer.loadTexture(url);
                                handles.set(texPath, info.handle);
                                texturePathToUrl.set(texPath, url);
                            } catch (err) {
                                console.warn(`Failed to load animFrames texture: ${texPath}`, err);
                                handles.set(texPath, 0);
                            }
                        });
                        await Promise.all(texPromises);
                        registerTimelineTextureHandles(tlPath, handles);
                    }
                } catch (err) {
                    console.warn(`Failed to load timeline: ${tlPath}`, err);
                }
            });
            await Promise.all(promises);
            return new Map();
        },
    }],
]);

async function preloadSceneAssets(
    sceneData: SceneData,
    assetServer: AssetServer,
    baseUrl: string | undefined,
    texturePathToUrl: Map<string, string>,
    collectAssets?: LoadedSceneAssets,
): Promise<void> {
    const assetPaths = new Map<AssetFieldType, Set<string>>();
    for (const type of ASSET_FIELD_HANDLERS.keys()) {
        assetPaths.set(type, new Set());
    }
    const spines: { skeleton: string; atlas: string }[] = [];
    const spineKeys = new Set<string>();

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            if (compData.type === 'StateMachine') {
                const smData = compData.data as { states?: Record<string, { timeline?: string }> };
                if (smData.states) {
                    for (const state of Object.values(smData.states)) {
                        if (typeof state.timeline === 'string' && state.timeline) {
                            assetPaths.get('timeline')?.add(state.timeline);
                        }
                    }
                }
            }

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
        for (const key of spineKeys) {
            collectAssets.spineKeys.add(key);
        }
    }

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;

        for (const compData of entityData.components) {
            const config = COMPONENT_ASSET_FIELDS.get(compData.type);
            if (!config?.fields) continue;

            const data = compData.data as Record<string, unknown>;
            for (const desc of config.fields) {
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

