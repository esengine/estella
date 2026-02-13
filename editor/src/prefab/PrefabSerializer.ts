/**
 * @file    PrefabSerializer.ts
 * @brief   .esprefab file read/write and entity tree → prefab conversion
 */

import type { EntityData, ComponentData, SceneData } from '../types/SceneTypes';
import type { PrefabData, PrefabEntityData } from '../types/PrefabTypes';
import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';
import { getGlobalPathResolver } from '../asset';

// =============================================================================
// Serialization
// =============================================================================

export function serializePrefab(prefab: PrefabData): string {
    return JSON.stringify(prefab, null, 2);
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
// File I/O
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

export async function savePrefabToPath(prefab: PrefabData, filePath: string): Promise<boolean> {
    const fs = getNativeFS();
    if (!fs) return false;

    const absolutePath = getGlobalPathResolver().toAbsolutePath(filePath);
    const json = serializePrefab(prefab);
    return fs.writeFile(absolutePath, json);
}

export async function loadPrefabFromPath(filePath: string): Promise<PrefabData | null> {
    const fs = getNativeFS();
    if (!fs) return null;

    const absolutePath = getGlobalPathResolver().toAbsolutePath(filePath);

    try {
        const content = await fs.readFile(absolutePath);
        if (!content) return null;
        return deserializePrefab(content);
    } catch (err) {
        console.error('Failed to load prefab:', absolutePath, err);
        return null;
    }
}
