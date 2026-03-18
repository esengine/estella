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

export class QueryCache {
    private structuralVersion_ = 0;
    private componentVersions_ = new Map<symbol, number>();
    private cache_ = new Map<string, CacheEntry>();

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
        if (cached && this.isValid_(cached, dependentComponentIds)) {
            return cached.result;
        }

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

    private isValid_(entry: CacheEntry, dependentComponentIds: symbol[]): boolean {
        if (entry.structuralVersion !== this.structuralVersion_) return false;
        for (const id of dependentComponentIds) {
            const current = this.componentVersions_.get(id) ?? 0;
            const cached = entry.componentVersions.get(id) ?? 0;
            if (current !== cached) return false;
        }
        return true;
    }
}
