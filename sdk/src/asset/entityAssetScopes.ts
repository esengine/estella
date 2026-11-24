// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityAssetScopes.ts
 * @brief   Resources owned by an entity in one World, registry and asset realm.
 *
 * @details A runtime entity can have no scene; a persistent entity leaves its
 *          scene and keeps rendering. Somebody
 *          has to owe a release for what it is still bound to, and the two
 *          answers that existed were both wrong: the scene's scope is about to
 *          be given back, and the app's never ends while an entity's does.
 *
 *          Despawn, registry departure and asset reset all retire that ownership.
 */
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import type { AnyComponentDef } from '../ecs/component';
import { AssetScope, scopeFieldLease, type AssetLease, type FieldLeaseBinding, type FieldLeaseLookup } from './AssetLease';
import { visitEntityAssetBindings } from './liveAssetBindings';
import { log } from '../util/logger';

interface WorldScopes {
    scopes: Map<Entity, AssetScope>;
    unbind(): void;
}

function closeWorlds(entries: Iterable<WorldScopes>): void {
    const scopes: AssetScope[] = [];
    for (const entry of entries) {
        entry.unbind();
        for (const scope of entry.scopes.values()) scopes.push(scope);
        entry.scopes.clear();
    }
    AssetScope.closeAll(scopes);
}

/** Record the exact dependencies a scene lends an entity until it changes owners. */
export function recordSceneDependencies(
    target: Map<Entity, readonly AssetLease[]>, entity: Entity, leases: readonly AssetLease[], scope?: AssetScope,
): void {
    if (scope) for (const lease of leases) scope.preserveDependency(lease);
    const previous = target.get(entity);
    target.set(entity, previous ? [...previous, ...leases] : leases);
}

export class EntityAssetScopes {
    private readonly worlds_ = new Map<World, WorldScopes>();
    private closed_ = false;

    constructor(readonly leaseForBinding: FieldLeaseLookup = scopeFieldLease) {}

    /** @internal Retain live field bindings and independently declared dependencies from the same scene scope. */
    retainFromScene(world: World, entity: Entity, scene: AssetScope, auxiliary?: readonly AssetLease[]): void {
        const sources = new Map<AssetLease, FieldLeaseBinding>();
        visitEntityAssetBindings(world, entity, (type, value) => {
            if (typeof value !== 'string' && typeof value !== 'number') return;
            const held = this.leaseForBinding(scene, type, value);
            if (held && (!sources.has(held) || typeof value === 'string')) sources.set(held, { type, value });
        });
        if (!sources.size && !auxiliary) return;
        const scope = this.ensure(world, entity);
        for (const source of auxiliary ?? []) scope.retainAcquisition(source, undefined, scene);
        for (const [source, field] of sources) scope.retainAcquisition(source, field, scene);
    }

    /**
     * The scope this entity owns, created on first use.
     *
     * Takes the World rather than being handed one at construction: the end of
     * an entity scope is its despawn, so the subscription that ends it is made
     * here — before any scope exists there is nothing that could be missed.
     */
    ensure(world: World, entity: Entity): AssetScope {
        if (this.closed_) throw new Error('Cannot own resources in a retired asset realm');
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

    /** End this asset realm across all its Worlds before invoking user unloaders. */
    close(): void {
        this.closed_ = true;
        const entries = [...this.worlds_.values()];
        this.worlds_.clear();
        closeWorlds(entries);
    }

    private bind_(world: World): Map<Entity, AssetScope> {
        const existing = this.worlds_.get(world);
        if (existing) return existing.scopes;
        const scopes = new Map<Entity, AssetScope>();
        let pending: Map<Entity, { owner: AssetScope; component: AnyComponentDef }> | undefined;
        const offFields = world.onAssetFieldsChanged((entity, component) => {
            const scope = scopes.get(entity);
            if (!scope?.hasFieldLeases) return;
            if (!pending) {
                pending = new Map();
                // Observers and hot reload can roll a synchronous edit back. Read the committed fields.
                void Promise.resolve().then(() => {
                    const batch = pending!;
                    pending = undefined;
                    for (const [id, { owner, component }] of batch) {
                        if (scopes.get(id) !== owner || world.isDestructionPending(id)) continue;
                        try { owner.releaseUnusedFieldLeases(read => visitEntityAssetBindings(world, id, read, component), this.leaseForBinding); }
                        catch (error) { log.warn('asset', `Could not settle field acquisitions for entity ${id}`, error); }
                    }
                });
            }
            pending.set(entity, { owner: scope, component });
        });
        const offDespawn = world.onDespawn(entity => {
            const scope = scopes.get(entity);
            if (!scope) return;
            scopes.delete(entity);
            if (!scopes.size) {
                this.worlds_.delete(world);
                entry.unbind();
            }
            AssetScope.closeAll([scope]);
        });
        const offCore = world.onCoreDisconnect(() => {
            if (this.worlds_.get(world) !== entry) return;
            this.worlds_.delete(world);
            closeWorlds([entry]);
        });
        const entry = { scopes, unbind() { offDespawn(); offCore(); offFields(); pending?.clear(); } };
        this.worlds_.set(world, entry);
        return scopes;
    }
}
