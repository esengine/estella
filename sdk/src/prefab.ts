import type { World } from './world';
import type { Entity } from './types';
import type { AssetServer } from './asset/AssetServer';
import { loadSceneWithAssets, type SceneData } from './scene';

// =============================================================================
// Types
// =============================================================================

export interface PrefabData {
    version: string;
    name: string;
    rootEntityId: number;
    entities: PrefabEntityData[];
}

export interface PrefabEntityData {
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: { type: string; data: Record<string, unknown> }[];
    visible: boolean;
    nestedPrefab?: { prefabPath: string; overrides: PrefabOverride[] };
}

export interface PrefabOverride {
    prefabEntityId: number;
    type: 'property' | 'component_added' | 'component_removed' | 'name' | 'visibility';
    componentType?: string;
    propertyName?: string;
    value?: unknown;
    componentData?: { type: string; data: Record<string, unknown> };
}

export interface InstantiatePrefabOptions {
    assetServer?: AssetServer;
    assetBaseUrl?: string;
    parent?: Entity;
    overrides?: PrefabOverride[];
}

export interface InstantiatePrefabResult {
    root: Entity;
    entities: Map<number, Entity>;
}

// =============================================================================
// Internal Types
// =============================================================================

interface ProcessedEntity {
    id: number;
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: { type: string; data: Record<string, unknown> }[];
    visible: boolean;
}

interface FlattenResult {
    entities: ProcessedEntity[];
    rootId: number;
    nextId: number;
}

// =============================================================================
// Instantiation
// =============================================================================

export async function instantiatePrefab(
    world: World,
    prefab: PrefabData,
    options?: InstantiatePrefabOptions,
): Promise<InstantiatePrefabResult> {
    const { entities: processed, rootId } = await flattenPrefab(
        prefab,
        options?.overrides ?? [],
        options,
        undefined,
        new Set(),
    );

    const sceneData: SceneData = {
        version: prefab.version,
        name: prefab.name,
        entities: processed.map(e => ({
            id: e.id,
            name: e.name,
            parent: e.parent,
            children: e.children,
            components: e.components,
            visible: e.visible,
        })),
    };

    const entityMap = await loadSceneWithAssets(world, sceneData, {
        assetServer: options?.assetServer,
        assetBaseUrl: options?.assetBaseUrl,
    });

    const root = entityMap.get(rootId)!;
    if (options?.parent !== undefined) {
        world.setParent(root, options.parent);
    }

    return { root, entities: entityMap };
}

// =============================================================================
// Flatten Nested Prefabs
// =============================================================================

async function flattenPrefab(
    prefab: PrefabData,
    overrides: PrefabOverride[],
    options: InstantiatePrefabOptions | undefined,
    startId?: number,
    visited?: Set<string>,
): Promise<FlattenResult> {
    const idMapping = new Map<number, number>();
    let nextId: number;

    if (startId === undefined) {
        nextId = 0;
        for (const pe of prefab.entities) {
            if (!pe.nestedPrefab) {
                idMapping.set(pe.prefabEntityId, pe.prefabEntityId);
                nextId = Math.max(nextId, pe.prefabEntityId + 1);
            }
        }
    } else {
        nextId = startId;
        for (const pe of prefab.entities) {
            if (!pe.nestedPrefab) {
                idMapping.set(pe.prefabEntityId, nextId++);
            }
        }
    }

    const result: ProcessedEntity[] = [];

    for (const pe of prefab.entities) {
        if (pe.nestedPrefab) {
            if (!options?.assetServer) {
                throw new Error(
                    `AssetServer required to load nested prefab: ${pe.nestedPrefab.prefabPath}`,
                );
            }

            if (visited?.has(pe.nestedPrefab.prefabPath)) {
                console.error(`[Prefab] Cycle detected: ${pe.nestedPrefab.prefabPath}`);
                continue;
            }

            visited?.add(pe.nestedPrefab.prefabPath);
            const nestedPrefab = await options.assetServer.loadPrefab(
                pe.nestedPrefab.prefabPath,
                options.assetBaseUrl,
            );

            const nested = await flattenPrefab(
                nestedPrefab,
                pe.nestedPrefab.overrides,
                options,
                nextId,
                visited,
            );

            idMapping.set(pe.prefabEntityId, nested.rootId);
            nextId = nested.nextId;

            const nestedRoot = nested.entities.find(e => e.id === nested.rootId);
            if (nestedRoot) {
                nestedRoot.parent = pe.parent !== null
                    ? idMapping.get(pe.parent) ?? null
                    : null;
            }

            result.push(...nested.entities);
            continue;
        }

        const id = idMapping.get(pe.prefabEntityId)!;
        const isRoot = pe.prefabEntityId === prefab.rootEntityId;

        const entity: ProcessedEntity = {
            id,
            prefabEntityId: pe.prefabEntityId,
            name: pe.name,
            parent: isRoot
                ? null
                : (pe.parent !== null ? idMapping.get(pe.parent) ?? null : null),
            children: pe.children
                .map(c => idMapping.get(c))
                .filter((c): c is number => c !== undefined),
            components: JSON.parse(JSON.stringify(pe.components)),
            visible: pe.visible,
        };

        applyOverridesToEntity(entity, overrides);
        result.push(entity);
    }

    const rootId = idMapping.get(prefab.rootEntityId);
    if (rootId === undefined) {
        throw new Error('Failed to resolve prefab root entity');
    }

    return { entities: result, rootId, nextId };
}

// =============================================================================
// Override Application
// =============================================================================

function applyOverridesToEntity(entity: ProcessedEntity, overrides: PrefabOverride[]): void {
    for (const override of overrides) {
        if (override.prefabEntityId !== entity.prefabEntityId) continue;

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
                    const exists = entity.components.some(
                        c => c.type === override.componentData!.type,
                    );
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
                    entity.components = entity.components.filter(
                        c => c.type !== override.componentType,
                    );
                }
                break;
        }
    }
}
