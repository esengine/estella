// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetLease.ts
 * @brief   The receipt for one acquisition, and a scope that holds several.
 *
 * @details A path answers "which asset do I want?". A lease answers "which
 *          instance do I actually hold?" — and only the second one can be given
 *          back correctly once `invalidate()` has made two generations of the
 *          same path live at the same time.
 */

import { disposeAll } from '../util/disposeAll';
import {
    namedBindingOf, boundValueOf, firstBindingLease, hasBindingName, leaseBinding, LeaseBindings, sameAcquisition, type BindingLease,
} from './leaseBindings';

const releaseLease = (lease: AssetLease): void => lease.release();
const releaseBatch = (leases: AssetLease[]): void => disposeAll(leases, releaseLease, true);

export interface FieldLeaseBinding { readonly type: string; readonly value: number | string }
export type FieldLeaseLookup = (scope: AssetScope, type: string, value: number | string) => AssetLease | undefined;

/** A standalone scope knows the live names on its own receipts. Assets also knows the realm's ref resolver. */
export const scopeFieldLease: FieldLeaseLookup = (scope, type, value) => {
    if (typeof value === 'string') {
        const named = scope.leases().find(lease => namedBindingOf(lease)?.type === type && hasBindingName(lease, value));
        if (named) return named;
    }
    return scope.bindingLease(type, value);
};

/** One acquisition, and the right to end it. */
export interface AssetLease<T = unknown> {
    readonly key: string;
    /** Ledger-minted, so two eras never merge even if their values compare equal. */
    readonly generation: number;
    readonly value: T;
    /** @internal Unavailable dependencies of the preparation held by this receipt. */
    readonly failedDependencies?: readonly string[];
    /** Give this one acquisition back. Calling twice is a no-op, not a double free. */
    release(): void;
    /**
     * A second receipt for the SAME generation — an owner splitting what it holds.
     *
     * Not a re-acquire: this era may already be superseded, which is exactly when
     * loading the path again hands back a different instance than the one the
     * splitting owner is bound to. Null when the ledger has forgotten it.
     */
    retain(): AssetLease<T> | null;
}

/** A composed resource has no cache generation to re-acquire. Its last receipt disposes it. */
export function ownedAssetLease<T>(key: string, generation: number, value: T, dispose: (value: T) => void, type?: string): AssetLease<T> {
    let holders = 0;
    const acquire = (): BindingLease<T> => {
        holders++;
        let spent = false;
        return {
            key, generation, value, [leaseBinding]: type,
            release: () => {
                if (spent) return;
                spent = true;
                if (--holders === 0) dispose(value);
            },
            retain: () => spent ? null : acquire(),
        };
    };
    return acquire();
}

/**
 * @brief Everything one owner acquired, released together.
 *
 * @details Holds receipts rather than paths, so unloading releases what was
 *          actually acquired — not what the manifest says this owner would
 *          acquire if it loaded today. A failed acquisition produced no lease,
 *          so there is nothing to release and nothing to guess about.
 */
export class AssetScope {
    private leases_: AssetLease[] = [];
    private closed_ = false;
    /** Null after the first search. Repeated lookups share an index until a receipt is removed. */
    private bindings_?: LeaseBindings | null;
    private fieldLeases_?: Map<AssetLease, FieldLeaseBinding>;

    add<T>(lease: AssetLease<T>): AssetLease<T> {
        if (this.closed_) {
            lease.release();
            throw new Error('Cannot add an acquisition to a closed asset scope');
        }
        this.leases_.push(lease as AssetLease);
        return lease;
    }

    /** @internal A receipt acquired for a stored component field. */
    addFieldLease<T>(type: string, value: unknown, lease: AssetLease<T>): AssetLease<T> {
        this.add(lease);
        if (value && (typeof value === 'number' || typeof value === 'string')) {
            (this.fieldLeases_ ??= new Map()).set(lease, { type, value });
        }
        return lease;
    }

    /** @internal Explicit acquisitions and opaque loader dependencies have independent lifetimes. */
    get hasFieldLeases(): boolean { return !!this.fieldLeases_?.size; }

    /** @internal End field acquisitions that no stored field uses, keeping one receipt per generation. */
    releaseUnusedFieldLeases(
        visit: (read: (type: string, value: unknown) => boolean) => void, lookup: FieldLeaseLookup = scopeFieldLease,
    ): void {
        const bindings = this.fieldLeases_;
        if (!bindings?.size) return;
        const kept = new Set<AssetLease>();
        visit((type, value) => {
            if (!value || (typeof value !== 'string' && typeof value !== 'number')) return false;
            const named = typeof value === 'string' ? lookup(this, type, value) : undefined;
            if (typeof value === 'string' && !named) return false;
            const matches: AssetLease[] = [];
            for (const [lease, binding] of bindings) {
                if (binding.type !== type) continue;
                if (named) {
                    if (!sameAcquisition(named, lease)) continue;
                    kept.add(lease);
                    break;
                }
                // More than one generation can have the same native handle.
                if (binding.value !== value && boundValueOf(lease) !== value) continue;
                if (matches.some(other => sameAcquisition(other, lease))) continue;
                matches.push(lease);
                kept.add(lease);
            }
            return kept.size === bindings.size;
        });
        if (this.fieldLeases_ !== bindings || kept.size === bindings.size) return;
        const unused = [...bindings.keys()].filter(lease => !kept.has(lease) && this.forget(lease));
        releaseBatch(unused);
    }

    /** Hand back the current batch in reverse order, attempting all releases.
     * A failure is reported after cleanup; acquisitions made by cleanup belong
     * to the next batch. */
    releaseAll(): void {
        releaseBatch(this.take_());
    }

    private take_(): AssetLease[] {
        const leases = this.leases_;
        this.leases_ = [];
        this.bindings_ = undefined;
        this.fieldLeases_ = undefined;
        return leases;
    }

    /** @internal End these owners' lifetimes together. Detach all their receipts before any unloader can reenter. */
    static closeAll(scopes: readonly AssetScope[]): void {
        const batches = scopes.map(scope => {
            scope.closed_ = true;
            return scope.take_();
        });
        disposeAll(batches, releaseBatch);
    }

    /**
     * Take over every receipt `other` holds; it owes nothing afterwards.
     *
     * The transfer an owner needs when the acquiring code is not the owning
     * code: a loader acquires into a scope of its own and hands the whole thing
     * to whoever will outlive it.
     */
    absorb(other: AssetScope): void {
        if (other === this) return;
        if (this.closed_) throw new Error('Cannot transfer acquisitions to a closed asset scope');
        for (const lease of other.leases_) this.leases_.push(lease);
        if (other.fieldLeases_) {
            this.fieldLeases_ ??= new Map();
            for (const [lease, binding] of other.fieldLeases_) this.fieldLeases_.set(lease, binding);
            other.fieldLeases_ = undefined;
        }
        other.leases_ = [];
        other.bindings_ = undefined;
    }

    /** @internal Transfer a publication in acquisition order. A full publication takes the whole loader scope. */
    absorbFieldLeases(source: AssetScope, fields: ReadonlyMap<AssetLease, FieldLeaseBinding>, auxiliary?: ReadonlySet<AssetLease>): void {
        if (!auxiliary) {
            this.absorb(source);
            if (fields.size) {
                this.fieldLeases_ ??= new Map();
                for (const [lease, binding] of fields) this.fieldLeases_.set(lease, binding);
            }
            return;
        }
        for (const lease of [...source.leases_]) {
            const binding = fields.get(lease);
            if (!binding && !auxiliary.has(lease)) continue;
            if (!source.forget(lease)) continue;
            if (binding) this.addFieldLease(binding.type, binding.value, lease);
            else this.add(lease);
        }
    }

    /** Stop tracking one lease without releasing it — for an ownership transfer. */
    forget(lease: AssetLease): boolean {
        const i = this.leases_.indexOf(lease);
        if (i < 0) return false;
        this.leases_.splice(i, 1);
        this.fieldLeases_?.delete(lease);
        this.bindings_ = undefined;
        return true;
    }

    /** @internal The receipt this scope owns for a live component field. */
    bindingLease(type: string, value: number | string, slot?: object): AssetLease | undefined {
        if (!value || !this.leases_.length) return undefined;
        if (this.bindings_ === undefined || this.leases_.length === 1) {
            this.bindings_ = null;
            return firstBindingLease(this.leases_, type, value, slot);
        }
        this.bindings_ ??= new LeaseBindings();
        return this.bindings_.find(this.leases_, type, value, slot);
    }

    /** How many acquisitions this scope still owes. Diagnostics and tests. */
    get size(): number {
        return this.leases_.length;
    }

    /** @internal The receipts themselves — for a census, never to release behind the scope. */
    leases(): readonly AssetLease[] {
        return this.leases_;
    }
}
