// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Children, Disabled, Parent, SceneOwner } from '../ecs/component';
import { detachPreservingWorldTransform } from '../ecs/entityUtils';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

/** Walk through unowned joints to the first scene-owned ancestor. */
export function detachFromSceneParent(world: World, entity: Entity, previous: ReadonlySet<Entity>): void {
    let parent = world.tryGet(entity, Parent)?.entity as Entity | undefined;
    while (parent !== undefined) {
        if (previous.has(parent)) {
            detachPreservingWorldTransform(world, entity);
            return;
        }
        if (world.has(parent, SceneOwner)) return;
        parent = world.tryGet(parent, Parent)?.entity as Entity | undefined;
    }
}

/** Membership can change between the frames of an unload. */
export class SceneEntityBatch {
    private readonly pending: Set<Entity>;
    private hidden: Set<Entity> | null = null;

    constructor(private readonly world: World, entities: Iterable<Entity>) {
        this.pending = new Set(entities);
    }

    detachSurvivors(roots: Iterable<Entity> = this.pending): void {
        const parents = new Set(roots);
        for (const parent of parents) {
            if (!this.world.valid(parent) || !this.world.has(parent, Children)) continue;
            for (const child of this.world.get(parent, Children).entities) {
                if (this.pending.has(child) || !this.world.has(child, SceneOwner)) parents.add(child);
                else detachPreservingWorldTransform(this.world, child);
            }
        }
    }

    hideRoots(candidates: Iterable<Entity> = this.pending): void {
        const hidden = this.hidden ??= new Set<Entity>();
        for (const entity of candidates) {
            if (!this.pending.has(entity) || !this.world.valid(entity) || this.world.has(entity, Disabled)) continue;
            const parent = this.world.tryGet(entity, Parent)?.entity as Entity | undefined;
            if (parent !== undefined && this.pending.has(parent)) continue;
            hidden.add(entity);
            this.world.insert(entity, Disabled, {});
        }
    }

    release(entity: Entity): void {
        if (!this.pending.delete(entity) || !this.hidden || !this.world.valid(entity)) return;
        const children = this.world.tryGet(entity, Children);
        if (children) this.hideRoots(children.entities);
        if (this.hidden.delete(entity)) this.world.remove(entity, Disabled);
    }

    despawn(entity: Entity): void {
        if (!this.pending.has(entity)) return;
        if (this.world.valid(entity)) {
            if (this.world.has(entity, Children)) this.detachSurvivors([entity]);
            if (this.pending.has(entity)) this.world.despawn(entity);
        }
        this.pending.delete(entity);
        this.hidden?.delete(entity);
    }
}
