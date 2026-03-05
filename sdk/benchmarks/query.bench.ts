import { bench, describe } from 'vitest';
import { World } from '../src/world';
import { defineComponent } from '../src/component';
import { QueryInstance, Query, Mut } from '../src/query';
import { Entity } from '../src/types';

const Position = defineComponent('QBenchPosition', { x: 0, y: 0 });
const Velocity = defineComponent('QBenchVelocity', { vx: 0, vy: 0 });
const Health = defineComponent('QBenchHealth', { hp: 100 });

describe('Query - Iteration (5000 entities, 2 components)', () => {
    const world = new World();
    for (let i = 0; i < 5000; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        world.insert(e, Velocity, { vx: 1, vy: 1 });
    }

    bench('forEach', () => {
        world.resetQueryPool();
        const q = new QueryInstance(world, Query(Position, Velocity));
        q.forEach(() => {});
    });

    bench('for-of', () => {
        world.resetQueryPool();
        const q = new QueryInstance(world, Query(Position, Velocity));
        for (const _ of q) { /* noop */ }
    });

    bench('toArray', () => {
        world.resetQueryPool();
        const q = new QueryInstance(world, Query(Position, Velocity));
        q.toArray();
    });

    bench('count', () => {
        world.resetQueryPool();
        const q = new QueryInstance(world, Query(Position, Velocity));
        q.count();
    });
});

describe('Query - Mutable iteration (1000 entities)', () => {
    const world = new World();
    for (let i = 0; i < 1000; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        world.insert(e, Velocity, { vx: 1, vy: 1 });
    }

    bench('Mut query', () => {
        world.resetQueryPool();
        const q = new QueryInstance(world, Query(Mut(Position), Velocity));
        for (const [_e, pos, vel] of q) {
            (pos as any).x += (vel as any).vx;
            (pos as any).y += (vel as any).vy;
        }
    });
});

describe('Query - Sparse matching (100/10000 match)', () => {
    const world = new World();
    for (let i = 0; i < 10000; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        if (i % 100 === 0) world.insert(e, Health, { hp: 50 });
    }

    bench('query sparse component', () => {
        world.resetQueryPool();
        const q = new QueryInstance(world, Query(Position, Health));
        for (const _ of q) { /* noop */ }
    });
});
