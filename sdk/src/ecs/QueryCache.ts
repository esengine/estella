/**
 * @file    QueryCache.ts
 * @brief   Component-aware query result cache with fine-grained invalidation
 */

import { Entity } from '../types';

interface CacheEntry {
    structuralVersion: number;
    componentVersions: Map<symbol, number>;
    result: Entity[];
}

/** Cumulative counters for query-cache activity (observability only). */
export interface QueryCacheStats {
    /** Lookups that returned a still-valid cached result. */
    readonly hits: number;
    /** Lookups that recomputed — either no entry or stale. */
    readonly misses: number;
    /** Times an entry was found but rejected because structural version moved. */
    readonly structuralInvalidations: number;
    /** Times an entry was rejected because one of its dep components changed. */
    readonly componentInvalidations: number;
    /** Current number of entries held. */
    readonly size: number;
}

export class QueryCache {
    private structuralVersion_ = 0;
    private componentVersions_ = new Map<symbol, number>();
    private cache_ = new Map<string, CacheEntry>();

    private hits_ = 0;
    private misses_ = 0;
    private structuralInvalidations_ = 0;
    private componentInvalidations_ = 0;

    get structuralVersion(): number {
        return this.structuralVersion_;
    }

    markStructuralChange(): void {
        this.structuralVersion_++;
    }

    markComponentDirty(componentId: symbol): void {
        const cur = this.componentVersions_.get(componentId) ?? 0;
        this.componentVersions_.set(componentId, cur + 1);
    }

    invalidateAll(): void {
        this.structuralVersion_++;
    }

    getOrCompute(
        cacheKey: string,
        dependentComponentIds: symbol[],
        computeFn: () => Entity[],
    ): Entity[] {
        const cached = this.cache_.get(cacheKey);
        if (cached) {
            const validity = this.checkValidity_(cached, dependentComponentIds);
            if (validity === 0) {
                this.hits_++;
                return cached.result;
            }
            // 1 = structural, 2 = component — classify the miss for stats.
            if (validity === 1) this.structuralInvalidations_++;
            else this.componentInvalidations_++;
        }
        this.misses_++;

        const result = computeFn();

        const compVersions = new Map<symbol, number>();
        for (const id of dependentComponentIds) {
            compVersions.set(id, this.componentVersions_.get(id) ?? 0);
        }
        this.cache_.set(cacheKey, {
            structuralVersion: this.structuralVersion_,
            componentVersions: compVersions,
            result,
        });

        return result;
    }

    /** Snapshot of counters. Read-only; callers can diff across frames. */
    getStats(): QueryCacheStats {
        return {
            hits: this.hits_,
            misses: this.misses_,
            structuralInvalidations: this.structuralInvalidations_,
            componentInvalidations: this.componentInvalidations_,
            size: this.cache_.size,
        };
    }

    /** Reset counters without dropping cached entries. */
    resetStats(): void {
        this.hits_ = 0;
        this.misses_ = 0;
        this.structuralInvalidations_ = 0;
        this.componentInvalidations_ = 0;
    }

    /**
     * Returns 0 when the entry is still valid, 1 when structural version moved,
     * 2 when a dependent component changed.
     */
    private checkValidity_(entry: CacheEntry, dependentComponentIds: symbol[]): 0 | 1 | 2 {
        if (entry.structuralVersion !== this.structuralVersion_) return 1;
        for (const id of dependentComponentIds) {
            const current = this.componentVersions_.get(id) ?? 0;
            const cached = entry.componentVersions.get(id) ?? 0;
            if (current !== cached) return 2;
        }
        return 0;
    }
}
