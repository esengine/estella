// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { SceneOwner } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { SceneManagerState } from './sceneManager';

/**
 * Scene loading, as a resource. Registered by the scene plugin.
 * @beta
 */
export const SceneManager = defineResource<SceneManagerState>(null!, 'SceneManager');

function ownerName(world: World, entity: Entity) {
    return world.tryGet(entity, SceneOwner)?.scene;
}

/** A spawn follows its originating entity, or the active scene when the caller supplied no origin. */
export function sceneForSpawn(world: World, scenes: SceneManagerState | null, owner?: Entity) {
    if (!scenes) return null;
    const name = owner === undefined ? scenes.getActive() : ownerName(world, owner);
    return name ? scenes.getScene(name) : null;
}

export function sceneAssetScopeForEntity(app: App, entity: Entity) {
    const name = app.hasResource(SceneManager) && ownerName(app.world, entity);
    return name ? app.getResource(SceneManager).assetScopeFor(name) : null;
}
