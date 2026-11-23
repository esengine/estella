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
import { getComponent, type AnyComponentDef } from './component';

type ChildPathWorld = Pick<World, 'tryGet'>
    & Partial<Pick<World, 'mutationRevision' | 'getCppRegistry'>>;

interface ChildIndex {
    revision: number;
    core: ReturnType<World['getCppRegistry']>;
    parents: Map<Entity, ReadonlyMap<string, Entity>>;
    pathsByRoot: Map<Entity, Map<string, Entity>>;
    freePathSlots: number;
}

const childIndices = new WeakMap<ChildPathWorld, ChildIndex>();

function childIndex(
    world: ChildPathWorld, children: AnyComponentDef, name: AnyComponentDef,
): ChildIndex | undefined {
    const parent = getComponent('Parent');
    if (!world.mutationRevision || !world.getCppRegistry || !parent) return undefined;
    // Detaching updates Parent; component addition/removal uses topology revisions.
    const revision = Math.max(
        world.mutationRevision(children, 'write'), world.mutationRevision(children, 'topology'),
        world.mutationRevision(name, 'write'), world.mutationRevision(name, 'topology'),
        world.mutationRevision(parent, 'write'), world.mutationRevision(parent, 'topology'),
    );
    const core = world.getCppRegistry();
    let index = childIndices.get(world);
    if (!index || index.revision !== revision || index.core !== core) {
        index = { revision, core, parents: new Map(), pathsByRoot: new Map(), freePathSlots: 0 };
        childIndices.set(world, index);
    }
    return index;
}

function namedChildren(
    world: ChildPathWorld, entity: Entity, children: AnyComponentDef, name: AnyComponentDef,
    index: ChildIndex,
): ReadonlyMap<string, Entity> | null {
    const cached = index.parents.get(entity);
    if (cached) return cached;
    const data = world.tryGet(entity, children);
    if (!data) return null;
    const named = new Map<string, Entity>();
    for (const child of (data['entities'] || []) as Entity[]) {
        const value = world.tryGet(child, name)?.['value'];
        if (typeof value === 'string' && !named.has(value)) named.set(value, child);
    }
    // A component read can resolve another path through this same parent.
    const existing = index.parents.get(entity);
    if (existing) return existing;
    index.parents.set(entity, named);
    // Limit retained paths to the number of child names already held by this index.
    index.freePathSlots += named.size;
    return named;
}

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

    const index = childIndex(world, Children, Name);
    const knownPaths = index?.pathsByRoot.get(rootEntity);
    const cached = knownPaths?.get(childPath);
    if (cached !== undefined) return cached;

    let current: Entity = rootEntity;
    let remaining = childPath;
    if (knownPaths) {
        // Rig tracks often visit a parent immediately before its child.
        const slash = childPath.lastIndexOf('/');
        if (slash > 0) {
            const parent = knownPaths.get(childPath.slice(0, slash));
            if (parent !== undefined) {
                current = parent;
                remaining = childPath.slice(slash + 1);
            }
        }
    }
    for (const segment of remaining.split('/')) {
        if (index) {
            const child = namedChildren(world, current, Children, Name, index)?.get(segment);
            if (child === undefined) return null;
            current = child;
            continue;
        }
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
    if (index && index.freePathSlots > 0) {
        let paths = index.pathsByRoot.get(rootEntity);
        if (!paths) {
            paths = new Map();
            index.pathsByRoot.set(rootEntity, paths);
        }
        if (!paths.has(childPath)) {
            paths.set(childPath, current);
            index.freePathSlots--;
        }
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
