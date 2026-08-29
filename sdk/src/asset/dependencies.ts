// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dependencies.ts
 * @brief   What one asset's preparation took, and what it merely read.
 *
 * @details A dependency graph is a PROJECTION of what actually happened, never a
 *          second source of fact. So an edge is not something a loader declares
 *          beside its work — it is recorded by the door the loader went through
 *          to do the work, and a loader that took nothing produces no edges no
 *          matter what it says.
 *
 *          Two kinds, and the difference matters:
 *
 *          `owned` — the preparation acquired a runtime resource and holds it.
 *          A receipt proves it, the era gives it back, and the child cannot go
 *          away underneath the parent.
 *
 *          `source` — the preparation READ another asset's content to decide
 *          what to produce (an external `.tsj` folded into a `.tmj`). Nothing is
 *          held: the parent owns no runtime object for it, and destroying
 *          anything on its behalf would be wrong. It is causality, not
 *          ownership — the reason the parent must be rebuilt when it changes.
 *
 *          A source edge exists iff changing that content may invalidate the
 *          parent's semantic value. Reading a log setting or an editor
 *          preference during a load is not a dependency.
 *
 *          Cycles are not refused here. `A imports B` while `B`'s metadata names
 *          `A` is a real shape; what has to be acyclic is a BUILD PLAN, which is
 *          this graph's condensation and not this graph.
 */
import type { AssetLease } from './AssetLease';
import { AssetScope } from './AssetLease';
import { log } from '../util/logger';

export type DependencyKind = 'owned' | 'source';

/** One edge, as the acquisition that produced it named its other end. */
export interface DependencyReceipt {
    readonly kind: DependencyKind;
    /** The asset type when the acquisition had one; a source read and a
     *  composed resource are identified by their path alone. */
    readonly type?: string;
    /** The identity within this realm: what the acquisition asked for. */
    readonly path: string;
}

/** What one preparation took, sealed onto what it produced. */
export interface Preparation {
    /** Everything it acquired; released when what it produced retires. */
    readonly dependencies: AssetScope;
    /** Every edge it produced, owned and source alike. */
    readonly edges: readonly DependencyReceipt[];
}

/**
 * What a handle-bound load produced, and what its preparation took — the same
 * sealing an era gets, for the asset kind whose current value lives in a cache
 * rather than under a slot's name.
 */
export type PreparedLoad<T> = Preparation & { readonly value: T };

/**
 * The recorder behind one preparation: everything it acquires lands here, so
 * neither the era's ownership nor the graph's edges depend on a loader
 * remembering to report anything.
 *
 * It is also the preparation's TRANSACTION. An acquisition made on the way to a
 * value that never arrives has no owner — the era that would have held it does
 * not exist, and no caller was ever handed a receipt for it — so a preparation
 * either commits what it took onto what it produced, or gives all of it back.
 */
export class DependencyRecorder {
    private readonly edges_: DependencyReceipt[] = [];
    private readonly acquired_ = new AssetScope();
    private state_: 'open' | 'committed' | 'rolled-back' = 'open';

    /** A runtime resource this preparation now holds. */
    own<T>(path: string, lease: AssetLease<T>, type?: string): AssetLease<T> {
        if (this.state_ !== 'open') return this.late_(lease);
        this.acquired_.add(lease);
        this.edges_.push(type === undefined ? { kind: 'owned', path } : { kind: 'owned', type, path });
        return lease;
    }

    /** Content this preparation read to decide what to produce. */
    read(path: string): void {
        if (this.state_ !== 'open') return;
        this.edges_.push({ kind: 'source', path });
    }

    /**
     * The preparation produced `value`: what it took is what that value owns.
     *
     * Sealing here rather than at the call site is what makes the two
     * inseparable — there is no shape of the result that carries edges without
     * the receipts behind them.
     */
    commit<T extends object>(value: T): T & Preparation {
        this.state_ = 'committed';
        return { ...value, dependencies: this.acquired_, edges: this.edges_ };
    }

    /** The preparation produced nothing, so it may keep nothing. */
    rollback(): void {
        this.state_ = 'rolled-back';
        this.acquired_.releaseAll();
        this.edges_.length = 0;
    }

    /**
     * An acquisition that landed after the transaction settled: the losing half
     * of a preparation whose other half threw, or a loader that kept the context
     * past its own work. Nobody can own it either way, so it goes back here —
     * the last place that still knows it exists.
     */
    private late_<T>(lease: AssetLease<T>): AssetLease<T> {
        if (this.state_ === 'committed') {
            log.warn('asset', `an acquisition of "${lease.key}" landed after its preparation was published`);
        }
        lease.release();
        return lease;
    }
}
