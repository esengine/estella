// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { Assets as AssetsClass } from '../asset/Assets';
import { Assets } from '../asset/AssetPlugin';
import { SceneManager, type SceneManagerState } from '../scene/sceneManager';
import { defineResource } from '../ecs/resource';
import {
    instantiatePrefab,
    type PrefabData,
    type PrefabOverride,
    type InstantiatePrefabResult,
} from '../prefab';

/**
 * An override as written at a SPAWN: the entity id may be left out, and then it
 * is the prefab's root — which is the entity a one-sprite prefab has.
 *
 * @beta
 */
export type SpawnOverride = Omit<PrefabOverride, 'prefabEntityId'> & { prefabEntityId?: string };

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

    /**
     * Spawn a prefab into the world. What it spawns belongs to the scene that
     * was live when it landed, exactly like an entity that scene authored —
     * ownerless, a bullet or a called minion leaks into the next room. Pass
     * `scene: false` for something meant to outlive the area it came from.
     */
    async instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: SpawnOverride[];
        scene?: boolean;
    }): Promise<InstantiatePrefabResult> {
        const assets = this.getAssets_();
        const prefabResult = await assets.loadPrefab(pathOrAddress);
        const prefab = prefabResult.data as PrefabData;
        const result = await instantiatePrefab(this.world_, prefab, {
            assets,
            assetBaseUrl: options?.baseUrl,
            parent: options?.parent,
            overrides: resolveSpawnOverrides(prefab, pathOrAddress, options?.overrides),
        });
        if (options?.scene !== false) this.adoptIntoActiveScene_(result);
        return result;
    }

    /**
     * The load is asynchronous, so the scene that asked may already be gone by
     * the time the entities exist — adopting into whatever is active now is the
     * only owner that is real, and a switch that already happened takes it.
     */
    private adoptIntoActiveScene_(result: InstantiatePrefabResult): void {
        const scenes = this.getScenes_();
        const active = scenes?.getActive();
        const ctx = active ? scenes?.getScene(active) : null;
        if (!ctx) return;
        for (const entity of result.entities.values()) ctx.adopt(entity);
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
