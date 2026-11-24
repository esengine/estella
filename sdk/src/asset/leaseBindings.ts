// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLease } from './AssetLease';

/** A handle's pool or the registry slot that answers a named lookup. */
export const leaseBinding = Symbol('asset binding');
/** The dependency to record when the ref requested names only part of an acquired asset. */
export const leaseDependencyKey = Symbol('asset dependency key');
type BindingIdentity = string | { readonly type: string };
export interface BindingLease<T = unknown> extends AssetLease<T> {
    readonly [leaseBinding]: BindingIdentity | undefined;
    readonly [leaseDependencyKey]?: string;
}

function identityOf(lease: AssetLease): BindingLease[typeof leaseBinding] {
    return (lease as Partial<BindingLease>)[leaseBinding];
}

/** A registry slot can have several receipts under different authored names. */
export function bindingSlotOf(lease: AssetLease): { readonly type: string } | undefined {
    const identity = identityOf(lease);
    return typeof identity === 'object' ? identity : undefined;
}

export function sameAcquisition(a: AssetLease, b: AssetLease): boolean {
    if (a.key !== b.key || a.generation !== b.generation) return false;
    const left = identityOf(a), right = identityOf(b);
    return left === undefined || right === undefined || left === right;
}

export function boundValueIn(value: unknown): unknown {
    return typeof value === 'number' ? value : (value as { handle?: number | string } | null)?.handle;
}

export function boundValueOf(lease: AssetLease): unknown {
    return boundValueIn(lease.value);
}

function poolOf(identity: BindingIdentity): string {
    return typeof identity === 'string' ? identity : identity.type;
}

export function hasBindingName(lease: AssetLease, name: string): boolean {
    const names = (lease as { names?: readonly string[] }).names;
    return Array.isArray(names) && names.includes(name);
}

function customBindingLease(leases: readonly AssetLease[], value: number | string): AssetLease | undefined {
    let byName: AssetLease | undefined;
    for (const lease of leases) {
        if (identityOf(lease) !== undefined) continue;
        if (boundValueOf(lease) === value) return lease;
        if (byName || typeof value !== 'string') continue;
        if (hasBindingName(lease, value)) byName = lease;
    }
    return byName;
}

/** A single query can read the scene's receipts directly without allocating an index. */
export function firstBindingLease(
    leases: readonly AssetLease[], type: string, value: number | string, slot?: object,
): AssetLease | undefined {
    let byHandle: AssetLease | undefined, hasCustom = false;
    for (const lease of leases) {
        const identity = identityOf(lease);
        if (identity === undefined) {
            hasCustom = true;
        } else if (identity === slot) {
            return lease;
        } else if (poolOf(identity) === type && boundValueOf(lease) === value) {
            if (!slot) return lease;
            byHandle ??= lease;
        }
    }
    return byHandle ?? (hasCustom ? customBindingLease(leases, value) : undefined);
}

/** The first receipt a scope holds for each binding. Alias routing stays in the owning registry. */
export class LeaseBindings {
    private readonly slots_ = new Map<object, AssetLease>();
    private readonly handles_ = new Map<string, Map<number | string, AssetLease>>();
    private readonly custom_: AssetLease[] = [];
    private indexed_ = 0;

    private add_(lease: AssetLease): void {
        const identity = identityOf(lease);
        if (identity === undefined) {
            this.custom_.push(lease);
            return;
        }
        if (typeof identity === 'object' && !this.slots_.has(identity)) this.slots_.set(identity, lease);
        const handle = boundValueOf(lease);
        if (!handle || (typeof handle !== 'number' && typeof handle !== 'string')) return;
        const type = poolOf(identity);
        let byHandle = this.handles_.get(type);
        if (!byHandle) {
            byHandle = new Map();
            this.handles_.set(type, byHandle);
        }
        if (!byHandle.has(handle)) byHandle.set(handle, lease);
    }

    find(leases: readonly AssetLease[], type: string, value: number | string, slot?: object): AssetLease | undefined {
        for (; this.indexed_ < leases.length; this.indexed_++) this.add_(leases[this.indexed_]);
        const held = (slot && this.slots_.get(slot)) ?? this.handles_.get(type)?.get(value);
        if (held || this.custom_.length === 0) return held;
        // Project-provided receipts may implement only the original public contract.
        return customBindingLease(this.custom_, value);
    }
}
