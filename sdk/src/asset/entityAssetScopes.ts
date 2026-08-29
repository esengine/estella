// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityAssetScopes.ts
 * @brief   What one entity owns, for an entity that outlives the scene it came from.
 *
 * @details A persistent entity leaves its scene and keeps rendering. Somebody
 *          has to owe a release for what it is still bound to, and the two
 *          answers that existed were both wrong: the scene's scope is about to
 *          be given back, and the app's never ends while an entity's does.
 *
 *          So the entity is the owner, and the acquisition ends when the entity
 *          does — `World.onDespawn`, which fires for a whole subtree, before the
 *          component storage goes.
 */
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { AssetScope } from './AssetLease';

export class EntityAssetScopes {
    private scopes_ = new Map<Entity, AssetScope>();
    private world_: World | null = null;
    private unbind_: (() => void) | null = null;

    /**
     * The scope this entity owns, created on first use.
     *
     * Takes the World rather than being handed one at construction: the end of
     * an entity scope is its despawn, so the subscription that ends it is made
     * here — before any scope exists there is nothing that could be missed.
     */
    ensure(world: World, entity: Entity): AssetScope {
        this.bind_(world);
        let scope = this.scopes_.get(entity);
        if (!scope) {
            scope = new AssetScope();
            this.scopes_.set(entity, scope);
        }
        return scope;
    }

    /** What this entity owns, or null when it owns nothing of its own. */
    scopeFor(entity: Entity): AssetScope | null {
        return this.scopes_.get(entity) ?? null;
    }

    /** Live per-entity scopes. Diagnostics and the resource census. */
    get size(): number {
        return this.scopes_.size;
    }

    private bind_(world: World): void {
        if (this.world_ === world) return;
        this.unbind_?.();
        this.world_ = world;
        this.unbind_ = world.onDespawn((entity) => {
            const scope = this.scopes_.get(entity);
            if (!scope) return;
            this.scopes_.delete(entity);
            scope.releaseAll();
        });
    }
}
