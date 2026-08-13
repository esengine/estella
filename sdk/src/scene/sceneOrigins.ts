// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sceneOrigins.ts — which authored entity a live entity was loaded from.
 *
 * A resource rather than a module table, because the answer belongs to one App:
 * an editor runs its own world beside the game's, and a module-scoped map is one
 * bundle chunk away from being two maps that never meet.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineResource } from '../ecs/resource';

/**
 * Per loaded entity, the id it carried in the scene document.
 *
 * Absent unless something asked for it: a running game never needs to know which
 * document row an entity came from, and the table would be the editor's cost
 * charged to every player.
 *
 * @experimental
 */
export const SceneOrigins = defineResource<Map<Entity, number>>(new Map(), 'SceneOrigins');

/**
 * Start recording origins on `app`. Call before the first scene loads — what is
 * already spawned was not recorded.
 *
 * @experimental
 */
export function enableSceneOrigins(app: App): void {
    if (!app.hasResource(SceneOrigins)) app.insertResource(SceneOrigins, new Map());
}

/** @experimental */
export function sceneOriginsEnabled(app: App): boolean {
    return app.hasResource(SceneOrigins);
}

/**
 * Record a scene load's document-id → entity map. No-op unless enabled.
 *
 * @experimental
 */
export function recordSceneOrigins(app: App, entityMap: ReadonlyMap<number, Entity>): void {
    if (!app.hasResource(SceneOrigins)) return;
    const table = app.getResource(SceneOrigins);
    // A scene reloaded on every death would otherwise grow one dead row per
    // entity per restart, forever.
    for (const entity of table.keys()) {
        if (!app.world.valid(entity)) table.delete(entity);
    }
    for (const [src, entity] of entityMap) table.set(entity, src);
}

/**
 * The document id `entity` was loaded from; undefined if the game spawned it (or
 * nothing is recording).
 *
 * @experimental
 */
export function sceneOriginOf(app: App, entity: Entity): number | undefined {
    return app.hasResource(SceneOrigins) ? app.getResource(SceneOrigins).get(entity) : undefined;
}
