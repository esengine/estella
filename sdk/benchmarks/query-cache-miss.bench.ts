import { describe, bench } from 'vitest';
import { World } from '../src/world';
import { defineComponent } from '../src/component';

const A = defineComponent('CMA', { v: 0 });
const B = defineComponent('CMB', { v: 0 });
const C = defineComponent('CMC', { v: 0 });
const D = defineComponent('CMD', { v: 0 });

function makeWorld(n: number) {
    const world = new World();
    for (let i = 0; i < n; i++) {
        const e = world.spawn();
        world.insert(e, A, { v: i });
        if (i % 2 === 0) world.insert(e, B, { v: i });
        if (i % 3 === 0) world.insert(e, C, { v: i });
        if (i % 5 === 0) world.insert(e, D, { v: i });
    }
    return world;
}

describe('Query cache miss - isolate query cost (2000 entities)', () => {
    const world = makeWorld(2000);

    bench('cache hit (baseline)', () => {
        world.getEntitiesWithComponents([A], [], []);
    });

    bench('cache miss: 1 comp (force version bump)', () => {
        (world as any).worldVersion_++;
        world.getEntitiesWithComponents([A], [], []);
    });

    bench('cache miss: 2 comp', () => {
        (world as any).worldVersion_++;
        world.getEntitiesWithComponents([A, B], [], []);
    });

    bench('cache miss: 2 comp + without filter', () => {
        (world as any).worldVersion_++;
        world.getEntitiesWithComponents([A, B], [], [C]);
    });

    bench('cache miss: 3 comp', () => {
        (world as any).worldVersion_++;
        world.getEntitiesWithComponents([A, B, C], [], []);
    });
});

describe('Query cache miss - scale by entity count', () => {
    const w500 = makeWorld(500);
    const w2000 = makeWorld(2000);
    const w5000 = makeWorld(5000);
    const w10000 = makeWorld(10000);

    bench('500 entities, 2 comp miss', () => {
        (w500 as any).worldVersion_++;
        w500.getEntitiesWithComponents([A, B], [], []);
    });

    bench('2000 entities, 2 comp miss', () => {
        (w2000 as any).worldVersion_++;
        w2000.getEntitiesWithComponents([A, B], [], []);
    });

    bench('5000 entities, 2 comp miss', () => {
        (w5000 as any).worldVersion_++;
        w5000.getEntitiesWithComponents([A, B], [], []);
    });

    bench('10000 entities, 2 comp miss', () => {
        (w10000 as any).worldVersion_++;
        w10000.getEntitiesWithComponents([A, B], [], []);
    });
});

describe('Query cache miss - has() breakdown', () => {
    const world = makeWorld(2000);
    const entities: number[] = [];
    for (const [e] of (world as any).entities_) entities.push(e);
    const storage = (world as any).tsStorage_.get(A._id) as Map<number, unknown>;

    bench('Map.has() x2000 (direct storage)', () => {
        for (let i = 0; i < entities.length; i++) {
            storage.has(entities[i] as any);
        }
    });

    bench('world.has() x2000 (through dispatch)', () => {
        for (let i = 0; i < entities.length; i++) {
            world.has(entities[i] as any, A);
        }
    });

    bench('entities.slice() x2000', () => {
        entities.slice();
    });

    bench('Array.push x2000', () => {
        const arr: number[] = [];
        for (let i = 0; i < entities.length; i++) {
            arr.push(entities[i]);
        }
    });
});
