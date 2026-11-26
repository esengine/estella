// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { World } from './world';

/** Snapshot membership requires the SDK handle and the current core generation. */
export function isLiveEntity(world: World, entity: Entity): boolean {
    return world.valid(entity) && (world.getCppRegistry()?.valid?.(entity) ?? true);
}

/** SDK storage order with handles destroyed by the native registry removed. */
export function liveEntities(world: World): Entity[] {
    const entities = world.getAllEntities();
    const registry = world.getCppRegistry();
    if (!registry?.valid) return entities;
    let count = 0;
    for (const entity of entities) {
        if (registry.valid(entity)) entities[count++] = entity;
    }
    entities.length = count;
    return entities;
}
