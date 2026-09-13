// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    disabled-entities.test.ts
 * @brief   A switched-off entity is out of the frame, not just marked.
 *
 *          `Disabled`'s doc promised that "the engine's systems skip it" and
 *          nothing read the tag: `setEntityActive(world, e, false)` returned,
 *          every query went on answering with the entity, and the only sign was
 *          a comment in ui/controller/ai-builtins admitting it. A query is where
 *          a system meets the world, so that is where the promise is kept.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent, defineTag, Disabled, Children } from '../src/ecs/component';
import { setEntityActive, isEntityActive } from '../src/ecs/entityUtils';
import type { Entity } from '../src/types';

const Health = defineComponent('TestHealth', { hp: 10 });
const Hostile = defineTag('TestHostile');

function worldWith(n: number): { world: World; entities: Entity[] } {
    const world = new World();
    const entities = Array.from({ length: n }, () => {
        const e = world.spawn();
        world.insert(e, Health, { hp: 10 });
        return e;
    });
    return { world, entities };
}

describe('a disabled entity', () => {
    it('is not answered by a query', () => {
        const { world, entities } = worldWith(3);
        expect(world.getEntitiesWithComponents([Health])).toHaveLength(3);

        setEntityActive(world, entities[1]!, false);
        const live = world.getEntitiesWithComponents([Health]);
        expect(live).toHaveLength(2);
        expect(live).not.toContain(entities[1]);

        setEntityActive(world, entities[1]!, true);
        expect(world.getEntitiesWithComponents([Health])).toHaveLength(3);
    });

    it('is seen by a query that asks for the tag', () => {
        const { world, entities } = worldWith(2);
        setEntityActive(world, entities[0]!, false);
        // Something has to be able to manage the switch — a query naming Disabled
        // is that something, and excluding them there would make it unanswerable.
        expect(world.getEntitiesWithComponents([Health, Disabled])).toEqual([entities[0]]);
    });

    it('marks itself and nothing else — the subtree is derived', () => {
        const { world, entities } = worldWith(2);
        setEntityActive(world, entities[0]!, false);
        // The tag says what the AUTHOR switched off; which entities that takes
        // out of a query is a walk down the tree, driven by the play-realm check
        // (a real hierarchy is the one thing a unit test has no engine for).
        expect(isEntityActive(world, entities[0]!)).toBe(false);
        expect(isEntityActive(world, entities[1]!)).toBe(true);
        expect(world.getEntitiesWithComponents([Health, Disabled])).toEqual([entities[0]]);
    });

    it('leaves the cached answer behind when it is switched', () => {
        const { world, entities } = worldWith(2);
        world.insert(entities[0]!, Hostile, {});
        world.insert(entities[1]!, Hostile, {});
        // Warm the cache, then switch: a query cache that does not depend on the
        // tag hands back the entity it already found.
        expect(world.getEntitiesWithComponents([Health], [Hostile])).toHaveLength(2);
        setEntityActive(world, entities[0]!, false);
        expect(world.getEntitiesWithComponents([Health], [Hostile])).toHaveLength(1);
    });

    it('is still a real entity — its components are readable', () => {
        const { world, entities } = worldWith(1);
        setEntityActive(world, entities[0]!, false);
        // Off is not gone: the scene still holds it, and switching it back on has
        // to find what it had. (Children is how the subtree walk reaches it.)
        expect(world.valid(entities[0]!)).toBe(true);
        expect((world.get(entities[0]!, Health) as { hp: number }).hp).toBe(10);
        expect(world.has(entities[0]!, Children)).toBe(false);
    });
});
