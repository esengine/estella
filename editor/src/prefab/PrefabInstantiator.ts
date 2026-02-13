/**
 * @file    PrefabInstantiator.ts
 * @brief   Prefab instantiation into scene
 */

import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import type { PrefabData, PrefabOverride, PrefabInstanceData } from '../types/PrefabTypes';
import { loadPrefabFromPath } from './PrefabSerializer';

// =============================================================================
// Instantiation Result
// =============================================================================

export interface InstantiateResult {
    rootEntityId: number;
    createdEntities: EntityData[];
}

// =============================================================================
// ID Allocation
// =============================================================================

export function computeNextEntityId(scene: SceneData): number {
    return scene.entities.reduce((max, e) => Math.max(max, e.id), 0) + 1;
}

// =============================================================================
// Instance ID Generation
// =============================================================================

let instanceCounter = 0;

function generateInstanceId(): string {
    return `prefab_${Date.now()}_${++instanceCounter}`;
}

// =============================================================================
// Instantiation (non-recursive)
// =============================================================================

export function instantiatePrefab(
    prefab: PrefabData,
    prefabPath: string,
    scene: SceneData,
    parentEntityId: number | null,
    nextEntityIdStart: number,
    overrides: PrefabOverride[] = []
): InstantiateResult {
    const idMapping = new Map<number, number>();
    let nextId = nextEntityIdStart;

    for (const pe of prefab.entities) {
        idMapping.set(pe.prefabEntityId, nextId++);
    }

    const instanceId = generateInstanceId();
    const createdEntities: EntityData[] = [];

    for (const pe of prefab.entities) {
        const sceneId = idMapping.get(pe.prefabEntityId)!;
        const isRoot = pe.prefabEntityId === prefab.rootEntityId;

        let parent: number | null;
        if (isRoot) {
            parent = parentEntityId;
        } else {
            parent = pe.parent !== null ? idMapping.get(pe.parent) ?? null : null;
        }

        const children = pe.children
            .map(cid => idMapping.get(cid))
            .filter((id): id is number => id !== undefined);

        const prefabInstance: PrefabInstanceData = {
            prefabPath,
            prefabEntityId: pe.prefabEntityId,
            isRoot,
            instanceId,
            overrides: isRoot ? [...overrides] : [],
        };

        const entity: EntityData = {
            id: sceneId,
            name: pe.name,
            parent,
            children,
            components: deepCloneComponents(pe.components),
            visible: pe.visible,
            prefab: prefabInstance,
        };

        applyOverrides(entity, overrides);
        createdEntities.push(entity);
    }

    return {
        rootEntityId: idMapping.get(prefab.rootEntityId)!,
        createdEntities,
    };
}

// =============================================================================
// Recursive Instantiation (Phase 5)
// =============================================================================

export async function instantiatePrefabRecursive(
    prefabPath: string,
    scene: SceneData,
    parentEntityId: number | null,
    nextEntityIdStart: number,
    overrides: PrefabOverride[] = []
): Promise<InstantiateResult | null> {
    const prefab = await loadPrefabFromPath(prefabPath);
    if (!prefab) return null;

    const idMapping = new Map<number, number>();
    let nextId = nextEntityIdStart;

    for (const pe of prefab.entities) {
        if (!pe.nestedPrefab) {
            idMapping.set(pe.prefabEntityId, nextId++);
        }
    }

    const instanceId = generateInstanceId();
    const allCreated: EntityData[] = [];

    for (const pe of prefab.entities) {
        const isRoot = pe.prefabEntityId === prefab.rootEntityId;

        if (pe.nestedPrefab) {
            const nestedParentPrefabId = pe.parent;
            const nestedParentSceneId = nestedParentPrefabId !== null
                ? idMapping.get(nestedParentPrefabId) ?? null
                : (isRoot ? parentEntityId : null);

            const nestedResult = await instantiatePrefabRecursive(
                pe.nestedPrefab.prefabPath,
                scene,
                nestedParentSceneId,
                nextId,
                pe.nestedPrefab.overrides
            );

            if (nestedResult) {
                idMapping.set(pe.prefabEntityId, nestedResult.rootEntityId);
                nextId = computeNextIdAfter(nestedResult.createdEntities, nextId);
                allCreated.push(...nestedResult.createdEntities);
            }
            continue;
        }

        const sceneId = idMapping.get(pe.prefabEntityId)!;

        let parent: number | null;
        if (isRoot) {
            parent = parentEntityId;
        } else {
            parent = pe.parent !== null ? idMapping.get(pe.parent) ?? null : null;
        }

        const children = pe.children
            .map(cid => idMapping.get(cid))
            .filter((id): id is number => id !== undefined);

        const prefabInstance: PrefabInstanceData = {
            prefabPath,
            prefabEntityId: pe.prefabEntityId,
            isRoot,
            instanceId,
            overrides: isRoot ? [...overrides] : [],
        };

        const entity: EntityData = {
            id: sceneId,
            name: pe.name,
            parent,
            children,
            components: deepCloneComponents(pe.components),
            visible: pe.visible,
            prefab: prefabInstance,
        };

        applyOverrides(entity, overrides);
        allCreated.push(entity);
    }

    const rootSceneId = idMapping.get(prefab.rootEntityId);
    if (rootSceneId === undefined) return null;

    return {
        rootEntityId: rootSceneId,
        createdEntities: allCreated,
    };
}

// =============================================================================
// Override Application
// =============================================================================

function applyOverrides(entity: EntityData, overrides: PrefabOverride[]): void {
    const prefabEntityId = entity.prefab?.prefabEntityId;
    if (prefabEntityId === undefined) return;

    for (const override of overrides) {
        if (override.prefabEntityId !== prefabEntityId) continue;

        switch (override.type) {
            case 'property':
                if (override.componentType && override.propertyName !== undefined) {
                    const comp = entity.components.find(c => c.type === override.componentType);
                    if (comp) {
                        comp.data[override.propertyName] = override.value;
                    }
                }
                break;
            case 'name':
                if (typeof override.value === 'string') {
                    entity.name = override.value;
                }
                break;
            case 'visibility':
                if (typeof override.value === 'boolean') {
                    entity.visible = override.value;
                }
                break;
            case 'component_added':
                if (override.componentData) {
                    const exists = entity.components.some(c => c.type === override.componentData!.type);
                    if (!exists) {
                        entity.components.push({
                            type: override.componentData.type,
                            data: JSON.parse(JSON.stringify(override.componentData.data)),
                        });
                    }
                }
                break;
            case 'component_removed':
                if (override.componentType) {
                    entity.components = entity.components.filter(c => c.type !== override.componentType);
                }
                break;
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

function deepCloneComponents(components: ComponentData[]): ComponentData[] {
    return components.map(c => ({
        type: c.type,
        data: JSON.parse(JSON.stringify(c.data)),
    }));
}

function computeNextIdAfter(entities: EntityData[], currentNext: number): number {
    let max = currentNext;
    for (const e of entities) {
        if (e.id >= max) {
            max = e.id + 1;
        }
    }
    return max;
}
