import type { SceneData, EntityData } from '../types/SceneTypes';
import type { PrefabInstanceData } from '../types/PrefabTypes';
import {
    type PrefabData,
    type PrefabOverride,
    type ProcessedEntity,
    type FlattenContext,
    flattenPrefab,
    preloadNestedPrefabs,
} from 'esengine';
import { loadPrefabFromPath } from './PrefabSerializer';

export interface InstantiateResult {
    rootEntityId: number;
    createdEntities: EntityData[];
}

export function computeNextEntityId(scene: SceneData): number {
    return scene.entities.reduce((max, e) => Math.max(max, e.id), 0) + 1;
}

let instanceCounter = 0;

function generateInstanceId(): string {
    return `prefab_${Date.now()}_${++instanceCounter}`;
}

function processedToEntityData(
    processed: ProcessedEntity[],
    rootId: number,
    parentEntityId: number | null,
    prefabPath: string,
    instanceId: string,
    overrides: PrefabOverride[],
    basePrefab?: string,
): EntityData[] {
    return processed.map(e => {
        const instance: PrefabInstanceData = {
            prefabPath,
            prefabEntityId: e.prefabEntityId,
            isRoot: e.id === rootId,
            instanceId,
            overrides: overrides.filter(o => o.prefabEntityId === e.prefabEntityId),
        };
        if (basePrefab) {
            instance.basePrefab = basePrefab;
        }
        return {
            id: e.id,
            name: e.name,
            parent: e.id === rootId ? parentEntityId : e.parent,
            children: e.children,
            components: e.components,
            visible: e.visible,
            prefab: instance,
        };
    });
}

export function instantiatePrefab(
    prefab: PrefabData,
    prefabPath: string,
    scene: SceneData,
    parentEntityId: number | null,
    nextEntityIdStart: number,
    overrides: PrefabOverride[] = []
): InstantiateResult {
    let nextId = nextEntityIdStart;

    const ctx: FlattenContext = {
        allocateId: () => nextId++,
        loadPrefab: () => null,
        visited: new Set<string>(),
    };

    const { entities: processed, rootId } = flattenPrefab(prefab, overrides, ctx);

    const instanceId = generateInstanceId();
    const createdEntities = processedToEntityData(
        processed, rootId, parentEntityId, prefabPath, instanceId, overrides, prefab.basePrefab,
    );

    return { rootEntityId: rootId, createdEntities };
}

export async function instantiatePrefabRecursive(
    prefabPath: string,
    _scene: SceneData,
    parentEntityId: number | null,
    nextEntityIdStart: number,
    overrides: PrefabOverride[] = [],
): Promise<InstantiateResult | null> {
    const prefab = await loadPrefabFromPath(prefabPath);
    if (!prefab) return null;

    const prefabCache = new Map<string, PrefabData>();

    await preloadNestedPrefabs(
        prefab,
        async (path: string) => {
            const nested = await loadPrefabFromPath(path);
            if (!nested) throw new Error(`Failed to load nested prefab: ${path}`);
            return nested;
        },
        prefabCache,
    );

    let nextId = nextEntityIdStart;
    const ctx: FlattenContext = {
        allocateId: () => nextId++,
        loadPrefab: (p: string) => prefabCache.get(p) ?? null,
        visited: new Set<string>(),
    };

    const { entities: processed, rootId } = flattenPrefab(prefab, overrides, ctx);

    const instanceId = generateInstanceId();
    const createdEntities = processedToEntityData(
        processed, rootId, parentEntityId, prefabPath, instanceId, overrides, prefab.basePrefab,
    );

    return { rootEntityId: rootId, createdEntities };
}

function collectInstanceOverrides(instanceEntities: EntityData[]): PrefabOverride[] {
    const overrides: PrefabOverride[] = [];
    for (const e of instanceEntities) {
        if (e.prefab) {
            overrides.push(...e.prefab.overrides);
        }
    }
    return overrides;
}

export async function syncPrefabInstances(scene: SceneData, prefabPath: string): Promise<boolean> {
    const prefab = await loadPrefabFromPath(prefabPath);
    if (!prefab) return false;

    const instanceGroups = new Map<string, EntityData[]>();
    for (const entity of scene.entities) {
        if (!entity.prefab || entity.prefab.prefabPath !== prefabPath) continue;
        const group = instanceGroups.get(entity.prefab.instanceId) ?? [];
        group.push(entity);
        instanceGroups.set(entity.prefab.instanceId, group);
    }

    let changed = false;

    for (const [_instanceId, instanceEntities] of instanceGroups) {
        const root = instanceEntities.find(e => e.prefab?.isRoot);
        if (!root) continue;

        const rootParent = root.parent;
        const savedOverrides = collectInstanceOverrides(instanceEntities);

        for (const e of instanceEntities) {
            const idx = scene.entities.indexOf(e);
            if (idx !== -1) scene.entities.splice(idx, 1);
        }

        const nextId = computeNextEntityId(scene);
        const result = instantiatePrefab(
            prefab, prefabPath, scene, rootParent, nextId, savedOverrides,
        );

        scene.entities.push(...result.createdEntities);
        changed = true;
    }

    return changed;
}
