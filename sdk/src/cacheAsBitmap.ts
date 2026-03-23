/**
 * @file    cacheAsBitmap.ts
 * @brief   CacheAsBitmap component for caching entity subtrees as bitmaps
 */

import { defineComponent, type ComponentDef } from './component';
import type { BitmapCache } from './cacheBitmap';

// =============================================================================
// Component
// =============================================================================

export interface CacheAsBitmapData {
    enabled: boolean;
    dirty: boolean;
    width: number;
    height: number;
}

export const CacheAsBitmap: ComponentDef<CacheAsBitmapData> = defineComponent('CacheAsBitmap', {
    enabled: true,
    dirty: true,
    width: 256,
    height: 256,
});

// =============================================================================
// Cache Store
// =============================================================================

const cacheStore = new Map<number, BitmapCache>();

export function getCacheForEntity(entityId: number): BitmapCache | undefined {
    return cacheStore.get(entityId);
}

export function setCacheForEntity(entityId: number, cache: BitmapCache): void {
    cacheStore.set(entityId, cache);
}

export function removeCacheForEntity(entityId: number): BitmapCache | undefined {
    const cache = cacheStore.get(entityId);
    if (cache) {
        cacheStore.delete(entityId);
    }
    return cache;
}

export function clearAllCaches(): void {
    cacheStore.clear();
}

export function getCacheStoreSize(): number {
    return cacheStore.size;
}
