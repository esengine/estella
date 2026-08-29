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

/** One acquisition, and the right to end it. */
export interface AssetLease<T = unknown> {
    readonly key: string;
    /** Ledger-minted, so two eras never merge even if their values compare equal. */
    readonly generation: number;
    readonly value: T;
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

    /** Hand back everything, in reverse acquisition order. */
    releaseAll(): void {
        // Reverse: a dependent acquired after what it depends on goes first.
        for (let i = this.leases_.length - 1; i >= 0; i--) this.leases_[i].release();
        this.leases_ = [];
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
