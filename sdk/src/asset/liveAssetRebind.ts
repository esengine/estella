// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    liveAssetRebind.ts
 * @brief   Publish a replacement to the scopes that own its live bindings.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { AssetScope, AssetLease } from './AssetLease';
import type { AssetFieldType } from '../scene/scene';
import { liveAssetBindings, type LiveAssetBinding } from './liveAssetBindings';
import { boundValueOf, sameAcquisition } from './leaseBindings';
import { log } from '../util/logger';

type OwnerScopeResolver = (entity: Entity, create: boolean) => AssetScope | null;

function boundData(world: World, binding: LiveAssetBinding, expected: unknown): Record<string, unknown> | null {
    if (!world.valid(binding.entity) || world.isDestructionPending(binding.entity)) return null;
    const data = world.tryGet(binding.entity, binding.component) as Record<string, unknown> | null;
    return data && data[binding.field] === expected ? data : null;
}

function writeBinding(world: World, binding: LiveAssetBinding, data: Record<string, unknown>, value: unknown): void {
    data[binding.field] = value;
    world.set(binding.entity, binding.component, data as never);
}

function replaceFields(
    world: World, scope: AssetScope, bindings: LiveAssetBinding[], ownerOf: OwnerScopeResolver,
    oldValue: number | string, newValue: number | string,
): boolean {
    const attempted: LiveAssetBinding[] = [];
    try {
        for (const binding of bindings) {
            const data = boundData(world, binding, oldValue);
            if (!data || ownerOf(binding.entity, false) !== scope) continue;
            attempted.push(binding);
            writeBinding(world, binding, data, newValue);
        }
        return attempted.length > 0;
    } catch (error) {
        // Include the throwing write. An observer can throw after the component was updated.
        for (let i = attempted.length - 1; i >= 0; i--) {
            const binding = attempted[i];
            try {
                const data = boundData(world, binding, newValue);
                if (data) writeBinding(world, binding, data, oldValue);
            } catch { /* The component may have disappeared during rollback. */ }
        }
        log.warn('asset', 'live asset rebind rolled back — a binding could not be written', error);
        return false;
    }
}

interface OwnerBindings {
    fields: LiveAssetBinding[];
    outgoing?: AssetLease;
    added?: AssetLease;
    byEntity?: Map<Entity, LiveAssetBinding[]>;
}

/** Only needed if a field still holds the outgoing value after the writes. */
function originallyBound(owner: OwnerBindings, binding: LiveAssetBinding): boolean {
    if (!owner.byEntity) {
        owner.byEntity = new Map();
        for (const field of owner.fields) {
            const fields = owner.byEntity.get(field.entity);
            if (fields) fields.push(field);
            else owner.byEntity.set(field.entity, [field]);
        }
    }
    return owner.byEntity.get(binding.entity)?.some(field => field.component === binding.component && field.field === binding.field) ?? false;
}

function releaseHeld(scope: AssetScope, lease: AssetLease | undefined): void {
    if (!lease || !scope.forget(lease)) return;
    try { lease.release(); }
    catch (error) { log.warn('asset', 'hot-update rebind: could not dispose an unused acquisition', error); }
}

/** Borrow the acquired generation. Each scope keeps exactly the receipts its live fields still use. */
export function migrateLiveBindings(
    world: World, type: AssetFieldType, oldValue: number | string, replacement: AssetLease, ownerOf: OwnerScopeResolver,
): { moved: number; revisit: boolean } {
    const result = { moved: 0, revisit: false };
    const newValue = boundValueOf(replacement);
    if ((typeof newValue !== 'number' && typeof newValue !== 'string') || !newValue) return result;
    if (newValue === oldValue) {
        log.warn('asset', `hot-update rebind: re-acquiring "${type}" returned the same value (${String(oldValue)})`);
    }

    const owners = new Map<AssetScope, OwnerBindings>();
    for (const binding of liveAssetBindings(world, type, oldValue)) {
        const scope = ownerOf(binding.entity, true);
        if (!scope) continue;
        const group = owners.get(scope);
        if (group) group.fields.push(binding);
        else owners.set(scope, { fields: [binding] });
    }
    if (!owners.size) return result;
    for (const [scope, group] of owners) {
        try {
            const outgoing = scope.bindingLease(type, oldValue);
            const existing = oldValue === newValue ? outgoing : scope.bindingLease(type, newValue);
            const alreadyHeld = existing && (sameAcquisition(existing, replacement)
                || (oldValue === newValue && scope.leases().some(held => sameAcquisition(held, replacement))));
            if (!alreadyHeld) {
                const share = replacement.retain();
                if (!share) break;
                // A write may synchronously despawn its owner. Register the share before notifying the world.
                group.added = scope.addFieldLease(type, newValue, share);
            }
            // Another owner's observer may have moved these fields already. The final walk decides what is still held.
            if (outgoing && !sameAcquisition(outgoing, replacement)) group.outgoing = outgoing;
            if (oldValue === newValue || replaceFields(world, scope, group.fields, ownerOf, oldValue, newValue)) {
                result.moved++;
            }
        } catch (error) {
            log.warn('asset', 'hot-update rebind: an owner could not settle its receipts', error);
        }
    }

    // Observers may edit other fields or transfer entities during a write. Reconcile all scopes in one walk.
    for (const binding of liveAssetBindings(world, type, oldValue, newValue)) {
        const scope = ownerOf(binding.entity, false);
        const group = scope && owners.get(scope);
        if (binding.value === newValue) {
            if (group) group.added = undefined;
        } else {
            if (group) group.outgoing = undefined;
            if (!result.revisit && (!group || !originallyBound(group, binding))) result.revisit = true;
        }
    }
    for (const [scope, group] of owners) {
        releaseHeld(scope, group.outgoing);
        releaseHeld(scope, group.added);
    }
    return result;
}
