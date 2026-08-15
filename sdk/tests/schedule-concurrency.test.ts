// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Systems that wait, waiting at the same time.
 *
 *        A synchronous system runs to completion the moment it starts, so on one
 *        thread only the WAITING can overlap. Who may start beside a system
 *        parked on an `await` is exactly what the access declarations answer —
 *        these are the tests where those declarations are spent, not reported.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem, GetWorld } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import { defineComponent } from '../src/ecs/component';
import { Commands, type CommandsInstance } from '../src/ecs/commands';

const Position = defineComponent('ConcPosition', { x: 0, y: 0 });
const Health = defineComponent('ConcHealth', { hp: 100 });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wall time one tick takes, which is the only thing overlap can be seen in. */
async function tickMs(app: App): Promise<number> {
    const t0 = performance.now();
    await app.tick(1 / 60);
    return performance.now() - t0;
}

describe('two systems that wait', () => {
    it('wait at the same time when neither touches what the other does', async () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], async () => { await sleep(60); }, { name: 'SlowA' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], async () => { await sleep(60); }, { name: 'SlowB' }));

        // Serial would be ~120ms; the margin is generous because a loaded CI box
        // is slow, and 120 vs 60 survives any amount of that.
        expect(await tickMs(app)).toBeLessThan(100);
    });

    it('wait one after another when one writes what the other reads', async () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], async () => { await sleep(60); }, { name: 'Writer' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], async () => { await sleep(60); }, { name: 'Reader' }));

        expect(await tickMs(app)).toBeGreaterThan(110);
    });

    // The escape hatch keeps its price: a system that never said what it reaches
    // for cannot be run beside anything, because anything is what it might touch.
    it('wait one after another when one declares nothing', async () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([GetWorld()], async () => { await sleep(60); }, { name: 'Opaque' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], async () => { await sleep(60); }, { name: 'Declared' }));

        expect(await tickMs(app)).toBeGreaterThan(110);
    });

    it('overlap once that same system declares its reach', async () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update, defineSystem([GetWorld()], async () => { await sleep(60); },
            { name: 'Declared1', touches: { writes: ['ConcPosition'] } }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], async () => { await sleep(60); }, { name: 'Declared2' }));

        expect(await tickMs(app)).toBeLessThan(100);
    });
});

describe('a schedule that overlaps', () => {
    it('still runs every system, and an ordering edge still holds', async () => {
        const app = App.new();
        const order: string[] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Position))], async () => {
            await sleep(40);
            order.push('slow');
        }, { name: 'Slow' }));
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Health))], () => {
            order.push('fast');
        }, { name: 'Fast' }));
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Health)], () => {
            order.push('after');
        }, { name: 'After' }), { runAfter: ['Fast'] });

        await app.tick(1 / 60);
        // 'fast' beat 'slow' — that IS the overlap — and 'after' still followed it.
        expect(order).toEqual(['fast', 'after', 'slow']);
    });

    // The iteration guard is the world's, not the system's: a system parked
    // mid-query must not leave it standing, or the next system's spawn is
    // refused for an iteration that is not its own.
    it('does not lend a parked query iteration to the next system', async () => {
        const app = App.new();
        const subject = app.world.spawn('subject');
        app.world.insert(subject, Position, { x: 0, y: 0 });
        let spawnError: unknown = null;

        // Parked INSIDE the loop: a for-of that has run to the end already gave
        // the guard back, and a system suspended after that lends nothing. The
        // depth only outlives an await when the iterator is still open.
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Position))],
            async (q: Iterable<unknown>) => {
                for (const _ of q) await sleep(40);
            }, { name: 'Iterating', touches: { writes: ['ConcPosition'] } }));

        app.addSystemToSchedule(Schedule.Update, defineSystem([GetWorld()], (world) => {
            try {
                world.spawn('from-the-other-system');
            } catch (e) {
                spawnError = e;
            }
        }, { name: 'Spawner', touches: { writes: ['ConcHealth'] } }));

        await app.tick(1 / 60);
        expect(spawnError).toBeNull();
    });

    it('applies a deferred command from the system that returned first', async () => {
        const app = App.new();
        let spawned = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Position))],
            async () => { await sleep(40); }, { name: 'Slow' }));
        app.addSystemToSchedule(Schedule.Update, defineSystem([Commands(), Query(Mut(Health))],
            (commands: CommandsInstance) => {
                commands.spawn();
                spawned++;
            }, { name: 'Spawner' }));

        await app.tick(1 / 60);
        expect(spawned).toBe(1);
        expect(app.world.entityCount()).toBeGreaterThan(0);
    });
});
