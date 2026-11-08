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

const releaseLease = (lease: AssetLease): void => lease.release();

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
export function ownedAssetLease<T>(key: string, generation: number, value: T, dispose: (value: T) => void): AssetLease<T> {
    let holders = 0;
    const acquire = (): AssetLease<T> => {
        holders++;
        let spent = false;
        return {
            key, generation, value,
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

    add<T>(lease: AssetLease<T>): AssetLease<T> {
        this.leases_.push(lease as AssetLease);
        return lease;
    }

    /** Hand back the current batch in reverse order, attempting all releases.
     * A failure is reported after cleanup; acquisitions made by cleanup belong
     * to the next batch. */
    releaseAll(): void {
        const leases = this.leases_;
        this.leases_ = [];
        // Detach before callbacks: a reentrant release cannot spend this batch.
        disposeAll(leases, releaseLease, true);
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
        for (const lease of other.leases_) this.leases_.push(lease);
        other.leases_ = [];
    }

    /** Stop tracking one lease without releasing it — for an ownership transfer. */
    forget(lease: AssetLease): boolean {
        const i = this.leases_.indexOf(lease);
        if (i < 0) return false;
        this.leases_.splice(i, 1);
        return true;
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
