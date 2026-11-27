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
 *          Source reads can form cycles. Rebuilds group those readers together.
 *          Owned acquisitions check the concrete slots and generations before waiting.
 */
import type { AssetLease } from './AssetLease';
import { AssetScope } from './AssetLease';
import type { AssetLoader } from './AssetLoader';
import type { LoadGeneration } from './AssetRefLedger';
import { log } from '../util/logger';
import { assetPairKey } from './assetPairKey';
import { leaseDependencyKey, type BindingLease } from './leaseBindings';

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

/** One asset of a realm: what kind it is, and the name its era is filed under. */
export interface AssetIdentity {
    readonly type: string;
    readonly path: string;
}

/** One ownership identity: a registry slot, or one generation of a cached asset. */
export class AssetDependencyOwner {
    private claims_?: Set<{ target: AssetDependencyOwner }>;

    constructor(readonly type: string, readonly key: string) {}

    /** Each pending acquisition becomes one receipt, including overlapping preparations. */
    claim(target: AssetDependencyOwner): () => void {
        if (target.reaches_(this)) {
            throw new Error(`Circular asset dependency: ${this.type} "${this.key}" cannot acquire ${target.type} "${target.key}".`);
        }
        const claims = this.claims_ ??= new Set();
        const claim = { target };
        claims.add(claim);
        return () => { claims.delete(claim); };
    }

    /** An open preparation can be waiting on a child whose receipt has yet to arrive. */
    *claimedAssets(): IterableIterator<DependencyReceipt> {
        for (const { target } of this.claims_ ?? []) {
            yield { kind: 'owned', type: target.type, path: target.key };
        }
    }

    /** A pending acquisition can also close a cycle before its receipt arrives. */
    private reaches_(target: AssetDependencyOwner): boolean {
        if (this === target) return true;
        if (!this.claims_?.size) return false;
        const seen = new Set<AssetDependencyOwner>();
        const pending: AssetDependencyOwner[] = [this];
        while (pending.length) {
            const owner = pending.pop()!;
            if (owner === target) return true;
            if (seen.has(owner)) continue;
            seen.add(owner);
            for (const claim of owner.claims_ ?? []) pending.push(claim.target);
        }
        return false;
    }
}

/**
 * Whether a change to what this edge names can invalidate the era that recorded
 * it. A read is causality by definition; an acquisition only when it names an
 * addressable asset, since a composed resource has no content anyone can change
 * and its `composed:<handle>` identity is a debug name, not a lookup key.
 */
export function isInvalidatable(edge: DependencyReceipt): boolean {
    if (edge.kind === 'source') return true;
    return edge.type !== undefined;
}

/** What one preparation took, sealed onto what it produced. */
export interface Preparation {
    /** Everything it acquired; released when what it produced retires. */
    readonly dependencies: AssetScope;
    /** Every edge it produced, owned and source alike. */
    readonly edges: readonly DependencyReceipt[];
    /** An optional dependency was unavailable; initial degraded loads may run,
     * but a refresh must not replace a working era with one missing it. */
    readonly failedDependencies?: readonly string[];
}

export type AssetWithReceipts = AssetIdentity & Pick<Preparation, 'edges'>;

/** Resolve aliases against the same manifest once per spelling for this walk. */
export function cachedPaths<T extends string | null>(resolve: (path: string) => T): (path: string) => T {
    const paths = new Map<string, T>();
    return path => {
        let value = paths.get(path);
        if (value === undefined) {
            value = resolve(path);
            paths.set(path, value);
        }
        return value;
    };
}

/** A file reaches its readers AND its acquirers. Once an asset is reached,
 * only an acquisition of that specific type can lead to another generation. */
export function matchingDependents(
    eras: Iterable<AssetWithReceipts>, matches: (edge: DependencyReceipt) => boolean,
): AssetIdentity[] {
    const result: AssetIdentity[] = [];
    for (const era of eras) {
        if (era.edges.some(matches)) result.push({ type: era.type, path: era.path });
    }
    return result;
}

/** Index the typed acquisitions for the duration of one propagation. A probe
 * for a file with no live consumers never needs this table. */
export function ownedDependents(eras: Iterable<AssetWithReceipts>, canonical: (path: string) => string) {
    const byType = new Map<string, Map<string, AssetIdentity[]>>();
    for (const era of eras) {
        let owner: AssetIdentity | undefined;
        for (const edge of era.edges) {
            if (edge.kind !== 'owned' || edge.type === undefined) continue;
            const path = canonical(edge.path);
            let paths = byType.get(edge.type);
            if (!paths) {
                paths = new Map();
                byType.set(edge.type, paths);
            }
            owner ??= { type: era.type, path: era.path };
            const parents = paths.get(path);
            if (!parents) paths.set(path, [owner]);
            else if (parents[parents.length - 1] !== owner) parents.push(owner);
        }
    }
    return (asset: AssetIdentity): readonly AssetIdentity[] => byType.get(asset.type)?.get(canonical(asset.path)) ?? [];
}

interface Visit {
    readonly asset: AssetIdentity;
    readonly index: number;
    readonly parents: readonly AssetIdentity[];
    low: number;
    nextParent: number;
    open: boolean;
}

/**
 * Order the consumers of the changed files, deepest dependency first, each
 * cycle one group. All roots share one Tarjan traversal so an update visits a
 * shared consumer once. The explicit DFS stack also supports deep asset chains.
 */
export function rebuildPlan(
    roots: readonly AssetIdentity[], parentsOf: (asset: AssetIdentity) => readonly AssetIdentity[],
): AssetIdentity[][] {
    const visited = new Map<string, Visit>();
    const pending: Visit[] = [];
    const open: Visit[] = [];
    const groups: AssetIdentity[][] = [];
    function enter(asset: AssetIdentity, key: string): void {
        const index = visited.size;
        const node: Visit = { asset, index, low: index, parents: parentsOf(asset), nextParent: 0, open: true };
        visited.set(key, node);
        pending.push(node);
        open.push(node);
    }
    function finishGroup(root: Visit): void {
        const group: AssetIdentity[] = [];
        let member: Visit;
        do {
            member = open.pop()!;
            member.open = false;
            group.push(member.asset);
        } while (member !== root);
        groups.push(group);
    }
    function walk(root: AssetIdentity): void {
        const key = assetPairKey(root.type, root.path);
        if (visited.has(key)) return;
        enter(root, key);
        while (pending.length) {
            const node = pending[pending.length - 1];
            if (node.nextParent < node.parents.length) {
                const parent = node.parents[node.nextParent++];
                const parentKey = assetPairKey(parent.type, parent.path);
                const seen = visited.get(parentKey);
                if (!seen) enter(parent, parentKey);
                else if (seen.open) node.low = Math.min(node.low, seen.index);
                continue;
            }
            pending.pop();
            if (node.low === node.index) finishGroup(node);
            const caller = pending[pending.length - 1];
            if (caller) caller.low = Math.min(caller.low, node.low);
        }
    }
    for (const root of roots) walk(root);
    return groups.reverse();
}

/**
 * What a cached load produced, and what its preparation took — the same
 * sealing an era gets, for the asset kind whose current value lives in a cache
 * rather than under a slot's name.
 */
export type PreparedLoad<T> = Preparation & LoadGeneration & {
    readonly value: T;
    readonly owner: AssetDependencyOwner;
    readonly loader: AssetLoader<T>;
};

/** Internal rejection transport. Its sources belong to this preparation, not
 * to an Error object that several concurrent loaders may reuse. Public doors
 * rethrow the original reason, including primitive rejection values. */
export class PreparationFailure extends Error {
    constructor(readonly reason: unknown, readonly sources: readonly string[]) {
        super(reason instanceof Error ? reason.message : String(reason));
    }
    override toString(): string { return String(this.reason); }
}

export function preparationFailureReason(error: unknown): unknown {
    return error instanceof PreparationFailure ? error.reason : error;
}

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
    private readonly failed_ = new Set<string>();
    private state_: 'open' | 'committed' | 'rolled-back' = 'open';

    constructor(readonly owner?: AssetDependencyOwner) {}

    /** Reads already started and acquisitions already requested by this preparation. */
    pendingEdges(): readonly DependencyReceipt[] {
        return this.owner ? [...this.edges_, ...this.owner.claimedAssets()] : this.edges_;
    }

    /** A runtime resource this preparation now holds. */
    own<T>(path: string, lease: AssetLease<T>, type?: string): AssetLease<T> {
        if (this.state_ !== 'open') return this.late_(lease);
        this.acquired_.add(lease);
        path = (lease as Partial<BindingLease>)[leaseDependencyKey] ?? path;
        this.edges_.push(type === undefined ? { kind: 'owned', path } : { kind: 'owned', type, path });
        // The acquisition succeeded, but may hold a degraded preparation. Its
        // owned edge carries causality; its readiness must reach this owner too.
        for (const path of lease.failedDependencies ?? []) this.failed_.add(path);
        return lease;
    }

    /** Content or an index entry this preparation consulted to decide what to produce. */
    read(path: string): void {
        if (this.state_ !== 'open') return;
        this.edges_.push({ kind: 'source', path });
    }

    failed(path: string, error?: unknown): void {
        if (this.state_ !== 'open') return;
        this.read(path);
        this.failed_.add(path);
        if (error instanceof PreparationFailure) {
            for (const source of error.sources) this.read(source);
        }
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
        return { ...value, dependencies: this.acquired_, edges: this.edges_, failedDependencies: [...this.failed_] };
    }

    /** The preparation produced nothing, so it may keep nothing. */
    rollback(): void {
        this.state_ = 'rolled-back';
        try { this.acquired_.releaseAll(); } finally { this.edges_.length = 0; }
    }

    /** Roll back ownership while transporting the reads that caused failure. */
    abort(error: unknown): PreparationFailure {
        const sources = new Set(this.edges_.filter(isInvalidatable).map(edge => edge.path));
        const reason = preparationFailureReason(error);
        if (error instanceof PreparationFailure) for (const source of error.sources) {
            sources.add(source);
        }
        try { this.rollback(); }
        catch (cleanupError) { log.warn('asset', 'Preparation rollback cleanup failed', cleanupError); }
        return new PreparationFailure(reason, [...sources]);
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
