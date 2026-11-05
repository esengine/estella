// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../ecs/world';
import type { AnyComponentDef } from '../ecs/component';
import type { Entity } from '../types';
import type { Assets } from './Assets';
import { AssetRefCounter } from './AssetRefCounter';
import { SCENE_FORMAT_VERSION, type SceneData } from '../scene/scene';
import { prepareSpawnOwnership } from '../prefab/preparedAssetOwnership';
import { log } from '../util/logger';
import { getResourceManager } from '../wasm/resourceManager';

const subscribed = new WeakSet<World>();

/**
 * Bind a World to the asset layer of its App — one call on every core (web,
 * packaged, native). Two things a world needs from it:
 *   * references are dropped when an entity goes;
 *   * an asset PATH written into an engine-backed component at run time
 *     (`cmds.spawn().insert(Sprite, { texture: 'assets/hero.png' })`) is loaded
 *     and replaced by its handle, through the same preload and resolve a scene
 *     file goes through, and held for as long as the entity is.
 * `current` is read at notification time, so a replaced Assets is the one used.
 */
export function bindAssetReferenceTracking(
    world: World, assets: Assets, current: () => Assets | null | undefined,
): void {
    if (!assets.getRefCounter()) assets.setRefCounter(new AssetRefCounter());
    if (subscribed.has(world)) return;
    subscribed.add(world);
    world.onDespawn(entity => current()?.getRefCounter()?.removeAllRefsForEntity(entity));
    world.setAssetFieldResolver((entity, component, authored) => {
        const live = current();
        // A core with no resource manager (a headless server, a test world) loads
        // nothing: asking it to turned every authored path into a failed load with
        // an Error behind it — 6000 a scene in the scale suite, where the JS heap
        // budget then failed and a worker ran out of memory.
        if (live && getResourceManager()) void resolveAssetFields(world, live, entity, component, authored);
    });
}

/** The fields this component was given as paths, loaded, and written in as handles once they are. */
async function resolveAssetFields(
    world: World, assets: Assets, entity: Entity, component: AnyComponentDef, authored: Record<string, unknown>,
): Promise<void> {
    // A one-entity scene: the loader that understands every asset field, atlas
    // frames included, is the scene's — a second one would be a second author.
    const data = { ...authored };
    const scene: SceneData = {
        version: SCENE_FORMAT_VERSION,
        name: `${component._name}@${entity}`,
        entities: [{ id: 0, name: '', parent: null, children: [], components: [{ type: component._name, data }], visible: true }],
    } as SceneData;
    try {
        const result = await assets.preloadSceneAssets(scene);
        const ownership = prepareSpawnOwnership(scene, result, assets.entityScopes, assets.resolveRef?.bind(assets));
        assets.resolveSceneAssetPaths(scene, result);
        try {
            if (!world.valid(entity) || !world.has(entity, component)) return;
            for (const missing of result.missing) {
                log.warn('asset', `${component._name} on entity ${entity}: could not load "${missing.ref}"`);
            }
            // Only the fields that were paths, plus what resolving them derived
            // (an atlas frame's uv window); and only while each still holds the
            // placeholder, so a write made during the load wins.
            const now = world.get(entity, component) as Record<string, unknown>;
            const defaults = component._default as Record<string, unknown>;
            const patch: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
                const wasPath = typeof authored[key] === 'string';
                if (wasPath) {
                    if (now[key] === (defaults[key] ?? 0)) patch[key] = value;
                } else if (value !== authored[key]) {
                    patch[key] = value;
                }
            }
            if (Object.keys(patch).length === 0) return;
            world.set(entity, component, { ...now, ...patch } as never);
            ownership?.().attach(world, new Map([[0, entity]]));
        } finally {
            result.scope.releaseAll();
        }
    } catch (err) {
        log.warn('asset', `${component._name} on entity ${entity}: loading its asset paths failed`, err);
    }
}
