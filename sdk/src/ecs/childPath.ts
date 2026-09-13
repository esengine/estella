// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    childPath.ts
 * @brief   Address a descendant by its `"a/b/c"` path of names, and walk a subtree.
 *
 * A rig's joints ARE its entity hierarchy here, so this is how an animation clip
 * reaches the bone it animates and how a layer mask names the part of the body it
 * is allowed to write. It grew up under `timeline/` because clips asked first,
 * but nothing in it is a timeline — it speaks Children and Name — so it lives
 * where anything addressing a rig can reach it without importing that module.
 */
import type { World } from './world';
import type { Entity } from '../types';
import { getComponent } from './component';

/**
 * The descendant `childPath` names, relative to `rootEntity`; the root itself for
 * an empty path. Null when a segment names no child, which is what an authored
 * path pointing at a renamed bone comes to.
 */
export function resolveChildEntity(
    world: Pick<World, 'tryGet'>, rootEntity: Entity, childPath: string,
): Entity | null {
    if (!childPath) return rootEntity;

    const Children = getComponent('Children');
    const Name = getComponent('Name');
    if (!Children || !Name) return null;

    let current: Entity = rootEntity;
    for (const segment of childPath.split('/')) {
        const childrenData = world.tryGet(current, Children);
        if (!childrenData) return null;

        const childEntities: Entity[] = childrenData['entities'] || [];
        let found: Entity | null = null;
        for (const childId of childEntities) {
            const nameData = world.tryGet(childId, Name);
            if (nameData && nameData['value'] === segment) {
                found = childId;
                break;
            }
        }
        if (found === null) return null;
        current = found;
    }
    return current;
}

/** Add `root` and everything under it to `out`. */
export function collectSubtree(
    world: Pick<World, 'tryGet'>, root: Entity, out: Set<Entity>,
): void {
    if (out.has(root)) return;
    out.add(root);
    const Children = getComponent('Children');
    if (!Children) return;
    const children = world.tryGet(root, Children);
    if (!children) return;
    for (const child of (children['entities'] || []) as Entity[]) {
        collectSubtree(world, child, out);
    }
}
