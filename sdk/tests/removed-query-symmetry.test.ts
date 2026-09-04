// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    removed-query-symmetry.test.ts
 * @brief   Losing a component has to mean one thing, whichever way it was lost
 *          and whichever kind of component it is.
 *
 *          Removal reaches the tracker two ways: recordRemoved(def) for an
 *          explicit remove() and for builtins on despawn, recordRemovedById(id)
 *          for script components on despawn. Both must answer to the same gate —
 *          a component with a registered history reader records, one without
 *          records nothing — or the same despawn is history one way and gone the
 *          other.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { RemovedQueryInstance } from '../src/ecs/query';
import { defineComponent } from '../src/ecs/component';

const Sc = defineComponent('RQSScript', { v: 0 });

/** A reader that holds `Sc`'s history from now on, and what it can see. */
function readerFor(world: World): () => number[] {
    const inst = new RemovedQueryInstance(world, Sc, -1);
    inst.activateRetention();
    return () => inst.toArray();
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

        // Nothing registered a reader, so neither road stored a row at all.
        expect(despawned.getRemovedEntitiesSince(Sc, -1)).toEqual([]);
        expect(removed.getRemovedEntitiesSince(Sc, -1)).toEqual([]);
    });

    it('a component with a reader records both ways', () => {
        const world = new World();
        const read = readerFor(world);

        const viaDespawn = world.spawn();
        world.insert(viaDespawn, Sc, { v: 1 });
        const viaRemove = world.spawn();
        world.insert(viaRemove, Sc, { v: 2 });

        world.despawn(viaDespawn);
        world.remove(viaRemove, Sc);

        expect(read().sort()).toEqual([viaDespawn, viaRemove].sort());
    });

    it('history starts when a reader asks, not retroactively', () => {
        const world = new World();
        const before = world.spawn();
        world.insert(before, Sc, { v: 1 });
        world.despawn(before);

        // A reader does not inherit what happened before it existed.
        const read = readerFor(world);
        expect(read()).toEqual([]);

        const after = world.spawn();
        world.insert(after, Sc, { v: 2 });
        world.despawn(after);
        expect(read()).toEqual([after]);
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
