// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { Assets as AssetsClass } from '../asset/Assets';
import { Assets } from '../asset/AssetPlugin';
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
 */
export type SpawnOverride = Omit<PrefabOverride, 'prefabEntityId'> & { prefabEntityId?: string };

export class PrefabServer {
    private readonly world_: World;
    private readonly getAssets_: () => AssetsClass;

    // Resolved per call, not captured: the play/cooked runtime replaces the
    // Assets resource after plugin build (ensureRuntimeAssets), and a captured
    // instance would silently bypass its resolveRef/manifest channel.
    constructor(world: World, getAssets: () => AssetsClass) {
        this.world_ = world;
        this.getAssets_ = getAssets;
    }

    async instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: SpawnOverride[];
    }): Promise<InstantiatePrefabResult> {
        const assets = this.getAssets_();
        const prefabResult = await assets.loadPrefab(pathOrAddress);
        const prefab = prefabResult.data as PrefabData;
        return instantiatePrefab(this.world_, prefab, {
            assets,
            assetBaseUrl: options?.baseUrl,
            parent: options?.parent,
            overrides: resolveSpawnOverrides(prefab, pathOrAddress, options?.overrides),
        });
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

export const Prefabs = defineResource<PrefabServer>(null!, 'Prefabs');

export class PrefabsPlugin implements Plugin {
    name = 'prefabs';
    dependencies = [Assets];

    build(app: App): void {
        app.insertResource(Prefabs, new PrefabServer(app.world, () => app.getResource(Assets)));
    }
}

export const prefabsPlugin = new PrefabsPlugin();
