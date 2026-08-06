// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Time } from '../src/ecs/resource';
import { defineResource, Res } from '../src/ecs/resource';

describe('App.tick()', () => {
    it('should lazily initialize runner and Time resource', async () => {
        const app = App.new();
        expect(app.hasResource(Time)).toBe(false);

        await app.tick(1 / 60);

        expect(app.hasResource(Time)).toBe(true);
        const time = app.getResource(Time);
        expect(time.frameCount).toBe(1);
        expect(time.delta).toBeCloseTo(1 / 60);
    });

    it('should run Startup schedule only once', async () => {
        const app = App.new();
        let startupCount = 0;

        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [], () => { startupCount++; }, { name: 'TestStartup' }
        ));

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        await app.tick(1 / 60);

        expect(startupCount).toBe(1);
    });

    it('should execute schedules in correct order', async () => {
        const app = App.new();
        const order: string[] = [];

        app.addSystemToSchedule(Schedule.First, defineSystem(
            [], () => { order.push('First'); }, { name: 'S_First' }
        ));
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [], () => { order.push('PreUpdate'); }, { name: 'S_PreUpdate' }
        ));
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { order.push('Update'); }, { name: 'S_Update' }
        ));
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [], () => { order.push('PostUpdate'); }, { name: 'S_PostUpdate' }
        ));
        app.addSystemToSchedule(Schedule.Last, defineSystem(
            [], () => { order.push('Last'); }, { name: 'S_Last' }
        ));

        await app.tick(1 / 60);

        expect(order).toEqual(['First', 'PreUpdate', 'Update', 'PostUpdate', 'Last']);
    });

    it('should skip Fixed schedules when accumulator below timestep', async () => {
        const app = App.new();
        let fixedRan = false;

        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
            [], () => { fixedRan = true; }, { name: 'S_FixedUpdate' }
        ));

        // Default fixedTimestep is 1/60; pass a smaller dt so accumulator stays below threshold
        await app.tick(1 / 120);

        expect(fixedRan).toBe(false);
    });

    it('should accumulate elapsed time across ticks', async () => {
        const app = App.new();

        await app.tick(0.1);
        await app.tick(0.2);
        await app.tick(0.05);

        const time = app.getResource(Time);
        expect(time.elapsed).toBeCloseTo(0.35);
        expect(time.frameCount).toBe(3);
        expect(time.delta).toBeCloseTo(0.05);
    });

    it('should pass resources to systems via Res()', async () => {
        const app = App.new();
        const MyRes = defineResource({ value: 42 }, 'MyRes');
        app.insertResource(MyRes, { value: 42 });

        let capturedValue = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(MyRes)],
            (res: { value: number }) => { capturedValue = res.value; },
            { name: 'S_ReadRes' }
        ));

        await app.tick(1 / 60);

        expect(capturedValue).toBe(42);
    });
});

describe('App.stepFrames()', () => {
    // The rAF loop is wall-clock and the browser throttles it in a background tab
    // to about a frame a second, so "wait and look again" cannot observe a game.
    // This is the door that advances one on purpose; before it existed the only
    // way through was App's private runFrame_, which a dogfood run duly found.
    it('runs exactly the frames asked for, at exactly the delta asked for', async () => {
        const app = App.new();
        let frames = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { frames++; }, { name: 'Count' },
        ));

        await app.stepFrames(30, 1 / 60);

        expect(frames).toBe(30);
        const time = app.getResource(Time);
        expect(time.frameCount).toBe(30);
        expect(time.delta).toBeCloseTo(1 / 60);
        expect(time.elapsed).toBeCloseTo(0.5);
    });

    it('steps a PAUSED app — that is what stepping a paused game means — and leaves it paused', async () => {
        const app = App.new();
        let frames = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { frames++; }, { name: 'Count' },
        ));
        app.setPaused(true);

        await app.stepFrames(3);

        expect(frames).toBe(3);
        expect(app.isPaused()).toBe(true);
    });

    it('defaults to one frame', async () => {
        const app = App.new();
        await app.stepFrames();
        expect(app.getResource(Time).frameCount).toBe(1);
    });
});
