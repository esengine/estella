/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from './world';
import { Entity, INVALID_ENTITY } from './types';
import { getComponent, Name, Camera } from './component';
import { discoverSceneAssets } from './asset/discoverAssets';
import { requireResourceManager } from './resourceManager';
import { validateComponentData, formatValidationErrors } from './validation';
import { log } from './logger';

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
    texturePaths: Set<string>;
    materialHandles: Set<number>;
    fontPaths: Set<string>;
    spineKeys: Set<string>;
}

export type SceneLoadProgressCallback = (loaded: number, total: number) => void;

export type MissingAssetCallback = (missing: import('./asset/Assets').MissingAsset[]) => void;

export interface SceneLoadOptions {
    assets?: import('./asset/Assets').Assets;
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
    onProgress?: SceneLoadProgressCallback;
    /**
     * Invoked once during load with the list of asset refs that could not
     * be loaded (unresolved UUID or fetch failure). Fires even if the list
     * is empty — callers that want "missing asset" UI wire this up.
     */
    onMissingAssets?: MissingAssetCallback;
    /**
     * If true, throw after preloading when any asset is missing; the
     * scene is not spawned. Default is false (legacy behaviour: missing
     * assets get handle 0, scene loads anyway).
     */
    abortOnMissingAssets?: boolean;
}

export class MissingAssetsError extends Error {
    readonly missing: import('./asset/Assets').MissingAsset[];
    constructor(missing: import('./asset/Assets').MissingAsset[]) {
        super(`Scene load aborted: ${missing.length} asset(s) missing`);
        this.name = 'MissingAssetsError';
        this.missing = missing;
    }
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
                log.warn(
                    'scene',
                    `Entity reference not found: ${compData.type}.${field} ` +
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
        const result = await assets.preloadSceneAssets(sceneData, options.onProgress);
        if (options.onMissingAssets) {
            options.onMissingAssets(result.missing);
        }
        if (options.abortOnMissingAssets && result.missing.length > 0) {
            throw new MissingAssetsError(result.missing);
        }
        assets.resolveSceneAssetPaths(sceneData, result);
        applyTextureMetadata(sceneData, result.textureHandles);
        if (options.collectAssets) {
            for (const handle of result.materialHandles.values()) {
                if (handle) options.collectAssets.materialHandles.add(handle);
            }
        }
    }
    return spawnAndLoadEntities(world, sceneData);
}

function applyTextureMetadata(sceneData: SceneData, textureHandles: Map<string, number>): void {
    if (!sceneData.textureMetadata) return;
    const rm = requireResourceManager();
    for (const [path, metadata] of Object.entries(sceneData.textureMetadata)) {
        const handle = textureHandles.get(path);
        if (handle && metadata.sliceBorder) {
            const b = metadata.sliceBorder;
            rm.setTextureMetadata(handle, b.left, b.right, b.top, b.bottom);
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
    // Tilemap chunk blob travels outside the component's ES_PROPERTY fields
    // (it's binary, not a settable property). Strip it from the data dict so
    // the component inserter doesn't choke on an unknown key, then hydrate
    // after the component exists on the entity.
    let chunkBlob: string | null = null;
    if (compData.type === 'TilemapLayer') {
        const data = compData.data as Record<string, unknown>;
        if (typeof data.chunks === 'string') {
            chunkBlob = data.chunks as string;
            delete data.chunks;
        }
    }
    const comp = getComponent(compData.type);
    if (comp) {
        const errors = validateComponentData(compData.type, comp._default as Record<string, unknown>, compData.data);
        if (errors.length > 0) {
            const context = entityName ? ` (entity "${entityName}")` : '';
            log.warn('scene', formatValidationErrors(compData.type + context, errors));
        }
        world.insert(entity, comp, compData.data);

        if (compData.type === 'TilemapLayer' && chunkBlob !== null) {
            const wasm = world.getWasmModule();
            if (wasm?.tilemap_importChunks) {
                const ok = wasm.tilemap_importChunks(entity as unknown as number, chunkBlob);
                if (!ok) {
                    log.warn('scene', `TilemapLayer chunk import failed for entity ${entity}`);
                }
            } else {
                log.warn('scene', 'tilemap_importChunks not available; chunk data lost');
            }
        }
    } else {
        const context = entityName ? ` on entity "${entityName}"` : '';
        log.warn('scene', `Unknown component type: ${compData.type}${context}`);
    }
}

// =============================================================================
// Scene Serializer
// =============================================================================

// Components that describe the scene graph structure itself — name, parent
// pointers, children lists, and derived world-transform caches. They are
// reconstructed on load from the SceneEntityData {name, parent, children}
// fields rather than from the components list, so we omit them here.
const STRUCTURAL_COMPONENTS = new Set(['Name', 'Parent', 'Children', 'WorldTransform']);

/**
 * Walks the live world and produces a SceneData that round-trips through
 * loadSceneData. Editors call this on save; external tools (prefab extract,
 * diff, CLI export) can reuse the same primitive.
 *
 * Parent/child links are collapsed into the entity record's parent+children
 * fields; the Parent and Children components themselves are omitted from
 * the components array so loadSceneData's setParent pass is the single
 * source of truth for hierarchy.
 */
export function serializeScene(world: World, sceneName = 'scene'): SceneData {
    const parentDef = getComponent('Parent');
    const allEntities = world.getAllEntities();

    const parentOf = new Map<number, number>();
    if (parentDef) {
        for (const e of allEntities) {
            const parentComp = world.tryGet(e, parentDef) as { entity: number } | null;
            if (parentComp && parentComp.entity !== undefined) {
                parentOf.set(e as unknown as number, parentComp.entity);
            }
        }
    }

    // Derive children from the parent map so we don't have to decode the
    // Children component (whose `entities` field is a wasm VectorEntity on
    // the CPP backend and would leak if iterated without cleanup).
    const childrenOf = new Map<number, number[]>();
    for (const [child, parent] of parentOf) {
        let arr = childrenOf.get(parent);
        if (!arr) {
            arr = [];
            childrenOf.set(parent, arr);
        }
        arr.push(child);
    }

    const entities: SceneEntityData[] = [];
    for (const entity of allEntities) {
        const entityNum = entity as unknown as number;

        const nameComp = world.tryGet(entity, Name) as { value: string } | null;
        const name = nameComp?.value ?? `Entity_${entityNum}`;

        const components: SceneComponentData[] = [];
        for (const typeName of world.getComponentTypes(entity)) {
            if (STRUCTURAL_COMPONENTS.has(typeName)) continue;
            const comp = getComponent(typeName);
            if (!comp) continue;
            const data = world.tryGet(entity, comp);
            if (data === null) continue;
            const dataOut = { ...(data as Record<string, unknown>) };

            // Tilemap tile grid lives in TilemapSystem, not in the component
            // proper. Pull it through the binary export binding and attach
            // it as a sibling field; loadComponent strips it back off on
            // the inbound side so the component inserter doesn't see it.
            if (typeName === 'TilemapLayer') {
                const wasm = world.getWasmModule();
                if (wasm?.tilemap_exportChunks) {
                    const blob = wasm.tilemap_exportChunks(entity as unknown as number);
                    if (blob && blob.length > 0) {
                        dataOut.chunks = blob;
                    }
                }
            }

            components.push({ type: typeName, data: dataOut });
        }

        entities.push({
            id: entityNum,
            name,
            parent: parentOf.get(entityNum) ?? null,
            children: childrenOf.get(entityNum) ?? [],
            components,
        });
    }

    return {
        version: '1.0',
        name: sceneName,
        entities,
    };
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

