// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    liveAssetRebind.ts
 * @brief   Replacing a live asset is a transaction, and its unit is the owning scope.
 *
 * @details Ownership is per scope: two scenes holding one texture hold two
 *          receipts. So a replacement that acquires ONCE and swaps the handle
 *          world-wide moves both owners onto an asset only one of them owes a
 *          release for — the other's receipt now names an era nothing on screen
 *          is using, and the new era has one holder where two are needed.
 *
 *          Hence one acquisition per scope that migrates, and within a scope
 *          all of its bindings move or none do: a scope holding the new
 *          generation for some of its bindings and the old one for the rest
 *          owes two receipts for one replacement, and nothing afterwards can
 *          say which binding belongs to which.
 *
 *          The coordinator owns nothing at rest. Every acquisition it makes
 *          ends up in an owner's scope or is given straight back.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { AssetScope, AssetLease } from './AssetLease';
import type { AssetFieldType } from '../scene/scene';
import { findLiveAssetBindings, readLiveAssetBinding, writeLiveAssetBinding } from './liveAssetBindings';
import { log } from '../util/logger';

/** The scope that owns what an entity's asset fields hold. */
export type OwnerScopeResolver = (entity: Entity) => AssetScope;

/** One acquisition of the replacement, and how to read the value a bound field
 *  holds for a lease — a texture's handle, for the only kind rebound today. */
export interface LiveAssetReplacement {
    readonly lease: AssetLease;
    readonly boundValue: (lease: AssetLease) => unknown;
}

/** Every scope owning at least one live binding of `oldValue` — one replacement
 *  acquisition is owed to each. */
export function ownerScopesOf(
    world: World, type: AssetFieldType, oldValue: unknown, ownerScopeOf: OwnerScopeResolver,
): AssetScope[] {
    const scopes: AssetScope[] = [];
    for (const binding of findLiveAssetBindings(world, type, oldValue)) {
        const scope = ownerScopeOf(binding.entity);
        if (!scopes.includes(scope)) scopes.push(scope);
    }
    return scopes;
}

/**
 * Move one scope onto the replacement: bindings and ownership together, all or
 * none. Returns whether it migrated; when it did not, the replacement has been
 * given back rather than kept by the coordinator.
 */
export function migrateScopeBindings(
    world: World,
    scope: AssetScope,
    type: AssetFieldType,
    oldValue: unknown,
    replacement: LiveAssetReplacement,
    ownerScopeOf: OwnerScopeResolver,
): boolean {
    const bindings = findLiveAssetBindings(world, type, oldValue)
        .filter((binding) => ownerScopeOf(binding.entity) === scope);
    const newValue = replacement.boundValue(replacement.lease);
    if (bindings.length === 0 || newValue === undefined) {
        replacement.lease.release();
        return false;
    }

    // What this scope holds for the outgoing era, found BEFORE the replacement
    // joins the scope — afterwards a search by value could match either.
    const outgoing = scope.leases().find((lease) => replacement.boundValue(lease) === oldValue);

    const previous = bindings.map((binding) => readLiveAssetBinding(world, binding));
    let written = 0;
    let failure: unknown = null;
    for (; written < bindings.length; written++) {
        try {
            writeLiveAssetBinding(world, bindings[written], newValue);
        } catch (e) {
            failure = e;
            break;
        }
    }
    if (failure !== null) {
        // Every binding, not only the ones whose write RETURNED: a write that
        // threw may still have landed, and one left holding the replacement is
        // the split ownership this is atomic to prevent.
        for (let i = bindings.length - 1; i >= 0; i--) {
            try {
                writeLiveAssetBinding(world, bindings[i], previous[i]);
            } catch {
                // The binding is gone; there is nothing to put back into it.
            }
        }
        replacement.lease.release();
        log.warn('asset', 'live asset rebind rolled back — a binding could not be written', failure);
        return false;
    }

    scope.add(replacement.lease);
    if (outgoing) {
        scope.forget(outgoing);
        outgoing.release();
    }
    return true;
}
