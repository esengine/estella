// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    QueryCache.ts
 * @brief   Component-aware query result cache with fine-grained invalidation
 */

import type { Entity } from '../types';

interface CacheEntry {
    validatedAt: number;
    result: Entity[];
}

/** Cumulative counters for query-cache activity (observability only). */
export interface QueryCacheStats {
    /** Lookups that returned a still-valid cached result. */
    readonly hits: number;
    /** Lookups that recomputed — either no entry or stale. */
    readonly misses: number;
    /** Times an entry was rejected because one of its dep components changed. */
    readonly componentInvalidations: number;
    /** Current number of entries held. */
    readonly size: number;
}

export class QueryCache {
    private structuralVersion_ = 0;
    // All component stamps in this world share a clock so one stamp can date a whole result.
    private componentRevision_ = 0;
    private readonly componentVersions_ = new Map<symbol, number>();
    private cache_ = new Map<string, CacheEntry>();

    private hits_ = 0;
    private misses_ = 0;
    private componentInvalidations_ = 0;

    get structuralVersion(): number {
        return this.structuralVersion_;
    }

    // A monotonic "something structural happened" counter exposed as the world
    // version for coarse external gates (e.g. physics reconcile). It deliberately
    // does NOT invalidate cached queries — invalidation is per-component below, so
    // churn of unrelated entities never drops an unrelated query's result.
    markStructuralChange(): void {
        this.structuralVersion_++;
    }

    /** A component's current version — for a derived set that has to recompute
     *  when it moves, without standing up a second invalidation scheme. */
    componentVersion(componentId: symbol): number {
        return this.componentVersions_.get(componentId) ?? 0;
    }

    markComponentDirty(componentId: symbol): void {
        this.componentVersions_.set(componentId, ++this.componentRevision_);
    }

    /**
     * Drop every cached result. For changes no per-component version describes —
     * a reorder (see World.applyEntityOrder) moves entities within results that are
     * otherwise still correct, so nothing else would recompute them.
     */
    invalidateAll(): void {
        this.cache_ = new Map();
        this.structuralVersion_++;
    }

    /** The cached answer when it still stands, counted as a hit; null when it must be computed. What a caller asks
     *  first, so an answer that stands costs it no closure to compute one. */
    lookup(cacheKey: string, dependentComponentIds: symbol[]): Entity[] | null {
        const cached = this.cache_.get(cacheKey);
        if (!cached || !this.checkValidity_(cached, dependentComponentIds)) return null;
        this.hits_++;
        return cached.result;
    }

    getOrCompute(
        cacheKey: string,
        dependentComponentIds: symbol[],
        computeFn: () => Entity[],
    ): Entity[] {
        // A full invalidation during compute also discards the entry being built in this map.
        const entries = this.cache_;
        const cached = entries.get(cacheKey);
        if (cached) {
            if (this.checkValidity_(cached, dependentComponentIds)) {
                this.hits_++;
                return cached.result;
            }
            this.componentInvalidations_++;
        }
        this.misses_++;

        const validatedAt = this.componentRevision_;
        const result = computeFn();
        entries.set(cacheKey, { validatedAt, result });

        return result;
    }

    /** Snapshot of counters. Read-only; callers can diff across frames. */
    getStats(): QueryCacheStats {
        return {
            hits: this.hits_,
            misses: this.misses_,
            componentInvalidations: this.componentInvalidations_,
            size: this.cache_.size,
        };
    }

    /** Reset counters without dropping cached entries. */
    resetStats(): void {
        this.hits_ = 0;
        this.misses_ = 0;
        this.componentInvalidations_ = 0;
    }

    /** Inspect dependencies only on the first read after a component change. */
    private checkValidity_(entry: CacheEntry, dependentComponentIds: symbol[]): boolean {
        if (entry.validatedAt === this.componentRevision_) return true;
        for (const id of dependentComponentIds) {
            if (this.componentVersion(id) > entry.validatedAt) return false;
        }
        entry.validatedAt = this.componentRevision_;
        return true;
    }
}
