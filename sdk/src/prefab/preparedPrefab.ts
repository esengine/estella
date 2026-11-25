// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    preparedPrefab.ts
 * @brief   A prefab that can be spawned in one frame, because everything it
 *          names is already in hand.
 *
 * `instantiatePrefab` is async, and every bit of that is asset loading: nested
 * prefabs, then the textures and materials the flattened entities reference. A
 * caller that wants an entity NOW — a script graph's spawn node, a bullet in a
 * system's body — cannot wait for a microtask and still hand the id to the next
 * thing it does.
 *
 * So the wait is moved: `preparePrefab` does the loading once, at the moment the
 * thing that will spawn it is itself being loaded, and keeps the flattened scene
 * with its asset handles already written in. {@link spawnPrepared} is then a
 * clone and a spawn, synchronous by construction.
 *
 * It reuses the scene path rather than reimplementing it — `flattenPrefab`,
 * `preloadSceneAssets`, `resolveSceneAssetPaths`, `loadSceneData` — so a prefab
 * spawned this way and the same prefab placed in a scene resolve identically.
 */

import type { World } from '../ecs/world';
import type { SceneContext } from '../scene/sceneManager';
import { SceneLoadAttempt } from '../scene/sceneLoadAttempt';
import type { Entity } from '../types';
import type { Assets } from '../asset/Assets';
import { loadSceneData, SCENE_FORMAT_VERSION, type SceneData } from '../scene/scene';
import { Transform } from '../ecs/component';
import { prepareSpawnOwnership, type PreparedSpawnOwnership } from './preparedAssetOwnership';
import { flattenPrefab, migratePrefabData, preloadNestedPrefabs, type FlattenContext, type PrefabData, type PrefabOverride } from './index';

/**
 * A prefab with its loading done: the flattened entities, their asset handles
 * already written in, and the acquisitions that keeps true.
 */
export interface PreparedPrefab {
    /** The ref it was prepared from — what a report names. */
    readonly ref: string;
    /** Flattened, resolved, and never handed out: each spawn clones it. */
    readonly scene: SceneData;
    /** Id of the root within {@link scene}. */
    readonly rootId: number;
    /** Assets referenced but not loaded — spawning still works, they draw as nothing. */
    readonly missing: readonly string[];
    /** Give back everything the preparation took. */
    release(): void;
    /** @internal Retain exact resource generations before creating a spawned copy. */
    retainSpawnAssets?(): PreparedSpawnOwnership;
    /** @internal Record references against this copy's runtime IDs after spawning. */
    trackSpawnReferences?(entities: ReadonlyMap<number, number>, world?: World): void;
}

/**
 * Load a prefab and everything it names, and flatten it once.
 *
 * The overrides are baked in here, not at spawn: a prepared prefab is one shape
 * repeated, and a caller that wants two shapes prepares two.
 */
export async function preparePrefab(
    assets: Assets,
    ref: string,
    overrides: readonly PrefabOverride[] = [],
): Promise<PreparedPrefab> {
    if (typeof assets.preparePrefab === 'function') return assets.preparePrefab(ref, overrides);
    return preparePrefabFromSource(assets, ref, overrides);
}

/** @internal The shared bake, with acquisition supplied by its owning era. */
export async function preparePrefabFromSource(
    assets: Pick<Assets, 'loadPrefab' | 'preloadSceneAssets' | 'resolveSceneAssetPaths'>
        & Partial<Pick<Assets, 'entityScopes' | 'resolveRef' | 'trackSceneAssetReferences'>>,
    ref: string,
    overrides: readonly PrefabOverride[] = [],
): Promise<PreparedPrefab> {
    const loaded = await assets.loadPrefab(ref);
    const normalized = migratePrefabData(loaded.data as PrefabData).data;

    // Nested prefabs first: flattening reads them synchronously, so they have to
    // be in the cache before it runs.
    const cache = new Map<string, PrefabData>();
    await preloadNestedPrefabs(normalized, async (path) =>
        migratePrefabData((await assets.loadPrefab(path)).data as PrefabData).data, cache);

    let nextId = 1;  // 0 is no entity: a reference field mapped to it names nothing.
    const ctx: FlattenContext = {
        allocateId: () => nextId++,
        loadPrefab: (path: string) => cache.get(path) ?? null,
        visited: new Set<string>(),
    };
    const { entities, rootId } = flattenPrefab(normalized, [...overrides], ctx);

    const scene: SceneData = {
        version: SCENE_FORMAT_VERSION,
        name: normalized.name,
        entities: entities.map((e) => ({
            id: e.id, name: e.name, parent: e.parent,
            children: e.children, components: e.components, visible: e.visible,
        })),
    };

    // The same preload the scene runs, on the same shape — so a prefab spawned
    // from here and one placed in a scene get the same handles for the same refs.
    const result = await assets.preloadSceneAssets(scene, undefined, { entityOwnership: !!assets.entityScopes });
    const retainSpawnAssets = prepareSpawnOwnership(scene, result, assets.entityScopes, assets.resolveRef?.bind(assets));
    assets.resolveSceneAssetPaths(scene, result);

    return {
        ref,
        scene,
        rootId,
        missing: result.missing.map((m) => m.ref),
        release: () => result.scope.releaseAll(),
        retainSpawnAssets,
        trackSpawnReferences: (entities, world) => assets.trackSceneAssetReferences?.(scene, entities, world),
    };
}

export interface SpawnPreparedOptions {
    /** @internal Reuse the generation and origin checks of the spawning service. */
    attempt?: SceneLoadAttempt;
    /** Scene that owns every entity in this instance. */
    scene?: Pick<SceneContext, 'adopt'> | null;
    /** A rejected parent attachment rolls back the spawned hierarchy. */
    parent?: Entity;
    /** Where the root lands. Absent leaves the prefab's own transform. */
    position?: { x: number; y: number; z?: number };
}

/**
 * Spawn a prepared prefab. Synchronous: everything it names is already loaded
 * and its handles are already in the data, so this is a clone and a spawn.
 */
export function spawnPrepared(
    world: World,
    prepared: PreparedPrefab,
    options?: SpawnPreparedOptions,
): { root: Entity; entities: Map<number, Entity> } {
    // `loadSceneData` migrates, and migration deep-clones — so the prepared
    // scene is never mutated and one preparation spawns any number of copies.
    const attempt = options?.attempt ?? new SceneLoadAttempt(world, prepared.scene.name);
    attempt.assertCurrent();
    const ownership = prepared.retainSpawnAssets?.();
    try {
        const entities = loadSceneData(world, prepared.scene);
        attempt.entities = entities;
        attempt.assertCurrent();
        ownership?.attach(world, entities);
        prepared.trackSpawnReferences?.(entities, world);
        const root = entities.get(prepared.rootId)!;
        if (options?.parent !== undefined && !world.trySetParent(root, options.parent)) {
            throw new Error(`Prepared prefab "${prepared.scene.name}" could not attach to parent ${options.parent}`);
        }
        if (options?.position) {
            // Transform is C++-backed, so the read is a copy: change it and hand it back.
            const transform = world.get(root, Transform);
            transform.position = { ...transform.position, ...options.position };
            world.set(root, Transform, transform);
        }
        attempt.adoptEntities(entities, options?.scene);
        return { root, entities };
    } catch (error) {
        attempt.discardEntities();
        throw error;
    } finally { ownership?.release(); }
}
