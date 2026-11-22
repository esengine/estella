// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { Disabled, Transform, defineTag } from '../src/ecs/component';
import { Query, QueryInstance, Without } from '../src/ecs/query';
import { World } from '../src/ecs/world';

const Hidden = defineTag('QueryPopulationHidden');
const Selected = defineTag('QueryPopulationSelected');
const Missing = defineTag('QueryPopulationMissing');

describe('queries over the world population', () => {
    it('refreshes bare and negative-only queries on spawn and despawn', () => {
        const world = new World();
        const first = world.spawn();
        world.insert(first, Selected);
        const tagged = world.getEntitiesWithComponents([Selected]);
        const all = world.getEntitiesWithComponents([]);
        const negative = new QueryInstance(world, Query().filter(Without(Hidden)));
        expect(negative.count()).toBe(1);
        expect(world.getEntitiesWithComponents([], [], [Hidden])).toEqual([first]);

        const second = world.spawn();
        expect(world.getEntitiesWithComponents([])).toEqual([first, second]);
        expect(world.getEntitiesWithComponents([Selected])).toBe(tagged);
        expect(world.getEntitiesWithComponents([], [], [Hidden])).toEqual([first, second]);
        expect(negative.count()).toBe(2);
        world.despawn(first);
        expect(world.getEntitiesWithComponents([])).toEqual([second]);
        expect(negative.count()).toBe(1);
        expect(all).toEqual([first]);
    });

    it('publishes reserved identities to queries at commit, before spawn callbacks', () => {
        const world = new World();
        const first = world.spawn();
        const warm = world.getEntitiesWithComponents([]);
        const reserved = world.reserveEntity();
        expect(world.valid(reserved)).toBe(true);
        expect(world.getAllEntities()).toEqual([first, reserved]);
        expect(world.getEntitiesWithComponents([])).toBe(warm);
        expect(world.getEntitiesWithComponents([], [], [Missing])).toEqual([first]);
        const cancelled = world.reserveEntity();
        world.despawn(cancelled);
        expect(world.getEntitiesWithComponents([])).toBe(warm);
        const snapshots: (readonly number[])[] = [];
        world.onSpawn(() => { snapshots.push(world.getEntitiesWithComponents([])); });
        world.commitReservedSpawn(reserved);
        world.commitReservedSpawn(reserved);
        world.commitReservedSpawn(cancelled);
        expect(snapshots).toEqual([[first, reserved]]);
        expect(world.getEntitiesWithComponents([], [], [Missing])).toEqual([first, reserved]);
    });

    it('honors every exclusion even when an earlier component has no storage or core', () => {
        const world = new World();
        const first = world.spawn();
        const second = world.spawn();
        world.insert(first, Selected);
        world.insert(second, Selected);
        world.insert(second, Hidden);
        expect(world.getEntitiesWithComponents([Selected], [], [Missing, Hidden])).toEqual([first]);
        expect(world.getEntitiesWithComponents([Selected], [], [Transform, Hidden])).toEqual([first]);
    });

    it('keeps filter-only results in world order across sparse and dense edits', () => {
        const world = new World();
        const entities = Array.from({ length: 64 }, () => world.spawn());
        const [first, middle, last] = [entities[2], entities[17], entities[40]];
        for (const e of [last, first, middle]) world.insert(e, Selected);
        const selection = () => world.getEntitiesWithComponents([], [Selected], [Hidden]);
        expect(selection()).toEqual([first, middle, last]);
        world.applyEntityOrder([middle, middle, last]);
        expect(selection()).toEqual([middle, last, first]);
        const late = world.spawn();
        world.insert(late, Selected);
        expect(selection()).toEqual([middle, last, first, late]);
        world.insert(last, Disabled);
        world.insert(first, Hidden);
        expect(selection()).toEqual([middle, late]);
        for (const e of entities) world.insert(e, Selected);
        expect(selection()).toEqual(world.getAllEntities().filter(e => e !== last && e !== first));
    });
});
