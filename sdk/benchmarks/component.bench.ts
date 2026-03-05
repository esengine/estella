import { bench, describe } from 'vitest';
import { defineComponent, getComponent, getAllRegisteredComponents, clearUserComponents } from '../src/component';
import { computeQueryCacheKey } from '../src/world';

describe('Component - Definition', () => {
    bench('defineComponent (simple)', () => {
        defineComponent(`BenchSimple_${Math.random()}`, { x: 0, y: 0 });
    });

    bench('defineComponent (nested objects)', () => {
        defineComponent(`BenchNested_${Math.random()}`, {
            position: { x: 0, y: 0 },
            color: { r: 1, g: 1, b: 1, a: 1 },
        });
    });
});

describe('Component - create() (instance creation)', () => {
    const Simple = defineComponent('BenchCreateSimple', { x: 0, y: 0, z: 0 });
    const Nested = defineComponent('BenchCreateNested', {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
    });

    bench('create simple x1000', () => {
        for (let i = 0; i < 1000; i++) Simple.create({ x: i, y: i });
    });

    bench('create nested x1000', () => {
        for (let i = 0; i < 1000; i++) Nested.create({ position: { x: i, y: i } });
    });

    bench('create with defaults x1000', () => {
        for (let i = 0; i < 1000; i++) Simple.create();
    });
});

describe('Component - Registry lookup', () => {
    for (let i = 0; i < 50; i++) {
        defineComponent(`LookupComp_${i}`, { value: i });
    }

    bench('getComponent (existing) x1000', () => {
        for (let i = 0; i < 1000; i++) getComponent(`LookupComp_${i % 50}`);
    });

    bench('getComponent (non-existing) x1000', () => {
        for (let i = 0; i < 1000; i++) getComponent('NonExistent');
    });

    bench('getAllRegisteredComponents', () => {
        getAllRegisteredComponents();
    });
});

describe('computeQueryCacheKey', () => {
    const A = defineComponent('CacheKeyA', {});
    const B = defineComponent('CacheKeyB', {});
    const C = defineComponent('CacheKeyC', {});
    const D = defineComponent('CacheKeyD', {});

    bench('2 components, no filters', () => {
        computeQueryCacheKey([A, B]);
    });

    bench('3 components + with filter', () => {
        computeQueryCacheKey([A, B, C], [D]);
    });

    bench('2 components + with + without', () => {
        computeQueryCacheKey([A, B], [C], [D]);
    });

    bench('cache key x1000', () => {
        for (let i = 0; i < 1000; i++) computeQueryCacheKey([A, B, C]);
    });
});
