import { describe, bench } from 'vitest';
import { World } from '../src/world';
import { defineComponent } from '../src/component';

const Position = defineComponent('BenchWIPos', { x: 0, y: 0 });
const Velocity = defineComponent('BenchWIVel', { dx: 0, dy: 0 });
const Health = defineComponent('BenchWIHp', { value: 100 });

describe('World internals - valid() check', () => {
    const world = new World();
    const entities: number[] = [];
    for (let i = 0; i < 1000; i++) {
        entities.push(world.spawn());
    }
    const invalidEntity = 99999;

    bench('valid (existing) x1000', () => {
        for (let i = 0; i < 1000; i++) {
            world.valid(entities[i] as any);
        }
    });

    bench('valid (non-existing) x1000', () => {
        for (let i = 0; i < 1000; i++) {
            world.valid(invalidEntity as any);
        }
    });
});

describe('World internals - per-frame operations', () => {
    const world = new World();
    for (let i = 0; i < 500; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
    }

    bench('advanceTick', () => {
        world.advanceTick();
    });

    bench('resetQueryPool', () => {
        world.resetQueryPool();
    });

    bench('cleanRemovedBuffer (nothing to clean)', () => {
        world.cleanRemovedBuffer(2);
    });
});

describe('World internals - getEntitiesWithComponents (cache behavior)', () => {
    const world = new World();
    for (let i = 0; i < 2000; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        if (i % 2 === 0) world.insert(e, Velocity, { dx: 1, dy: 1 });
        if (i % 3 === 0) world.insert(e, Health, { value: 100 });
    }

    bench('1 comp cache hit x100', () => {
        for (let i = 0; i < 100; i++) {
            world.getEntitiesWithComponents([Position], [], []);
        }
    });

    bench('2 comp cache hit x100', () => {
        for (let i = 0; i < 100; i++) {
            world.getEntitiesWithComponents([Position, Velocity], [], []);
        }
    });

    bench('with + without filter cache hit x100', () => {
        for (let i = 0; i < 100; i++) {
            world.getEntitiesWithComponents([Position], [Velocity], [Health]);
        }
    });

    bench('cache miss (after version bump) x100', () => {
        for (let i = 0; i < 100; i++) {
            const e = world.spawn();
            world.insert(e, Position, { x: 0, y: 0 });
            world.getEntitiesWithComponents([Position], [], []);
            world.despawn(e);
        }
    });
});

describe('World internals - insert + remove cycle (script components)', () => {
    const world = new World();
    const entities: number[] = [];
    for (let i = 0; i < 200; i++) {
        entities.push(world.spawn());
    }

    bench('insert + remove x200', () => {
        for (let i = 0; i < 200; i++) {
            world.insert(entities[i] as any, Position, { x: i, y: i });
        }
        for (let i = 0; i < 200; i++) {
            world.remove(entities[i] as any, Position);
        }
    });
});

describe('World internals - entityComponents tracking', () => {
    const world = new World();
    const entities: number[] = [];
    for (let i = 0; i < 500; i++) {
        const e = world.spawn();
        entities.push(e);
        world.insert(e as any, Position, { x: 0, y: 0 });
        world.insert(e as any, Velocity, { dx: 0, dy: 0 });
        world.insert(e as any, Health, { value: 100 });
    }

    bench('has x1000 (3 comp entities)', () => {
        for (let i = 0; i < 500; i++) {
            world.has(entities[i] as any, Position);
            world.has(entities[i] as any, Health);
        }
    });

    bench('get x1000 (3 comp entities)', () => {
        for (let i = 0; i < 500; i++) {
            world.get(entities[i] as any, Position);
            world.get(entities[i] as any, Velocity);
        }
    });
});

describe('World internals - spawn + despawn throughput', () => {
    const world = new World();

    bench('spawn+insert+despawn x100', () => {
        for (let i = 0; i < 100; i++) {
            const e = world.spawn();
            world.insert(e, Position, { x: i, y: i });
            world.insert(e, Velocity, { dx: 1, dy: 1 });
            world.despawn(e);
        }
    });
});
