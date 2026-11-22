// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, bench } from 'vitest';
import { World } from '../src/ecs/world';
import { Disabled, defineComponent } from '../src/ecs/component';

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

    // Invalidate membership the same way World.insert/remove do, keeping the edit itself out of the rebuild timing.
    bench('cache miss: 1 comp', () => {
        world.queries_.markComponentDirty(A._id);
        world.getEntitiesWithComponents([A], [], []);
    });

    bench('cache miss: 2 comp', () => {
        world.queries_.markComponentDirty(A._id);
        world.getEntitiesWithComponents([A, B], [], []);
    });

    bench('cache miss: 2 comp + without filter', () => {
        world.queries_.markComponentDirty(A._id);
        world.getEntitiesWithComponents([A, B], [], [C]);
    });

    bench('cache miss: 3 comp', () => {
        world.queries_.markComponentDirty(A._id);
        world.getEntitiesWithComponents([A, B, C], [], []);
    });
});

// A batch is long enough to separate the time spent in World from the benchmark timer.
describe('Query cache hits (2000 entities, 1000 lookups)', () => {
    const world = makeWorld(2000);
    const edit = world.spawn();

    bench('one component', () => {
        for (let i = 0; i < 1000; i++) world.getEntitiesWithComponents([A]);
    });

    bench('two components', () => {
        for (let i = 0; i < 1000; i++) world.getEntitiesWithComponents([A, B]);
    });

    bench('two components after an unrelated insert or removal', () => {
        if (world.has(edit, D)) world.remove(edit, D);
        else world.insert(edit, D);
        for (let i = 0; i < 1000; i++) world.getEntitiesWithComponents([A, B]);
    });
});

describe('Query cache miss - scale by entity count', () => {
    for (const count of [500, 2000, 5000, 10000]) {
        const world = makeWorld(count);
        bench(`${count} entities, 2 comp miss`, () => {
            world.queries_.markComponentDirty(A._id);
            world.getEntitiesWithComponents([A, B]);
        });
    }
});

describe('World membership queries (20000 entities)', () => {
    const world = new World();
    const rare = defineComponent('CMMembershipRare', {});
    const common = defineComponent('CMMembershipCommon', {});
    const entities = Array.from({ length: 20000 }, () => world.spawn());
    // A component can be attached long after spawn and in a different order.
    for (let i = entities.length - 1; i >= 0; i--) {
        if (i % 1000 === 0) world.insert(entities[i], rare);
        if (i % 2 === 0) world.insert(entities[i], common);
    }

    bench('all entities, 1000 warm reads', () => {
        for (let i = 0; i < 1000; i++) world.getEntitiesWithComponents([]);
    });

    bench('rebuild all entities', () => {
        world.queries_.markComponentDirty(Disabled._id);
        if (world.getEntitiesWithComponents([]).length !== 20000) throw new Error('Incorrect population');
    });

    bench('with a tag on 20 entities', () => {
        world.queries_.markComponentDirty(rare._id);
        const found = world.getEntitiesWithComponents([], [rare]);
        if (found.length !== 20 || found[0] !== entities[0]) throw new Error('Incorrect sparse selection');
    });

    bench('with a tag on 10000 entities', () => {
        world.queries_.markComponentDirty(common._id);
        const found = world.getEntitiesWithComponents([], [common]);
        if (found.length !== 10000 || found[0] !== entities[0]) throw new Error('Incorrect dense selection');
    });
});

describe('Query cache miss - has() breakdown', () => {
    const world = makeWorld(2000);
    const entities = world.getEntitiesWithComponents([A]);
    const storage = new Map(entities.map(entity => [entity, world.get(entity, A)]));

    bench('Map.has() x2000 (reference map)', () => {
        for (let i = 0; i < entities.length; i++) {
            if (!storage.has(entities[i])) throw new Error('Entity missing from reference map');
        }
    });

    bench('world.has() x2000 (through dispatch)', () => {
        for (let i = 0; i < entities.length; i++) {
            if (!world.has(entities[i], A)) throw new Error('Entity missing component A');
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
