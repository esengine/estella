// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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

    it('does not invalidate a cached query on a bare structural change', () => {
        // markStructuralChange only advances the world version for coarse external
        // gates (physics); query invalidation is per-component. A query whose
        // dependent components are untouched must survive structural churn.
        let computed = 0;
        cache.getOrCompute('q1', [], () => { computed++; return []; });
        cache.markStructuralChange();
        cache.getOrCompute('q1', [], () => { computed++; return []; });
        expect(computed).toBe(1);
        const s = cache.getStats();
        expect(s.hits).toBe(1);
        expect(s.componentInvalidations).toBe(0);
    });

    it('attributes a component-dirty miss to componentInvalidations', () => {
        const comp = Symbol('Position');
        cache.getOrCompute('q1', [comp], () => []);
        cache.markComponentDirty(comp);
        cache.getOrCompute('q1', [comp], () => []);
        const s = cache.getStats();
        expect(s.componentInvalidations).toBe(1);
    });

    it('revalidates each entry against its own dependencies after intervening edits', () => {
        const position = Symbol('Position');
        const sprite = Symbol('Sprite');
        const mesh = Symbol('Mesh');
        const sprites = [position, sprite];
        const meshes = [position, mesh];
        const spriteRows = cache.getOrCompute('sprites', sprites, () => [1]);
        cache.getOrCompute('meshes', meshes, () => [2]);

        cache.markComponentDirty(mesh);
        cache.markComponentDirty(Symbol('Audio'));
        expect(cache.lookup('sprites', sprites)).toBe(spriteRows);
        expect(cache.lookup('sprites', sprites)).toBe(spriteRows);
        expect(cache.lookup('meshes', meshes)).toBeNull();
        const meshRows = cache.getOrCompute('meshes', meshes, () => [2, 3]);
        expect(cache.lookup('meshes', [mesh, position])).toBe(meshRows);
        expect(cache.getStats()).toEqual({ hits: 3, misses: 3, componentInvalidations: 1, size: 2 });

        cache.markComponentDirty(position);
        expect(cache.lookup('meshes', meshes)).toBeNull();
        expect(cache.lookup('sprites', sprites)).toBeNull();
    });

    it('detects a dependency changed while the result was being built', () => {
        const deps = [Symbol('Position')];
        cache.getOrCompute('q', deps, () => {
            cache.markComponentDirty(deps[0]);
            return [1];
        });
        expect(cache.lookup('q', deps)).toBeNull();
        const current = cache.getOrCompute('q', deps, () => [1, 2]);
        expect(cache.lookup('q', deps)).toBe(current);
    });

    it('keeps a full invalidation made during a rebuild', () => {
        cache.getOrCompute('q', [], () => {
            cache.invalidateAll();
            return [1];
        });
        expect(cache.getStats().size).toBe(0);
        expect(cache.lookup('q', [])).toBeNull();
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
