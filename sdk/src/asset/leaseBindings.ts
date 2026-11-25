// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLease, AssetScope } from './AssetLease';
import type { AssetDependencyOwner } from './dependencies';

/** A handle's pool, or the slot or file preparation read through a name. */
export const leaseBinding = Symbol('asset binding');
/** Lookup for a file-addressed receipt held outside the owning realm's scope index. */
export const leaseMatchesSource = Symbol('matches asset source');
/** The dependency to record when the ref requested names only part of an acquired asset. */
export const leaseDependencyKey = Symbol('asset dependency key');
export const leaseOwner = Symbol('asset dependency owner');
/** The committed children of a handle-backed preparation, retained with its generation. */
export const leaseDependencies = Symbol('asset dependencies');
type BindingIdentity = string | { readonly type: string };
export interface BindingLease<T = unknown> extends AssetLease<T> {
    readonly [leaseBinding]: BindingIdentity | undefined;
    readonly [leaseDependencyKey]?: string;
    readonly [leaseOwner]?: AssetDependencyOwner;
    readonly [leaseDependencies]?: AssetScope;
    [leaseMatchesSource]?(ref: string): boolean;
}

function identityOf(lease: AssetLease): BindingLease[typeof leaseBinding] {
    return (lease as Partial<BindingLease>)[leaseBinding];
}

/** Several authored names can read the same registry slot or file preparation. */
export function namedBindingOf(lease: AssetLease): { readonly type: string } | undefined {
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
    return (lease as Partial<BindingLease>)[leaseMatchesSource] ? undefined : boundValueIn(lease.value);
}

function poolOf(identity: BindingIdentity): string {
    return typeof identity === 'string' ? identity : identity.type;
}

export function hasBindingName(lease: AssetLease, name: string): boolean {
    const source = (lease as Partial<BindingLease>)[leaseMatchesSource];
    if (source) return source(name);
    const names = (lease as { names?: readonly string[] }).names;
    return Array.isArray(names) && names.includes(name);
}

export type DependencyBinding = 'current' | 'selected' | 'superseded';
type Dependencies = ReadonlyMap<AssetLease, DependencyBinding>;
const priority = { selected: 3, field: 2, current: 1, superseded: 0 } as const;

export function hasNativeBinding(lease: AssetLease, type: string, value: number | string): boolean {
    const identity = identityOf(lease);
    return (identity === undefined || poolOf(identity) === type) && boundValueOf(lease) === value;
}

/** Fields can move while a dependency keeps an earlier generation with the same native value. */
function preferred(current: AssetLease | undefined, candidate: AssetLease, dependencies?: Dependencies): AssetLease {
    if (!current || !dependencies) return current ?? candidate;
    return priority[dependencies.get(candidate) ?? 'field'] > priority[dependencies.get(current) ?? 'field'] ? candidate : current;
}

function finalMatch(lease: AssetLease, dependencies?: Dependencies): boolean {
    return !dependencies?.size || dependencies.get(lease) === 'selected';
}

function customBindingLease(
    leases: readonly AssetLease[], value: number | string, dependencies?: Dependencies, byHandle?: AssetLease,
): AssetLease | undefined {
    if (byHandle && finalMatch(byHandle, dependencies)) return byHandle;
    let byName: AssetLease | undefined;
    for (const lease of leases) {
        if (identityOf(lease) !== undefined) continue;
        if (boundValueOf(lease) === value) {
            if (finalMatch(lease, dependencies)) return lease;
            byHandle = preferred(byHandle, lease, dependencies);
        } else if (typeof value === 'string' && hasBindingName(lease, value)) {
            byName = preferred(byName, lease, dependencies);
        }
    }
    return byHandle ?? byName;
}

/** A single query can read the scene's receipts directly without allocating an index. */
export function firstBindingLease(
    leases: readonly AssetLease[], type: string, value: number | string, named?: object, dependencies?: Dependencies,
): AssetLease | undefined {
    let exact: AssetLease | undefined, byHandle: AssetLease | undefined, hasCustom = false;
    for (const lease of leases) {
        const identity = identityOf(lease);
        if (identity === undefined) {
            hasCustom = true;
        } else if (identity === named) {
            if (finalMatch(lease, dependencies)) return lease;
            exact = preferred(exact, lease, dependencies);
        } else if (poolOf(identity) === type && boundValueOf(lease) === value) {
            if (!named && finalMatch(lease, dependencies)) return lease;
            byHandle = preferred(byHandle, lease, dependencies);
        }
    }
    return exact ?? (hasCustom ? customBindingLease(leases, value, dependencies, byHandle) : byHandle);
}

/** The first receipt a scope holds for each binding. The owning realm resolves aliases to a binding identity. */
export class LeaseBindings {
    private readonly named_ = new Map<object, AssetLease>();
    private readonly handles_ = new Map<string, Map<number | string, AssetLease>>();
    private readonly custom_: AssetLease[] = [];
    private indexed_ = 0;

    private add_(lease: AssetLease, dependencies?: Dependencies): void {
        const identity = identityOf(lease);
        if (identity === undefined) {
            this.custom_.push(lease);
            return;
        }
        if (typeof identity === 'object') this.named_.set(identity, preferred(this.named_.get(identity), lease, dependencies));
        const handle = boundValueOf(lease);
        if (!handle || (typeof handle !== 'number' && typeof handle !== 'string')) return;
        const type = poolOf(identity);
        let byHandle = this.handles_.get(type);
        if (!byHandle) {
            byHandle = new Map();
            this.handles_.set(type, byHandle);
        }
        byHandle.set(handle, preferred(byHandle.get(handle), lease, dependencies));
    }

    find(leases: readonly AssetLease[], type: string, value: number | string, named?: object, dependencies?: Dependencies): AssetLease | undefined {
        for (; this.indexed_ < leases.length; this.indexed_++) this.add_(leases[this.indexed_], dependencies);
        const exact = named && this.named_.get(named);
        if (exact) return exact;
        const byHandle = this.handles_.get(type)?.get(value);
        // Project-provided receipts may implement only the original public contract.
        return this.custom_.length ? customBindingLease(this.custom_, value, dependencies, byHandle) : byHandle;
    }
}
