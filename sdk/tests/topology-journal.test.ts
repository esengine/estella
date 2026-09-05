// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The membership journal: who gained or lost a component, and who owns
 *        that history.
 *
 * Separate from change tracking on purpose. A consumer that follows arrivals and
 * departures should not have to enrol the component in `Changed` tracking and
 * pay that tax on every field write — which is the whole reason this exists
 * rather than `Added()` plus `Removed()`.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';

const Mark = defineComponent('TjMark', { v: 0 });
const Other = defineComponent('TjOther', { v: 0 });

describe('membership journal', () => {
    it('records arrivals and departures without ordinary change tracking', () => {
        const world = new World();
        world.advanceTick();
        const floor = world.getWorldTick() - 1;
        world.registerTopologyReaderFrom(Mark, floor + 1);

        const e = world.spawn();
        world.insert(e, Mark, { v: 1 });
        world.remove(e, Mark);

        expect(world.getTopologyChangedEntitiesSince(Mark, floor)).toEqual([e, e]);
        // The value path was never enrolled, so it costs nothing and says nothing.
        expect(world.isChangedSince(e, Mark, floor)).toBe(false);
    });

    it('writes nothing for a component nobody watches', () => {
        const world = new World();
        world.advanceTick();
        const floor = world.getWorldTick() - 1;
        const e = world.spawn();
        world.insert(e, Mark, { v: 1 });
        world.remove(e, Mark);

        expect(world.getTopologyChangedEntitiesSince(Mark, floor)).toEqual([]);
    });

    it('does not record an ordinary field write', () => {
        const world = new World();
        world.advanceTick();
        const floor = world.getWorldTick() - 1;
        world.registerTopologyReaderFrom(Mark, floor + 1);
        const e = world.spawn();
        world.insert(e, Mark, { v: 1 });

        world.update(e, Mark, (d) => { d.v = 2; });
        world.set(e, Mark, { v: 3 });

        // One row: the insert. Membership did not move again.
        expect(world.getTopologyChangedEntitiesSince(Mark, floor)).toEqual([e]);
    });

    it('holds history to the lowest claim on that component', () => {
        const world = new World();
        world.advanceTick();
        const early = world.getWorldTick() - 1;
        const slow = world.registerTopologyReaderFrom(Mark, early + 1);
        const fast = world.registerTopologyReaderFrom(Mark, early + 1);

        const e = world.spawn();
        world.insert(e, Mark, { v: 1 });
        const at = world.getWorldTick();

        // The fast one is done; the slow one has not read, so the row stays.
        world.advanceTopologyReader(Mark, fast, at);
        expect(world.getTopologyChangedEntitiesSince(Mark, early)).toEqual([e]);

        world.advanceTopologyReader(Mark, slow, at);
        expect(world.getTopologyChangedEntitiesSince(Mark, early)).toEqual([]);
    });

    it('lets go at once when the slow reader is disposed', () => {
        const world = new World();
        world.advanceTick();
        const early = world.getWorldTick() - 1;
        const slow = world.registerTopologyReaderFrom(Mark, early + 1);
        const fast = world.registerTopologyReaderFrom(Mark, early + 1);

        const e = world.spawn();
        world.insert(e, Mark, { v: 1 });
        world.advanceTopologyReader(Mark, fast, world.getWorldTick());
        expect(world.getTopologyChangedEntitiesSince(Mark, early)).toEqual([e]);

        world.disposeTopologyReader(Mark, slow);
        expect(world.getTopologyChangedEntitiesSince(Mark, early)).toEqual([]);
        expect(world.topologyReaderCount(Mark)).toBe(1);
    });

    it('a slow reader of one component does not pin another', () => {
        const world = new World();
        world.advanceTick();
        const early = world.getWorldTick() - 1;
        const fast = world.registerTopologyReaderFrom(Mark, early + 1);
        world.registerTopologyReaderFrom(Other, early + 1);

        const a = world.spawn();
        world.insert(a, Mark, { v: 1 });
        const b = world.spawn();
        world.insert(b, Other, { v: 1 });

        world.advanceTopologyReader(Mark, fast, world.getWorldTick());

        // A single global watermark would hold Mark's row for Other's sake.
        expect(world.getTopologyChangedEntitiesSince(Mark, early)).toEqual([]);
        expect(world.getTopologyChangedEntitiesSince(Other, early)).toEqual([b]);
    });

    it('records a despawn as a departure', () => {
        const world = new World();
        world.advanceTick();
        const floor = world.getWorldTick() - 1;
        world.registerTopologyReaderFrom(Mark, floor + 1);
        const e = world.spawn();
        world.insert(e, Mark, { v: 1 });
        world.despawn(e);

        expect(world.getTopologyChangedEntitiesSince(Mark, floor)).toEqual([e, e]);
    });
});
