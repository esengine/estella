// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query-count-invariant.test.ts
 * @brief   Asking a query a question must not give a different answer than
 *          iterating it, and must not change the world.
 *
 *          Added()/Changed() are per-entity tick checks applied while iterating,
 *          not part of the entity set the query cache returns. count() read that
 *          set directly, so `Query(Changed(P)).count()` reported every entity
 *          holding P while `[...Query(Changed(P))].length` reported the changed
 *          ones. isEmpty() had the opposite problem: it ran the iterator, and one
 *          step of a Mut() query writes that entity back and records a Changed
 *          tick — so asking whether a query was empty marked an entity changed.
 *          The matrix crosses the filter kinds so no one of them can be fixed
 *          while another silently drifts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Query, QueryInstance, Added, Changed, Mut, Not, Or, With } from '../src/ecs/query';
import { defineComponent } from '../src/ecs/component';
import type { Entity } from '../src/types';

const P = defineComponent('CIPosition', { x: 0, y: 0 });
const V = defineComponent('CIVelocity', { dx: 0, dy: 0 });
const Tag = defineComponent('CITag', {});

/** Every query shape, built fresh per case so no cache state carries between them. */
const SHAPES: { name: string; build: () => ReturnType<typeof Query> }[] = [
    { name: 'plain', build: () => Query(P) },
    { name: 'two components', build: () => Query(P, V) },
    { name: 'with', build: () => Query(P).with(V) },
    { name: 'without', build: () => Query(P).without(Tag) },
    { name: 'Added', build: () => Query(Added(P)) },
    { name: 'Changed', build: () => Query(Changed(P)) },
    { name: 'Changed + Added', build: () => Query(Changed(P), Added(V)) },
    { name: 'Changed + without', build: () => Query(Changed(P)).without(Tag) },
    { name: 'Changed + with', build: () => Query(Changed(P)).with(V) },
    { name: 'Changed + filter tree', build: () => Query(Changed(P)).filter(Or(With(V), Not(With(Tag)))) },
    { name: 'filter tree alone', build: () => Query(P).filter(Or(With(V), Not(With(Tag)))) },
];

describe('count() equals what iterating yields', () => {
    let world: World;
    let entities: Entity[];

    beforeEach(() => {
        world = new World();
        entities = [];
        // Tracking has to be on before the writes below, or nothing records a tick
        // for Added()/Changed() to find. A QueryInstance enables it in its ctor,
        // which is too late for anything already written.
        world.enableChangeTracking(P);
        world.enableChangeTracking(V);
        // A spread of component combinations so every shape has both matches and
        // non-matches to tell apart.
        for (let i = 0; i < 12; i++) {
            const e = world.spawn();
            world.insert(e, P, { x: i, y: 0 });
            if (i % 2 === 0) world.insert(e, V, { dx: 1, dy: 0 });
            if (i % 3 === 0) world.insert(e, Tag, {});
            entities.push(e);
        }
    });

    /**
     * sinceTick moves what Added()/Changed() consider recent: -1 sees the seeding
     * writes, a tick past them sees nothing until something writes again.
     */
    for (const sinceTick of [-1, 0, 1]) {
        for (const shape of SHAPES) {
            it(`${shape.name} @ tick ${sinceTick}`, () => {
                world.advanceTick();
                const counted = new QueryInstance(world, shape.build(), sinceTick).count();
                const iterated = new QueryInstance(world, shape.build(), sinceTick).toArray().length;
                expect(counted).toBe(iterated);
            });
        }
    }

    it('a fresh write moves both count() and iteration together', () => {
        world.advanceTick();
        const tick = world.getWorldTick();
        world.advanceTick();

        const before = new QueryInstance(world, Query(Changed(P)), tick);
        expect(before.count()).toBe(0);
        expect(before.toArray()).toHaveLength(0);

        world.set(entities[0], P, { x: 99, y: 0 });
        world.set(entities[5], P, { x: 98, y: 0 });

        const after = new QueryInstance(world, Query(Changed(P)), tick);
        expect(after.count()).toBe(2);
        expect(after.count()).toBe(after.toArray().length);
    });

    it('count() with a change filter does not just report everything holding it', () => {
        world.advanceTick();
        const tick = world.getWorldTick();
        world.advanceTick();
        world.set(entities[3], P, { x: 1, y: 1 });

        const q = new QueryInstance(world, Query(Changed(P)), tick);
        expect(q.count()).toBe(1);
        // The pre-fix answer: every entity that has P at all.
        expect(q.count()).not.toBe(entities.length);
    });

    it('isEmpty() on a Mut query does not mark anything Changed', () => {
        world.advanceTick();
        const tick = world.getWorldTick();
        world.advanceTick();

        expect(new QueryInstance(world, Query(Mut(P)), -1).isEmpty()).toBe(false);

        // Taking one iterator step writes that entity back and records a tick for
        // it; asking whether the query is empty must not do that.
        expect(new QueryInstance(world, Query(Changed(P)), tick).toArray()).toHaveLength(0);
    });

    it('single() hands back its own row, not the buffer the next one overwrites', () => {
        const q = new QueryInstance(world, Query(P), -1);
        const first = q.single();
        const second = q.single();
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });

    it('isEmpty() agrees with count() === 0 under a change filter', () => {
        world.advanceTick();
        const tick = world.getWorldTick();
        world.advanceTick();

        const quiet = new QueryInstance(world, Query(Changed(P)), tick);
        expect(quiet.count()).toBe(0);
        expect(quiet.isEmpty()).toBe(true);

        world.set(entities[1], P, { x: 7, y: 7 });
        const busy = new QueryInstance(world, Query(Changed(P)), tick);
        expect(busy.count()).toBeGreaterThan(0);
        expect(busy.isEmpty()).toBe(false);
    });
});
