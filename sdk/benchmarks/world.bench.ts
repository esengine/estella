import { bench, describe } from 'vitest';
import { World } from '../src/world';
import { defineComponent } from '../src/component';
import { Entity } from '../src/types';

const Position = defineComponent('BenchPosition', { x: 0, y: 0 });
const Velocity = defineComponent('BenchVelocity', { vx: 0, vy: 0 });
const Health = defineComponent('BenchHealth', { hp: 100, maxHp: 100 });
const Tag = defineComponent('BenchTag', {});

function createWorld(count: number, withVelocity = false, withHealth = false): { world: World; entities: Entity[] } {
    const world = new World();
    const entities: Entity[] = [];
    for (let i = 0; i < count; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        if (withVelocity) world.insert(e, Velocity, { vx: 1, vy: 1 });
        if (withHealth && i % 2 === 0) world.insert(e, Health);
        entities.push(e);
    }
    return { world, entities };
}

describe('World - Entity lifecycle', () => {
    bench('spawn single entity', () => {
        const world = new World();
        world.spawn();
    });

    bench('spawn + despawn single entity', () => {
        const world = new World();
        const e = world.spawn();
        world.despawn(e);
    });

    bench('spawn 1000 entities', () => {
        const world = new World();
        for (let i = 0; i < 1000; i++) {
            world.spawn();
        }
    });
});

describe('World - Component insert', () => {
    bench('insert 1 component to 1000 entities', () => {
        const world = new World();
        const entities: Entity[] = [];
        for (let i = 0; i < 1000; i++) entities.push(world.spawn());
        for (const e of entities) {
            world.insert(e, Position, { x: 1, y: 2 });
        }
    });

    bench('insert 3 components to 1000 entities', () => {
        const world = new World();
        const entities: Entity[] = [];
        for (let i = 0; i < 1000; i++) entities.push(world.spawn());
        for (const e of entities) {
            world.insert(e, Position, { x: 1, y: 2 });
            world.insert(e, Velocity, { vx: 3, vy: 4 });
            world.insert(e, Health);
        }
    });
});

describe('World - Component access (1000 entities)', () => {
    const { world, entities } = createWorld(1000, true, true);

    bench('get x1000', () => {
        for (const e of entities) world.get(e, Position);
    });

    bench('has x1000', () => {
        for (const e of entities) world.has(e, Position);
    });

    bench('tryGet x1000', () => {
        for (const e of entities) world.tryGet(e, Health);
    });

    bench('set x1000', () => {
        for (const e of entities) world.set(e, Position, { x: 99, y: 99 });
    });
});

describe('World - Query (5000 entities)', () => {
    const world = new World();
    for (let i = 0; i < 5000; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        if (i % 2 === 0) world.insert(e, Velocity, { vx: 1, vy: 1 });
        if (i % 3 === 0) world.insert(e, Health);
        if (i % 5 === 0) world.insert(e, Tag);
    }

    bench('query 1 component (5000 match)', () => {
        world.resetQueryPool();
        world.getEntitiesWithComponents([Position]);
    });

    bench('query 2 components (2500 match)', () => {
        world.resetQueryPool();
        world.getEntitiesWithComponents([Position, Velocity]);
    });

    bench('query with filter (without)', () => {
        world.resetQueryPool();
        world.getEntitiesWithComponents([Position], [], [Health]);
    });

    bench('query cache hit (2nd call same version)', () => {
        world.resetQueryPool();
        world.getEntitiesWithComponents([Position, Velocity]);
        world.resetQueryPool();
        world.getEntitiesWithComponents([Position, Velocity]);
    });
});

describe('World - Change detection (1000 entities)', () => {
    const { world, entities } = createWorld(1000);
    world.advanceTick();

    bench('isAddedSince x1000', () => {
        for (const e of entities) world.isAddedSince(e, Position, 0);
    });

    bench('isChangedSince x1000', () => {
        for (const e of entities) world.isChangedSince(e, Position, 0);
    });
});
