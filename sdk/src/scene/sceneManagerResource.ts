// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { SceneOwner } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';
import type { SceneManagerState } from './sceneManager';

/**
 * Scene loading, as a resource. Registered by the scene plugin.
 * @beta
 */
export const SceneManager = defineResource<SceneManagerState>(null!, 'SceneManager');

function ownerName(app: App, entity: Entity) {
    return app.hasResource(SceneManager) && app.world.tryGet(entity, SceneOwner)?.scene;
}

/** The scene that currently owns this entity, including when it has just been adopted. */
export function sceneContextForEntity(app: App, entity: Entity) {
    const name = ownerName(app, entity);
    return name ? app.getResource(SceneManager).getScene(name) : null;
}

export function sceneAssetScopeForEntity(app: App, entity: Entity) {
    const name = ownerName(app, entity);
    return name ? app.getResource(SceneManager).assetScopeFor(name) : null;
}
