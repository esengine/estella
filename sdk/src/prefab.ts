// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { DeferredRecord } from './prefab/deferred';
import { deferredExternalEntities, expandVirtualRequested, registerDeferredInstances } from './scene/deferredInstances';
import type { World } from './ecs/world';
import { INVALID_ENTITY, type Entity } from './types';
import { getComponent } from './ecs/component';
import { mapComponentRefs } from './prefab/entityRef';
import { preparePrefabBindings } from './prefab/flatten';
import type { ComponentData } from './prefab/types';
import type { Assets } from './asset/Assets';
import { loadOwnedSceneWithAssets, SCENE_FORMAT_VERSION, type SceneData } from './scene/scene';
import { SceneLoadAttempt } from './scene/sceneLoadAttempt';
import {
    preloadNestedPrefabs,
    migratePrefabData,
    type PrefabData,
    type PrefabOverride,
    type FlattenContext,
} from './prefab/index';

export type {
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
    NestedPrefabRef,
    ProcessedEntity,
    MigrationResult,
    DiffOptions,
    ValidateResult,
    StaleOverride,
} from './prefab/index';
export {
    migratePrefabData,
    diffAgainstSource,
    validateOverrides,
    PREFAB_FORMAT_VERSION,
    cloneComponentData,
    cloneMetadata,
    bucketOverridesByEntity,
} from './prefab/index';

export interface InstantiatePrefabOptions {
    /** @internal One guarded publication from the prefab request through scene adoption. */
    attempt?: SceneLoadAttempt;
    assets?: Assets;
    assetBaseUrl?: string;
    /** The parent must still accept the root after loading; failure rolls back the instance. */
    parent?: Entity;
    overrides?: PrefabOverride[];
    /**
     * Make the virtual instances nested in this prefab whole as well (see prefab/deferred.ts). By default they are made as roots
     * and left to be opened.
     */
    expandDeferred?: boolean;
}

/**
 * What instantiating a prefab answers: the root, and every entity the prefab
 * brought with it.
 *
 * @beta
 */
export interface InstantiatePrefabResult {
    root: Entity;
    entities: Map<number, Entity>;
}

export async function instantiatePrefab(
    world: World,
    prefab: PrefabData,
    options?: InstantiatePrefabOptions,
): Promise<InstantiatePrefabResult> {
    return instantiatePrefabWithBindings(world, prefab, options);
}

/** @internal A mounted page keeps its scene root and the external bindings captured by its owning scene. */
export async function instantiatePrefabWithBindings(world: World, prefab: PrefabData, options?: InstantiatePrefabOptions,
    mount?: Entity, record?: DeferredRecord): Promise<InstantiatePrefabResult> {
    const attempt = options?.attempt ?? new SceneLoadAttempt(world, prefab.name);
    attempt.assertCurrent();
    // Accept both current and legacy formats — callers that hand us raw JSON
    // from disk no longer have to migrate it themselves.
    const migratedTop = migratePrefabData(prefab);
    const normalized = migratedTop.data;

    const prefabCache = new Map<string, PrefabData>();

    if (options?.assets) {
        const assets = options.assets;
        await preloadNestedPrefabs(
            normalized,
            async (path) => {
                const lease = await assets.acquireTyped<{ data: PrefabData }>('prefab', path);
                try {
                    return migratePrefabData(lease.value.data).data;
                } finally { lease.release(); }
            },
            prefabCache,
        );
    }

    let nextId = 1;  // 0 is no entity: a reference field mapped to it names nothing.
    const deferred: DeferredRecord[] = [];
    const external = new Map<number, Entity>();
    if (record) {
        for (const [id, entity] of deferredExternalEntities(record) ?? []) {
            external.set(id, world.valid(entity) ? entity : INVALID_ENTITY);
        }
    }
    const allocateId = () => {
        while (external.has(nextId)) nextId++;
        return nextId++;
    };

    const ctx: FlattenContext = {
        allocateId,
        loadPrefab: (path: string) => prefabCache.get(path) ?? null,
        visited: new Set<string>(),
        ...((options?.expandDeferred ?? expandVirtualRequested()) ? {} : { deferred }),
    };

    const plan = preparePrefabBindings(normalized, options?.overrides ?? [], ctx, record ? new Map() : undefined);
    const { entities: processed, rootId } = plan;
    plan.applyEdits(processed);
    if (mount !== undefined) {
        if (!world.valid(mount)) throw new Error(`Prefab "${normalized.name}" has no live page mount`);
        const referenceRoot = allocateId();
        external.set(referenceRoot, mount);
        for (const entity of processed) for (const component of entity.components) {
            mapComponentRefs(component, ref => ref === rootId ? referenceRoot : ref);
        }
    }

    const sceneData: SceneData = {
        // The produced value is a SCENE, so it carries the scene format version —
        // not the prefab's format version (which `normalized` just migrated).
        version: SCENE_FORMAT_VERSION,
        name: normalized.name,
        entities: processed.map(e => ({
            id: e.id,
            name: e.name,
            parent: e.parent,
            children: e.children,
            components: e.components,
            visible: e.visible,
        })),
    };

    try {
        const entities = await loadOwnedSceneWithAssets(world, sceneData, {
            assets: options?.assets, assetBaseUrl: options?.assetBaseUrl,
            ...(external.size ? { externalEntities: external } : {}),
        }, attempt);
        attempt.entities = entities;
        attempt.assertCurrent();
        const root = entities.get(rootId)!;
        if (options?.parent !== undefined && !world.trySetParent(root, options.parent)) {
            throw new Error(`Prefab "${normalized.name}" could not attach to parent ${options.parent}`);
        }
        if (mount !== undefined && !world.valid(mount)) throw new Error(`Prefab "${normalized.name}" lost its page mount`);
        const registered = mount !== undefined && deferred.length ? new Map(entities).set(rootId, mount) : entities;
        registerDeferredInstances(world, deferred, registered, external);
        if (record && mount !== undefined) {
            const members = new Set(entities.values());
            members.add(mount);
            restoreMountRefs(world, root, mount, processed.find(e => e.id === rootId)!.components, members);
        }
        attempt.assertCurrent();
        return { root, entities };
    } catch (error) {
        attempt.discardEntities();
        throw error;
    }
}

/** The virtual root originally had no descendants. Restore its links into the built page. */
function restoreMountRefs(world: World, root: Entity, mount: Entity, components: readonly ComponentData[], members: ReadonlySet<Entity>): void {
    for (const component of components) {
        const def = getComponent(component.type);
        if (!def?.entityFields.length || !world.has(root, def) || !world.has(mount, def)) continue;
        const data = world.get(root, def) as Record<string, unknown>;
        const fields = def.entityFields.filter(field => {
            const value = data[field];
            return Array.isArray(value) ? value.some(ref => members.has(ref)) : members.has(value as Entity);
        });
        if (fields.length) world.update(mount, def, (draft: Record<string, unknown>) => {
            for (const field of fields) {
                const value = data[field];
                draft[field] = Array.isArray(value) ? [...value] : value;
            }
        });
    }
}
