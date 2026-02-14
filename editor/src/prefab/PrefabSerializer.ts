/**
 * @file    PrefabSerializer.ts
 * @brief   .esprefab file read/write and entity tree → prefab conversion
 */

import type { EntityData, ComponentData, SceneData } from '../types/SceneTypes';
import type { PrefabData, PrefabEntityData } from '../types/PrefabTypes';
import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';
import { getGlobalPathResolver, getAssetDatabase, isUUID, getComponentRefFields } from '../asset';
import { stripComponentDefaults, mergeComponentDefaults } from '../io/sparse';

// =============================================================================
// Serialization
// =============================================================================

export function serializePrefab(prefab: PrefabData): string {
    const sparse: PrefabData = {
        ...prefab,
        entities: prefab.entities.map(e => ({
            ...e,
            components: stripComponentDefaults(e.components),
        })),
    };
    return JSON.stringify(sparse, null, 2);
}

export function deserializePrefab(json: string): PrefabData {
    const data = JSON.parse(json) as PrefabData;
    validatePrefab(data);
    return data;
}

function validatePrefab(prefab: PrefabData): void {
    if (!prefab.version) {
        prefab.version = '1.0';
    }
    if (!prefab.name) {
        prefab.name = 'Unnamed';
    }
    if (typeof prefab.rootEntityId !== 'number') {
        prefab.rootEntityId = 1;
    }
    if (!Array.isArray(prefab.entities)) {
        prefab.entities = [];
    }
    for (const entity of prefab.entities) {
        validatePrefabEntity(entity);
    }
}

function validatePrefabEntity(entity: PrefabEntityData): void {
    if (typeof entity.prefabEntityId !== 'number') {
        throw new Error('PrefabEntity must have numeric prefabEntityId');
    }
    if (!entity.name) {
        entity.name = `Entity_${entity.prefabEntityId}`;
    }
    if (!Array.isArray(entity.children)) {
        entity.children = [];
    }
    if (!Array.isArray(entity.components)) {
        entity.components = [];
    }
    for (const comp of entity.components) {
        mergeComponentDefaults(comp);
    }
    if (entity.visible === undefined) {
        entity.visible = true;
    }
}

// =============================================================================
// Entity Tree → PrefabData Conversion
// =============================================================================

export interface EntityTreeToPrefabResult {
    prefab: PrefabData;
    idMapping: Map<number, number>;
}

export function entityTreeToPrefab(
    name: string,
    rootEntityId: number,
    entities: EntityData[]
): EntityTreeToPrefabResult {
    const idMapping = new Map<number, number>();
    let nextPrefabId = 1;

    const collectIds = (entityId: number) => {
        idMapping.set(entityId, nextPrefabId++);
        const entity = entities.find(e => e.id === entityId);
        if (entity) {
            for (const childId of entity.children) {
                collectIds(childId);
            }
        }
    };
    collectIds(rootEntityId);

    const prefabEntities: PrefabEntityData[] = [];
    for (const [sceneId, prefabId] of idMapping) {
        const entity = entities.find(e => e.id === sceneId);
        if (!entity) continue;

        const parentPrefabId = entity.parent !== null ? idMapping.get(entity.parent) ?? null : null;
        const childPrefabIds = entity.children
            .map(cid => idMapping.get(cid))
            .filter((id): id is number => id !== undefined);

        const prefabEntity: PrefabEntityData = {
            prefabEntityId: prefabId,
            name: entity.name,
            parent: sceneId === rootEntityId ? null : parentPrefabId,
            children: childPrefabIds,
            components: deepCloneComponents(entity.components),
            visible: entity.visible,
        };

        if (entity.prefab?.prefabPath) {
            prefabEntity.nestedPrefab = {
                prefabPath: entity.prefab.prefabPath,
                overrides: [...(entity.prefab.overrides ?? [])],
            };
        }

        prefabEntities.push(prefabEntity);
    }

    return {
        prefab: {
            version: '1.0',
            name,
            rootEntityId: 1,
            entities: prefabEntities,
        },
        idMapping,
    };
}

// =============================================================================
// PrefabData ↔ SceneData Conversion
// =============================================================================

export function prefabToSceneData(prefab: PrefabData): SceneData {
    const entities: EntityData[] = prefab.entities.map(pe => ({
        id: pe.prefabEntityId,
        name: pe.name,
        parent: pe.parent,
        children: [...pe.children],
        components: deepCloneComponents(pe.components),
        visible: pe.visible,
    }));

    return {
        version: '2.0',
        name: prefab.name,
        entities,
    };
}

export function sceneDataToPrefab(scene: SceneData): PrefabData {
    const roots = scene.entities.filter(e => e.parent === null);
    const rootId = roots.length > 0 ? roots[0].id : (scene.entities[0]?.id ?? 1);

    const { prefab } = entityTreeToPrefab(scene.name, rootId, scene.entities);
    return prefab;
}

function deepCloneComponents(components: ComponentData[]): ComponentData[] {
    return components.map(c => ({
        type: c.type,
        data: JSON.parse(JSON.stringify(c.data)),
    }));
}

// =============================================================================
// Asset Reference Conversion (UUID ↔ Path)
// =============================================================================

type AssetRefConverter = (value: string) => string;

function convertAssetRefsInComponents(
    components: ComponentData[],
    converter: AssetRefConverter
): ComponentData[] {
    return components.map(c => {
        const fields = getComponentRefFields(c.type);
        if (!fields || !c.data) return { type: c.type, data: { ...c.data } };

        const data = { ...c.data };
        for (const field of fields) {
            const value = data[field];
            if (typeof value === 'string' && value) {
                data[field] = converter(value);
            }
        }
        return { type: c.type, data };
    });
}

export function convertPrefabAssetRefs(
    prefab: PrefabData,
    converter: AssetRefConverter
): PrefabData {
    const entities: PrefabEntityData[] = prefab.entities.map(entity => {
        const converted: PrefabEntityData = {
            ...entity,
            components: convertAssetRefsInComponents(entity.components, converter),
        };
        if (entity.nestedPrefab) {
            converted.nestedPrefab = {
                ...entity.nestedPrefab,
                prefabPath: converter(entity.nestedPrefab.prefabPath),
            };
        }
        return converted;
    });

    return { ...prefab, entities };
}

// =============================================================================
// File I/O
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

function resolvePathOrUuid(filePathOrUuid: string): string {
    if (isUUID(filePathOrUuid)) {
        return getAssetDatabase().getPath(filePathOrUuid) ?? filePathOrUuid;
    }
    return filePathOrUuid;
}

export async function savePrefabToPath(prefab: PrefabData, filePath: string): Promise<boolean> {
    const fs = getNativeFS();
    if (!fs) return false;

    const resolved = resolvePathOrUuid(filePath);
    const absolutePath = getGlobalPathResolver().toAbsolutePath(resolved);
    const db = getAssetDatabase();
    const converted = convertPrefabAssetRefs(prefab, (value) => {
        if (isUUID(value)) {
            return db.getPath(value) ?? value;
        }
        return value;
    });
    const json = serializePrefab(converted);
    return fs.writeFile(absolutePath, json);
}

export async function loadPrefabFromPath(filePath: string): Promise<PrefabData | null> {
    const fs = getNativeFS();
    if (!fs) return null;

    const resolved = resolvePathOrUuid(filePath);
    const absolutePath = getGlobalPathResolver().toAbsolutePath(resolved);

    try {
        const content = await fs.readFile(absolutePath);
        if (!content) return null;
        const prefab = deserializePrefab(content);
        const db = getAssetDatabase();
        return convertPrefabAssetRefs(prefab, (value) => {
            if (!isUUID(value)) {
                return db.getUuid(value) ?? value;
            }
            return value;
        });
    } catch (err) {
        console.error('Failed to load prefab:', absolutePath, err);
        return null;
    }
}
