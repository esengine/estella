// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    identity.ts
 * @brief   The authored id an entity came from, which is what survives a cell
 *          leaving and coming back.
 *
 * @details A runtime handle names an entity that EXISTS; a cell's unload ends
 *          every one of them and its reload mints new ones. So a handle is the
 *          wrong thing to write down about a place, and the authored id — the row
 *          the cook wrote into the cell document — is the right one.
 *
 *          Recorded through `SceneOrigins`, which a streamed world switches on:
 *          a game that never streams keeps paying nothing for the table.
 */

import type { App } from '../app/app';
import type { Entity } from '../types';
import { SceneManager } from '../scene/sceneManager';
import { sceneOriginOf } from '../scene/sceneOrigins';
import type { WorldManifest } from './cells';

/**
 * Authored id → live entity, for the persistent rows a cell is allowed to name.
 *
 * Only the rows the cook recorded: a table of the whole persistent world would
 * be a cost every frame of every game pays for the handful of references that
 * actually cross the boundary.
 */
export function persistentEntityRows(
    app: App, manifest: WorldManifest,
): ReadonlyMap<number, Entity> {
    const rows = new Map<number, Entity>();
    if (manifest.persistentRefs.length === 0 || !app.hasResource(SceneManager)) return rows;
    const wanted = new Set(manifest.persistentRefs);
    const persistent = app.getResource(SceneManager).getScene(manifest.scene);
    if (persistent === null) return rows;
    for (const entity of persistent.entities) {
        const authored = sceneOriginOf(app, entity);
        if (authored !== undefined && wanted.has(authored)) rows.set(authored, entity);
    }
    return rows;
}

/**
 * The authored id `entity` was loaded from — its identity across a cell's
 * lifetime, as opposed to the handle, which is only good while it exists.
 */
export function stableEntityId(app: App, entity: Entity): number | undefined {
    return sceneOriginOf(app, entity);
}
