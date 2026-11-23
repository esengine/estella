// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Children, Parent } from './component';
import type { World } from './world';
import type { Entity } from '../types';

/** Read the current relationship even when the core changed it directly. */
export function parentEntity(world: World, entity: Entity): Entity | undefined {
    const core = world.getCppRegistry();
    if (core) return core.hasParent(entity) ? core.getParent(entity).entity as Entity : undefined;
    return world.tryGet(entity, Parent)?.entity;
}

/** Cut surviving subtrees free before a batch of recursive despawns begins. */
export function detachSurvivingDescendants(
    world: World, roots: Iterable<Entity>, survives: (child: Entity) => boolean,
    detach: (world: World, child: Entity) => void,
): void {
    const parents = new Set(roots);
    const core = world.getCppRegistry?.();
    for (const parent of parents) {
        if (!world.valid(parent) || !(core ? core.hasChildren(parent) : world.has(parent, Children))) continue;
        // get() snapshots the native child list. Detaching one sibling can mutate that list.
        for (const child of world.get(parent, Children).entities) {
            if (survives(child)) detach(world, child);
            else parents.add(child);
        }
    }
}
