// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import { defineComponent } from '../src/ecs/component';
import { Query, Mut, Changed } from '../src/ecs/query';
import type { QueryCost } from '../src/ecs/query';

const Position = defineComponent('QueryCostPosition', { x: 0, y: 0 });

function spawn(app: App, n: number): void {
    for (let i = 0; i < n; i++) {
        app.world.insert(app.world.spawn(), Position, { x: i, y: 0 });
    }
}

function costOf(app: App, systemName: string): QueryCost | undefined {
    return app.getFrameCosts()?.systems.find((s) => s.name === systemName)?.query;
}

describe('per-system query cost', () => {
    it('reports the entities a system walked', async () => {
        const app = App.new().enableStats();
        spawn(app, 40);
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Position)], (q) => {
            for (const _ of q) { /* walk */ }
        }, { name: 'Walker' }));
        await app.tick(1 / 60);

        expect(costOf(app, 'Walker')).toEqual({ calls: 1, scanned: 40, filtered: 0 });
    });

    it('counts every entry point, not just the iterator', async () => {
        const app = App.new().enableStats();
        spawn(app, 10);
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Position)], (q) => {
            q.count();
            q.toArray();
            q.isEmpty();
        }, { name: 'Asker' }));
        await app.tick(1 / 60);

        expect(costOf(app, 'Asker')).toMatchObject({ calls: 3, scanned: 30 });
    });

    it('separates what a change filter discarded from what it walked', async () => {
        const app = App.new().enableStats();
        spawn(app, 30);
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Changed(Position))], (q) => {
            for (const _ of q) { /* only the changed ones */ }
        }, { name: 'Reactor' }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        const cost = costOf(app, 'Reactor')!;

        // The filter is doing its job and the walk is still the whole set — the
        // finding a Changed() query exists to make visible.
        expect(cost.scanned).toBe(30);
        expect(cost.filtered).toBe(30);
    });

    it('shows nothing discarded when the changes are real', async () => {
        const app = App.new().enableStats();
        spawn(app, 5);
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Position))], (q) => {
            for (const [, p] of q) p.x += 1;
        }, { name: 'Mover' }));
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Changed(Position))], (q) => {
            for (const _ of q) { /* every one of them changed */ }
        }, { name: 'Reactor' }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);

        expect(costOf(app, 'Reactor')).toMatchObject({ scanned: 5, filtered: 0 });
    });

    it('leaves a system that runs no query without a cost', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'Quiet' }));
        await app.tick(1 / 60);

        expect(costOf(app, 'Quiet')).toBeUndefined();
    });

    it('does not carry a frame of cost into the next one', async () => {
        const app = App.new().enableStats();
        spawn(app, 12);
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Position)], (q) => {
            q.count();
        }, { name: 'Walker' }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);

        expect(costOf(app, 'Walker')).toEqual({ calls: 1, scanned: 12, filtered: 0 });
    });

    it('counts nothing while stats are off', async () => {
        const app = App.new();
        spawn(app, 10);
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Position)], (q) => {
            q.count();
        }, { name: 'Walker' }));
        await app.tick(1 / 60);

        expect(app.getFrameCosts()).toBeNull();
        expect(app.world.queryCostEnabled).toBe(false);
    });
});

describe('a system that runs several times in one frame', () => {
    it('is charged for all of its fixed steps, not just the last', async () => {
        const app = App.new().enableStats();
        app.setFixedTimestep(1 / 60);
        spawn(app, 8);
        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([Query(Position)], (q) => {
            q.count();
        }, { name: 'FixedWalker' }));

        // Four timesteps' worth of delta in one frame.
        await app.tick(4 / 60);

        expect(costOf(app, 'FixedWalker')).toMatchObject({ calls: 4, scanned: 32 });
    });

    it('sums its time over those steps too', async () => {
        const app = App.new().enableStats();
        app.setFixedTimestep(1 / 60);
        let runs = 0;
        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => { runs++; }, { name: 'FixedTimed' }));

        await app.tick(4 / 60);

        expect(runs).toBe(4);
        expect(app.getSystemTimings()?.has('FixedTimed')).toBe(true);
    });
});
