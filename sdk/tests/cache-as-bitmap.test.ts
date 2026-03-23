import { describe, it, expect, beforeEach } from 'vitest';
import {
    CacheAsBitmap,
    getCacheForEntity,
    setCacheForEntity,
    removeCacheForEntity,
    clearAllCaches,
    getCacheStoreSize,
} from '../src/cacheAsBitmap';
import type { BitmapCache } from '../src/cacheBitmap';

function mockCache(id: number): BitmapCache {
    return { textureId: id, width: 256, height: 256, valid: true, _rt: null };
}

describe('CacheAsBitmap', () => {
    beforeEach(() => {
        clearAllCaches();
    });

    it('component has correct defaults', () => {
        const defaults = CacheAsBitmap._default;
        expect(defaults.enabled).toBe(true);
        expect(defaults.dirty).toBe(true);
        expect(defaults.width).toBe(256);
        expect(defaults.height).toBe(256);
    });

    describe('cache store', () => {
        it('set and get cache', () => {
            const cache = mockCache(1);
            setCacheForEntity(10, cache);
            expect(getCacheForEntity(10)).toBe(cache);
        });

        it('returns undefined for missing entity', () => {
            expect(getCacheForEntity(999)).toBeUndefined();
        });

        it('remove cache', () => {
            const cache = mockCache(1);
            setCacheForEntity(10, cache);
            const removed = removeCacheForEntity(10);
            expect(removed).toBe(cache);
            expect(getCacheForEntity(10)).toBeUndefined();
        });

        it('clearAllCaches empties store', () => {
            setCacheForEntity(1, mockCache(1));
            setCacheForEntity(2, mockCache(2));
            expect(getCacheStoreSize()).toBe(2);
            clearAllCaches();
            expect(getCacheStoreSize()).toBe(0);
        });
    });
});
