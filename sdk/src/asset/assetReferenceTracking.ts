// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../ecs/world';
import type { AnyComponentDef, AssetFieldMeta } from '../ecs/component';
import type { Entity } from '../types';
import type { Assets, SceneAssetResult } from './Assets';
import { AssetRefCounter } from './AssetRefCounter';
import { SCENE_FORMAT_VERSION, type SceneData } from '../scene/scene';
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
    world.setAssetFieldResolver((entity, component, authored, currentFields) => {
        const live = current();
        // A core with no resource manager (a headless server, a test world) loads
        // nothing: asking it to turned every authored path into a failed load with
        // an Error behind it — 6000 a scene in the scale suite, where the JS heap
        // budget then failed and a worker ran out of memory.
        if (!live || !getResourceManager()) return;
        return resolveAssetFields(world, live, entity, component, authored, currentFields, current);
    });
}

/** Resolve a single live component through the same loaders, aliases and atlas conversion as a scene. */
async function resolveAssetFields(
    world: World, assets: Assets, entity: Entity, component: AnyComponentDef, authored: Record<string, unknown>,
    currentFields: ReadonlySet<string>, current: () => Assets | null | undefined,
): Promise<void> {
    const row = { type: component._name, data: { ...authored } };
    const scene: SceneData = {
        version: SCENE_FORMAT_VERSION, name: `${component._name}@${entity}`,
        entities: [{ id: 0, name: '', parent: null, children: [], components: [row], visible: true }],
    };
    const present = () => current() === assets && world.valid(entity) && !world.isDestructionPending(entity)
        && world.has(entity, component);
    try {
        if (!present()) return;
        const defaults = component._default as Record<string, unknown>;
        const requests = component.assetFields.flatMap(({ field, type }) => {
            const ref = authored[field];
            if (!currentFields.has(field)) {
                // An insertion observer can supersede just one path before the batch starts.
                if (typeof ref === 'string') row.data[field] = defaults[field] ?? 0;
                return [];
            }
            return typeof ref === 'string' && ref ? [{ field, type, path: assets.resolveRef(ref) }] : [];
        });
        const result = await assets.preloadSceneAssets(scene);
        try {
            if (!currentFields.size || !present()) return;
            for (const missing of result.missing) {
                log.warn('asset', `${component._name} on entity ${entity}: could not load "${missing.ref}"`);
            }
            let candidates = requests;
            while (candidates.length && present()) {
                const now = world.get(entity, component) as Record<string, unknown>;
                const live = candidates.filter(({ field }) => currentFields.has(field) && now[field] === (defaults[field] ?? 0));
                if (!live.length) return;
                // The same conversion as scene loading composes a winning atlas frame with the current UVs.
                const data = { ...now };
                for (const { field } of live) data[field] = authored[field];
                row.data = data;
                assets.resolveSceneAssetPaths(scene, result);
                const bound = live.filter(({ field }) => currentFields.has(field) && typeof data[field] === 'number' && data[field] !== 0);
                if (bound.length !== live.length) {
                    // Drop failed or reentrantly superseded paths and their derived UVs. Each retry removes a field.
                    candidates = bound;
                    continue;
                }
                if (!present()) return;
                try {
                    world.update(entity, component, draft => {
                        for (const [key, value] of Object.entries(data)) {
                            if (value !== now[key] && typeof value !== 'string') draft[key] = value;
                        }
                    });
                } finally {
                    // A write observer may already have removed the component or replaced a handle.
                    if (present()) {
                        const stored = world.get(entity, component) as Record<string, unknown>;
                        const accepted = bound.filter(({ field }) => stored[field] === data[field]);
                        if (accepted.length) retainPublished(assets, world, entity, result, requests, accepted, stored);
                    }
                }
                return;
            }
        } finally {
            result.scope.releaseAll();
        }
    } catch (err) {
        log.warn('asset', `${component._name} on entity ${entity}: loading its asset paths failed`, err);
    }
}

interface RequestedField extends AssetFieldMeta { path: string | null }

function retainPublished(
    assets: Assets, world: World, entity: Entity, result: SceneAssetResult,
    requests: RequestedField[], accepted: RequestedField[], stored: Record<string, unknown>,
): void {
    const owner = assets.entityScopes.ensure(world, entity);
    if (accepted.length === requests.length) {
        owner.absorb(result.scope);
        return;
    }
    const bound = new Set(accepted.map(({ type, field }) => assets.leaseForBinding(result.scope, type, stored[field])));
    for (const { type, path, lease } of result.acquisitions ?? []) {
        // Custom discovery can also declare dependencies outside the handle fields. Keep them with a published component.
        const auxiliary = !requests.some(request => request.type === type && request.path === path);
        if ((bound.has(lease) || auxiliary) && result.scope.forget(lease)) owner.add(lease);
    }
}
