// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    removed-query-symmetry.test.ts
 * @brief   Losing a component has to mean one thing, whichever way it was lost
 *          and whichever kind of component it is.
 *
 *          Removal reaches the tracker two ways: recordRemoved(def) for an
 *          explicit remove() and for builtins on despawn, recordRemovedById(id)
 *          for script components on despawn. Only the first checked whether
 *          anything tracks the component, so an untracked script component
 *          accumulated a removal record on every despawn — and a Removed() query
 *          created later reported despawns from before it existed, while the same
 *          query over a builtin, or over the same component removed explicitly,
 *          reported nothing.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { RemovedQueryInstance } from '../src/ecs/query';
import { defineComponent } from '../src/ecs/component';

const Sc = defineComponent('RQSScript', { v: 0 });

function removedSince(world: World, tick: number): number[] {
    return new RemovedQueryInstance(world, Sc, tick).toArray();
}

describe('Removed() records only what something is tracking', () => {
    it('an untracked component records nothing, however it is lost', () => {
        const despawned = new World();
        const a = despawned.spawn();
        despawned.insert(a, Sc, { v: 1 });
        despawned.despawn(a);

        const removed = new World();
        const b = removed.spawn();
        removed.insert(b, Sc, { v: 1 });
        removed.remove(b, Sc);

        expect(removedSince(despawned, -1)).toEqual([]);
        expect(removedSince(removed, -1)).toEqual([]);
    });

    it('a tracked component records both ways', () => {
        const world = new World();
        world.enableChangeTracking(Sc);

        const viaDespawn = world.spawn();
        world.insert(viaDespawn, Sc, { v: 1 });
        const viaRemove = world.spawn();
        world.insert(viaRemove, Sc, { v: 2 });

        world.despawn(viaDespawn);
        world.remove(viaRemove, Sc);

        expect(removedSince(world, -1).sort()).toEqual([viaDespawn, viaRemove].sort());
    });

    it('tracking starts when something asks, not retroactively', () => {
        const world = new World();
        const before = world.spawn();
        world.insert(before, Sc, { v: 1 });
        world.despawn(before);

        // The query's own ctor is what enables tracking.
        expect(removedSince(world, -1)).toEqual([]);

        const after = world.spawn();
        world.insert(after, Sc, { v: 2 });
        world.despawn(after);
        expect(removedSince(world, -1)).toEqual([after]);
    });

    it('losing a tracked component still moves the anyChangedSince watermark', () => {
        const world = new World();
        world.enableChangeTracking(Sc);
        const e = world.spawn();
        world.insert(e, Sc, { v: 1 });
        world.advanceTick();
        const tick = world.getWorldTick();
        world.advanceTick();

        expect(world.anyChangedSince(Sc, tick)).toBe(false);
        world.despawn(e);
        // Removal IS a change: a consumer gating work on this watermark has to
        // learn the component is gone (UI layout does exactly that).
        expect(world.anyChangedSince(Sc, tick)).toBe(true);
    });
});
