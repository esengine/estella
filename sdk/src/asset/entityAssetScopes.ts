// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityAssetScopes.ts
 * @brief   What an entity owns outside a scene, ending at its despawn.
 *
 * @details A runtime entity can have no scene; a persistent entity leaves its
 *          scene and keeps rendering. Somebody
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
    private worlds_ = new Map<World, { scopes: Map<Entity, AssetScope>; unbind: () => void }>();

    /**
     * The scope this entity owns, created on first use.
     *
     * Takes the World rather than being handed one at construction: the end of
     * an entity scope is its despawn, so the subscription that ends it is made
     * here — before any scope exists there is nothing that could be missed.
     */
    ensure(world: World, entity: Entity): AssetScope {
        if (!world.valid(entity) || world.isDestructionPending(entity)) {
            throw new Error(`Cannot own resources for entity ${entity}: destroyed or pending destruction`);
        }
        const scopes = this.bind_(world);
        let scope = scopes.get(entity);
        if (!scope) {
            scope = new AssetScope();
            scopes.set(entity, scope);
        }
        return scope;
    }

    /** What this entity owns, or null when it owns nothing of its own. */
    scopeFor(entity: Entity, world?: World): AssetScope | null {
        if (world) return this.worlds_.get(world)?.scopes.get(entity) ?? null;
        let found: AssetScope | null = null;
        for (const { scopes } of this.worlds_.values()) {
            const scope = scopes.get(entity);
            if (!scope) continue;
            // An id alone cannot distinguish entities in different worlds.
            if (found) return null;
            found = scope;
        }
        return found;
    }

    /** Live per-entity scopes. Diagnostics and the resource census. */
    get size(): number {
        let total = 0;
        for (const { scopes } of this.worlds_.values()) total += scopes.size;
        return total;
    }

    private bind_(world: World): Map<Entity, AssetScope> {
        const existing = this.worlds_.get(world);
        if (existing) return existing.scopes;
        const entry = { scopes: new Map<Entity, AssetScope>(), unbind: () => {} };
        this.worlds_.set(world, entry);
        entry.unbind = world.onDespawn((entity) => {
            const scope = entry.scopes.get(entity);
            if (!scope) return;
            entry.scopes.delete(entity);
            try { scope.releaseAll(); } finally {
                if (!entry.scopes.size && this.worlds_.get(world) === entry) {
                    this.worlds_.delete(world);
                    entry.unbind();
                }
            }
        });
        return entry.scopes;
    }
}
