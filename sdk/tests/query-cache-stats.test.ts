/**
 * @file    query-cache-stats.test.ts
 * @brief   QueryCache hit/miss/invalidation accounting.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { QueryCache } from '../src/ecs/QueryCache';

describe('QueryCache.getStats', () => {
    let cache: QueryCache;

    beforeEach(() => {
        cache = new QueryCache();
    });

    it('counts the first lookup as a miss', () => {
        let computed = 0;
        cache.getOrCompute('q1', [], () => { computed++; return []; });
        const s = cache.getStats();
        expect(s.misses).toBe(1);
        expect(s.hits).toBe(0);
        expect(s.size).toBe(1);
        expect(computed).toBe(1);
    });

    it('counts a repeated lookup as a hit', () => {
        let computed = 0;
        cache.getOrCompute('q1', [], () => { computed++; return []; });
        cache.getOrCompute('q1', [], () => { computed++; return []; });
        expect(computed).toBe(1);
        const s = cache.getStats();
        expect(s.hits).toBe(1);
        expect(s.misses).toBe(1);
    });

    it('attributes a structural-change miss to structuralInvalidations', () => {
        cache.getOrCompute('q1', [], () => []);
        cache.markStructuralChange();
        cache.getOrCompute('q1', [], () => []);
        const s = cache.getStats();
        expect(s.structuralInvalidations).toBe(1);
        expect(s.componentInvalidations).toBe(0);
    });

    it('attributes a component-dirty miss to componentInvalidations', () => {
        const comp = Symbol('Position');
        cache.getOrCompute('q1', [comp], () => []);
        cache.markComponentDirty(comp);
        cache.getOrCompute('q1', [comp], () => []);
        const s = cache.getStats();
        expect(s.componentInvalidations).toBe(1);
        expect(s.structuralInvalidations).toBe(0);
    });

    it('resetStats zeroes counters but keeps cached entries', () => {
        cache.getOrCompute('q1', [], () => [1, 2, 3]);
        cache.getOrCompute('q1', [], () => [99]);  // hit
        cache.resetStats();

        const s = cache.getStats();
        expect(s.hits).toBe(0);
        expect(s.misses).toBe(0);
        expect(s.size).toBe(1);

        let called = false;
        cache.getOrCompute('q1', [], () => { called = true; return []; });
        expect(called).toBe(false);
        expect(cache.getStats().hits).toBe(1);
    });

    it('size reflects entry count independent of hit/miss volume', () => {
        cache.getOrCompute('q1', [], () => []);
        cache.getOrCompute('q2', [], () => []);
        cache.getOrCompute('q1', [], () => []);
        cache.getOrCompute('q2', [], () => []);
        expect(cache.getStats().size).toBe(2);
    });
});
