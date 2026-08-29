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

/**
 * The recorder behind one preparation: everything it acquires lands here, so
 * neither the era's ownership nor the graph's edges depend on a loader
 * remembering to report anything.
 */
export class DependencyRecorder {
    private readonly edges_: DependencyReceipt[] = [];
    readonly acquired = new AssetScope();

    /** A runtime resource this preparation now holds. */
    own<T>(path: string, lease: AssetLease<T>, type?: string): AssetLease<T> {
        this.acquired.add(lease);
        this.edges_.push(type === undefined ? { kind: 'owned', path } : { kind: 'owned', type, path });
        return lease;
    }

    /** Content this preparation read to decide what to produce. */
    read(path: string): void {
        this.edges_.push({ kind: 'source', path });
    }

    /** What this preparation took, in the order it took it. */
    get edges(): readonly DependencyReceipt[] {
        return this.edges_;
    }
}
