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
    _scene: SceneData,
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
    _scene: SceneData,
    parentEntityId: number | null,
    nextEntityIdStart: number,
    overrides: PrefabOverride[] = [],
    visitedPaths?: Set<string>
): Promise<InstantiateResult | null> {
    const visited = visitedPaths ?? new Set<string>();
    if (visited.has(prefabPath)) {
        console.warn(`Circular prefab dependency detected: ${prefabPath}`);
        return null;
    }
    visited.add(prefabPath);

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
                _scene,
                nestedParentSceneId,
                nextId,
                pe.nestedPrefab.overrides,
                visited
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
// Prefab Instance Sync
// =============================================================================

export async function syncPrefabInstances(scene: SceneData, prefabPath: string): Promise<boolean> {
    let changed = false;

    const prefab = await loadPrefabFromPath(prefabPath);
    if (!prefab) return false;

    const instanceGroups = new Map<string, EntityData[]>();
    for (const entity of scene.entities) {
        if (!entity.prefab || entity.prefab.prefabPath !== prefabPath) continue;
        const group = instanceGroups.get(entity.prefab.instanceId) ?? [];
        group.push(entity);
        instanceGroups.set(entity.prefab.instanceId, group);
    }

    for (const [instanceId, instanceEntities] of instanceGroups) {
        const root = instanceEntities.find(e => e.prefab?.isRoot);
        if (!root) continue;

        const existingByPrefabId = new Map<number, EntityData>();
        for (const e of instanceEntities) {
            existingByPrefabId.set(e.prefab!.prefabEntityId, e);
        }

        const prefabEntityIds = new Set(prefab.entities.map(pe => pe.prefabEntityId));
        const newPrefabEntities = prefab.entities.filter(
            pe => !existingByPrefabId.has(pe.prefabEntityId)
        );
        const removedEntities = instanceEntities.filter(
            e => !prefabEntityIds.has(e.prefab!.prefabEntityId)
        );

        if (newPrefabEntities.length === 0 && removedEntities.length === 0) continue;
        changed = true;

        let nextId = computeNextEntityId(scene);
        const newIdMapping = new Map<number, number>();
        for (const pe of newPrefabEntities) {
            newIdMapping.set(pe.prefabEntityId, nextId++);
        }

        for (const pe of newPrefabEntities) {
            const sceneId = newIdMapping.get(pe.prefabEntityId)!;

            let parent: number | null;
            if (pe.parent !== null) {
                parent = existingByPrefabId.get(pe.parent)?.id
                    ?? newIdMapping.get(pe.parent) ?? null;
            } else {
                parent = null;
            }

            const children = pe.children
                .map(cid => existingByPrefabId.get(cid)?.id ?? newIdMapping.get(cid))
                .filter((id): id is number => id !== undefined);

            const entity: EntityData = {
                id: sceneId,
                name: pe.name,
                parent,
                children,
                components: deepCloneComponents(pe.components),
                visible: pe.visible,
                prefab: {
                    prefabPath,
                    prefabEntityId: pe.prefabEntityId,
                    isRoot: false,
                    instanceId,
                    overrides: [],
                },
            };

            applyOverrides(entity, root.prefab!.overrides);
            scene.entities.push(entity);
            existingByPrefabId.set(pe.prefabEntityId, entity);
        }

        for (const pe of prefab.entities) {
            const existing = existingByPrefabId.get(pe.prefabEntityId);
            if (!existing) continue;

            const expectedChildren = pe.children
                .map(cid => existingByPrefabId.get(cid)?.id ?? newIdMapping.get(cid))
                .filter((id): id is number => id !== undefined);

            for (const childId of expectedChildren) {
                if (!existing.children.includes(childId)) {
                    existing.children.push(childId);
                }
            }
        }

        for (const removed of removedEntities) {
            const idx = scene.entities.indexOf(removed);
            if (idx !== -1) scene.entities.splice(idx, 1);

            if (removed.parent !== null) {
                const parent = scene.entities.find(e => e.id === removed.parent);
                if (parent) {
                    parent.children = parent.children.filter(c => c !== removed.id);
                }
            }
        }
    }
    return changed;
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
