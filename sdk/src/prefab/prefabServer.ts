// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { Assets as AssetsClass } from '../asset/Assets';
import { Assets } from '../asset/AssetPlugin';
import { SceneManager, type SceneManagerState } from '../scene/sceneManager';
import { sceneForSpawn } from '../scene/sceneManagerResource';
import { SceneLoadAttempt } from '../scene/sceneLoadAttempt';
import { defineResource } from '../ecs/resource';
import {
    instantiatePrefab,
    type PrefabData,
    type PrefabOverride,
    type InstantiatePrefabResult,
} from '../prefab';
import { spawnPrepared } from './preparedPrefab';

/**
 * An override as written at a SPAWN: the entity id may be left out, and then it
 * is the prefab's root — which is the entity a one-sprite prefab has.
 *
 * @beta
 */
export type SpawnOverride = Omit<PrefabOverride, 'prefabEntityId'> & { prefabEntityId?: string };

/**
 * A prefab {@link PrefabServer.prepare} has loaded: held until released, and
 * spawned synchronously while it is.
 *
 * @beta
 */
export interface PreparedSpawnable {
    /** Lets go of what the preparation loaded; a spawn after this throws. */
    release(): void;
    /** Spawns under `parent`, in the current scene of `owner` or the active scene if omitted. `scene: false` opts out. */
    spawn(options?: { parent?: Entity; scene?: boolean; owner?: Entity }): { root: Entity; entities: Map<number, Entity> };
}

/**
 * Prefab instantiation, as `Res(Prefabs)` hands it over.
 *
 * `@beta`: `instantiate` is the whole surface and it has not moved, but its result
 * and override shapes are spelled in the prefab document model, which is also the
 * on-disk format — so their names are settled ahead of the shapes.
 *
 * @beta
 */
export class PrefabServer {
    private readonly world_: World;
    private readonly getAssets_: () => AssetsClass;
    private readonly getScenes_: () => SceneManagerState | null;

    // Resolved per call, not captured: the play/cooked runtime replaces the
    // Assets resource after plugin build (ensureRuntimeAssets), and a captured
    // instance would silently bypass its resolveRef/manifest channel.
    constructor(
        world: World,
        getAssets: () => AssetsClass,
        getScenes: () => SceneManagerState | null = () => null,
    ) {
        this.world_ = world;
        this.getAssets_ = getAssets;
        this.getScenes_ = getScenes;
    }

    /** Spawn in the origin entity's scene at landing, or the active scene if no origin was supplied.
     *  Pass `scene: false` for an instance that should outlive the area it came from. */
    async instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: SpawnOverride[];
        scene?: boolean;
        /** Follow this entity's scene at landing. A destroyed owner cancels the spawn. */
        owner?: Entity;
    }): Promise<InstantiatePrefabResult> {
        const owner = options?.scene === false ? undefined : options?.owner;
        const attempt = this.spawnAttempt_(pathOrAddress, owner);
        attempt.assertCurrent();
        const assets = this.getAssets_();
        const lease = await assets.acquireTyped<{ data: PrefabData }>('prefab', pathOrAddress);
        try {
            const prefab = lease.value.data;
            attempt.assertCurrent();
            const result = await instantiatePrefab(this.world_, prefab, {
                assets,
                attempt,
                assetBaseUrl: options?.baseUrl,
                parent: options?.parent,
                overrides: resolveSpawnOverrides(prefab, pathOrAddress, options?.overrides),
            });
            const scene = options?.scene === false ? null : sceneForSpawn(this.world_, this.getScenes_(), owner);
            attempt.adoptEntities(result.entities, scene);
            return result;
        } catch (error) {
            attempt.discardEntities();
            throw error;
        } finally { lease.release(); }
    }

    /**
     * Load a prefab and everything its entities use (meshes, materials, textures) and hold it until released, so a
     * later instantiate's entities appear on the frame they are asked for, not when their files arrive. What it
     * answers spawns synchronously: the entities exist on the line that asked for them.
     */
    async prepare(pathOrAddress: string): Promise<PreparedSpawnable> {
        const prepared = await this.getAssets_().preparePrefab(pathOrAddress);
        let held = true;
        return {
            release: () => {
                if (held) {
                    held = false;
                    prepared.release();
                }
            },
            spawn: (options) => {
                if (!held) throw new Error(`prefab "${pathOrAddress}" was released before this spawn`);
                const owner = options?.scene === false ? undefined : options?.owner;
                return spawnPrepared(this.world_, prepared, {
                    parent: options?.parent, attempt: this.spawnAttempt_(pathOrAddress, owner),
                    scene: options?.scene === false ? null : sceneForSpawn(this.world_, this.getScenes_(), owner),
                });
            },
        };
    }

    private spawnAttempt_(path: string, owner?: Entity) {
        if (owner === undefined) return new SceneLoadAttempt(this.world_, path);
        return new SceneLoadAttempt(this.world_, path, { check: () => {
            if (!this.world_.valid(owner) || this.world_.isDestructionPending(owner)) {
                throw new Error(`Cannot spawn a prefab for destroyed owner ${owner}`);
            }
        } });
    }
}

/**
 * Aim each override at an entity this prefab actually has — and say so when one
 * does not.
 *
 * `prefabEntityId` is a STABLE ADDRESS inside the prefab, and an override
 * carrying one nobody answers to is dropped without a word: the bullet spawns,
 * at the position the prefab was authored with, and the only symptom is that
 * every one of them appears in the same place. Two things make that easy to
 * write. `'0'` is the id every prefab had before stable ids, so it is what every
 * older example still shows — and a prefab saved since gets a uuid instead. And
 * the common case, spawning one sprite, has exactly one entity to aim at, so
 * naming it at all is ceremony: an omitted id means the root.
 *
 * The editor's own instance path deliberately does NOT do this — an override
 * left over from a since-deleted child is a normal thing to carry there. This is
 * the RUNTIME spawn door, where the override was written moments ago by someone
 * who can still fix it.
 */
function resolveSpawnOverrides(
    prefab: PrefabData,
    path: string,
    overrides: SpawnOverride[] | undefined,
): PrefabOverride[] | undefined {
    if (!overrides?.length) return undefined;
    const known = new Set(prefab.entities.map((e) => e.prefabEntityId));
    return overrides.map((o): PrefabOverride => {
        if (!o.prefabEntityId) return { ...o, prefabEntityId: prefab.rootEntityId };
        if (!known.has(o.prefabEntityId)) {
            throw new Error(
                `prefab "${path}" has no entity "${o.prefabEntityId}" for this override `
                + `(${o.type}${o.componentType ? ` ${o.componentType}.${o.propertyName}` : ''}). `
                + `Its root is "${prefab.rootEntityId}" — or leave prefabEntityId out and the root is used. `
                + `Entities: ${[...known].join(', ')}`,
            );
        }
        return o as PrefabOverride;
    });
}

/**
 * Prefab instantiation, as a resource. Spawning from a prefab is asynchronous
 * because its assets may not be loaded yet.
 *
 * @beta
 */
export const Prefabs = defineResource<PrefabServer>(null!, 'Prefabs');

export class PrefabsPlugin implements Plugin {
    name = 'prefabs';
    dependencies = [Assets];

    build(app: App): void {
        app.insertResource(Prefabs, new PrefabServer(
            app.world,
            () => app.getResource(Assets),
            () => (app.hasResource(SceneManager) ? app.getResource(SceneManager) : null),
        ));
    }
}

export const prefabsPlugin = new PrefabsPlugin();
