// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Who owns removal history, and how long it lives.
 *
 * `Removed(C)` promises the entities that lost C since THIS system last ran.
 * That promise is only as good as the retention: a buffer pruned by anything
 * other than what its readers still need drops rows nobody consented to lose,
 * and the system sees an empty list rather than an error.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, Schedule, SystemRunner } from '../src/ecs/system';
import { World } from '../src/ecs/world';
import { ResourceStorage } from '../src/ecs/resource';
import { defineEvent, EventWriter } from '../src/ecs/event';
import { Removed, Query, Changed } from '../src/ecs/query';
import type { Entity } from '../src/types';

const Bullet = defineComponent('RetBullet', { n: 0 });
const Shell = defineComponent('RetShell', { n: 0 });

describe('removal history retention', () => {
    it('a system that runs every few frames still sees what it missed', async () => {
        const app = App.new();
        const world = app.world;

        let armed = false;
        const seen: Entity[][] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Removed(Bullet)],
            (removed) => { seen.push(removed.toArray()); },
            { name: 'RetReap' },
        ), { runIf: () => armed });

        // Run once so the reader exists and has a frame to be "since".
        armed = true;
        await app.tick(1 / 60);
        armed = false;

        const e = world.spawn();
        world.insert(e, Bullet, { n: 1 });
        await app.tick(1 / 60);
        world.remove(e, Bullet);

        // Long enough that a fixed-window prune would have dropped the row.
        for (let i = 0; i < 6; i++) await app.tick(1 / 60);

        armed = true;
        await app.tick(1 / 60);

        expect(seen.at(-1)).toEqual([e]);
    });


    /** Everything still in `C`'s buffer, whoever it belongs to. */
    const held = (world: { getRemovedEntitiesSince(c: typeof Bullet, t: number): Entity[] }) =>
        world.getRemovedEntitiesSince(Bullet, -1);

    /** An app with a fast reader and a slow one over the same component. */
    function twoReaders() {
        const app = App.new();
        let slowArmed = false;
        const slowSaw: Entity[][] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Removed(Bullet)], () => { /* keeps up every frame */ }, { name: 'RetFast' },
        ));
        const slow = defineSystem(
            [Removed(Bullet)],
            (removed) => { slowSaw.push(removed.toArray()); },
            { name: 'RetSlow' },
        );
        app.addSystemToSchedule(Schedule.Update, slow, { runIf: () => slowArmed });
        return { app, slow, slowSaw, arm: (on: boolean) => { slowArmed = on; } };
    }

    it('holds history to the LOWEST claim, and lets go when it rises', async () => {
        const { app, slowSaw, arm } = twoReaders();
        const world = app.world;
        arm(true);
        await app.tick(1 / 60);
        arm(false);

        // A tick of its own: a removal recorded at the tick a reader last ran is
        // outside its next window (`tick > lastRunTick`) and owed to nobody.
        await app.tick(1 / 60);
        const e = world.spawn();
        world.insert(e, Bullet, { n: 1 });
        world.remove(e, Bullet);
        // The fast reader runs and releases; the slow one has not, so the row stays.
        for (let i = 0; i < 4; i++) await app.tick(1 / 60);
        expect(held(world)).toEqual([e]);

        arm(true);
        await app.tick(1 / 60);
        expect(slowSaw.at(-1)).toEqual([e]);
        // Both have now read past it, so nobody is owed it.
        await app.tick(1 / 60);
        expect(held(world)).toEqual([]);
    });

    it('a slow reader of one component does not pin another', async () => {
        const app = App.new();
        const world = app.world;
        let armed = false;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Removed(Bullet)], () => { /* every frame */ }, { name: 'RetA' },
        ));
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Removed(Shell)], () => { /* only when armed */ }, { name: 'RetB' },
        ), { runIf: () => armed });
        armed = true;
        await app.tick(1 / 60);
        armed = false;
        // One frame with only the fast reader running, so the two claims differ.
        await app.tick(1 / 60);

        const a = world.spawn();
        world.insert(a, Bullet, { n: 1 });
        world.remove(a, Bullet);
        const b = world.spawn();
        world.insert(b, Shell, { n: 1 });
        world.remove(b, Shell);
        for (let i = 0; i < 4; i++) await app.tick(1 / 60);

        // A global watermark would hold both, because B's reader is behind.
        expect(world.getRemovedEntitiesSince(Bullet, -1)).toEqual([]);
        expect(world.getRemovedEntitiesSince(Shell, -1)).toEqual([b]);
    });

    it('evicting the slow system lets the watermark rise at once', async () => {
        const { app, slow, arm } = twoReaders();
        const world = app.world;
        arm(true);
        await app.tick(1 / 60);
        arm(false);

        await app.tick(1 / 60);
        const e = world.spawn();
        world.insert(e, Bullet, { n: 1 });
        world.remove(e, Bullet);
        for (let i = 0; i < 3; i++) await app.tick(1 / 60);
        expect(held(world)).toEqual([e]);

        app.removeSystem(slow._id);
        expect(held(world)).toEqual([]);
        expect(world.removedReaderCount(Bullet)).toBe(1);
    });

    it('an async system keeps its rows while it is parked', async () => {
        const app = App.new();
        const world = app.world;
        let saw: Entity[] | null = null;
        let armed = false;
        let other: number | null = null;
        let victim: Entity | null = null;

        // Removed IN-FRAME: the window is `tick > lastRunTick`, so a removal
        // between two frames carries the tick the reader just ran at and is
        // outside the next window by construction.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => {
                if (!armed || victim === null) return;
                world.remove(victim, Bullet);
            },
            { name: 'RetKiller' },
        ));

        // A second claim, advanced WHILE the reader below is parked mid-body.
        // Its own claim has not moved — it has not read yet — so the row is
        // still owed and the prune must leave it.
        const gate = () => new Promise<void>((resolve) => {
            queueMicrotask(() => {
                world.advanceRemovedReader(Bullet, other!, world.getWorldTick());
                resolve();
            });
        });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Removed(Bullet)],
            async (removed) => {
                if (!armed) return;
                await gate();
                saw = removed.toArray();
            },
            { name: 'RetAsync' },
        ));
        await app.tick(1 / 60);
        other = world.registerRemovedReader(Bullet);

        victim = world.spawn();
        world.insert(victim, Bullet, { n: 1 });
        armed = true;
        await app.tick(1 / 60);

        expect(saw).toEqual([victim]);
    });

    it('a reset gives up every claim it was holding', async () => {
        const world = new World();
        const runner = new SystemRunner(world, new ResourceStorage());
        const sys = defineSystem([Removed(Bullet)], () => { /* reads */ }, { name: 'RetReset' });

        runner.run(sys);
        expect(world.removedReaderCount(Bullet)).toBe(1);

        runner.reset();
        expect(world.removedReaderCount(Bullet)).toBe(0);
        // With nobody left to ask, the rows are not history — they are garbage.
        const e = world.spawn();
        world.insert(e, Bullet, { n: 1 });
        world.remove(e, Bullet);
        expect(world.getRemovedEntitiesSince(Bullet, -1)).toEqual([]);
    });

    it('a parameter set that fails to build leaves no claim behind', () => {
        const world = new World();
        // No event registry, so the SECOND parameter throws while the first has
        // already been constructed. A claim taken during construction would have
        // no owner to release it — and would pin this component forever.
        const runner = new SystemRunner(world, new ResourceStorage());
        const sys = defineSystem(
            [Removed(Bullet), EventWriter(defineEvent<{ n: number }>('RetBoom'))],
            () => { /* never runs */ },
            { name: 'RetBadParams' },
        );

        expect(() => runner.run(sys)).toThrow('EventRegistry');
        expect(world.removedReaderCount(Bullet)).toBe(0);
    });

    /**
     * A sampler reading with a one-tick overlap claims from THAT floor, not from
     * the tick after it. With a second reader on the same component, the default
     * claim would sit one tick above the row the sampler is about to ask for,
     * and that reader's prune takes it.
     */
    it('an overlapping claim survives another reader pruning the same tick', () => {
        const world = new World();
        world.advanceTick();
        const T = world.getWorldTick();

        // A `Removed()` system reader, and a sampler that reads `tick > T - 1`.
        const perSystem = world.registerRemovedReader(Bullet);
        world.registerRemovedReaderFrom(Bullet, T);

        const e = world.spawn();
        world.insert(e, Bullet, { n: 1 });
        world.remove(e, Bullet);
        expect(world.getRemovedEntitiesSince(Bullet, T - 1)).toEqual([e]);

        // The system reader finishes its run at T and gives up everything through
        // it. The sampler has not read yet, so the row must survive.
        world.advanceRemovedReader(Bullet, perSystem, T);

        expect(world.getRemovedEntitiesSince(Bullet, T - 1)).toEqual([e]);
    });

    it('change tracking alone does not accumulate removal rows', async () => {
        const app = App.new();
        const world = app.world;

        // A Changed() reader, and nothing that asks for removal history.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Query(Changed(Bullet))],
            (q) => { for (const _row of q) { /* counted by the filter */ } },
            { name: 'RetWatch' },
        ));
        await app.tick(1 / 60);

        for (let i = 0; i < 200; i++) {
            const e = world.spawn();
            world.insert(e, Bullet, { n: i });
            world.remove(e, Bullet);
        }
        await app.tick(1 / 60);

        expect(world.getStorageSizes().changes.removedRows).toBe(0);
        // Losing a component is still a change to it — that half must survive.
        expect(world.anyChangedSince(Bullet, 0)).toBe(true);
    });
});
