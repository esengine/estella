// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Time } from '../src/ecs/resource';
import { defineResource, Res } from '../src/ecs/resource';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';

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

    it('scales delta and stops the fixed steps at scale 0', async () => {
        const app = App.new();
        let fixedSteps = 0;
        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => { fixedSteps++; }));

        await app.tick(1 / 30);
        expect(fixedSteps).toBeGreaterThan(0);

        const before = fixedSteps;
        app.getResource(Time).scale = 0;
        for (let i = 0; i < 10; i++) await app.tick(1 / 30);

        const time = app.getResource(Time);
        expect(time.delta).toBe(0);
        // Real time keeps flowing — whatever must move while the world does not
        // has something to move by.
        expect(time.unscaledDelta).toBeCloseTo(1 / 30);
        // The whole point: physics is a fixed step, and a paused world takes none.
        expect(fixedSteps).toBe(before);
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

    // A display hands out frames on a metronome; the callback that draws them does
    // not start on one. Measuring delta at callback entry puts that start delay's
    // variance into delta TWICE — added to one frame, subtracted from the next —
    // so a steady 60 Hz becomes an unsteady delta, and `speed * delta` motion moves
    // in unequal steps. The rAF timestamp is the vsync itself, which is the clock
    // the frame is actually drawn against.
    it('takes the frame clock from the animation-frame timestamp, not the callback entry time', async () => {
        const realRaf = globalThis.requestAnimationFrame;
        let pending: ((ts: number) => void) | null = null;
        globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
            pending = fn as unknown as (ts: number) => void;
            return 1;
        }) as unknown as typeof globalThis.requestAnimationFrame;

        // The wall clock as the callback sees it: vsync plus however long the host
        // took to get round to us this frame.
        let entryNow = 1000;
        setPlatform({ now: () => entryNow } as unknown as PlatformAdapter);

        const app = App.new();
        const deltasMs: number[] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)], (time: { delta: number }) => { deltasMs.push(time.delta * 1000); },
            { name: 'RecordDelta' },
        ));

        const settle = async (): Promise<void> => {
            for (let i = 0; i < 30; i++) await Promise.resolve();
        };

        try {
            await app.run();     // seeds the clock and runs one frame off platformNow()
            await settle();
            deltasMs.length = 0;

            const VSYNC = 1000 / 60;
            const startDelay = [0.2, 4.1, 0.9, 6.3, 1.7, 3.0];
            for (let i = 1; i <= startDelay.length; i++) {
                const vsync = 1000 + i * VSYNC;
                entryNow = vsync + startDelay[i - 1];
                const fire = pending!;
                pending = null;
                await fire(vsync);
                await settle();
            }

            expect(deltasMs).toHaveLength(startDelay.length);
            for (const d of deltasMs) expect(d).toBeCloseTo(VSYNC, 6);
        } finally {
            app.quit();
            globalThis.requestAnimationFrame = realRaf;
        }
    });

    it('defaults to one frame', async () => {
        const app = App.new();
        await app.stepFrames();
        expect(app.getResource(Time).frameCount).toBe(1);
    });

    // A driver injects an input edge the moment this returns; a frame started
    // inside the call would clear it at its Last before anything sampled it.
    it('leaves the resumed loop to the next animation frame, so the caller keeps the boundary', async () => {
        // The loop reads the clock through the platform, which only a real entry
        // point installs.
        setPlatform({ now: () => performance.now() } as unknown as PlatformAdapter);
        const app = App.new();
        let frames = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { frames++; }, { name: 'Count' },
        ));

        await app.run();
        for (let i = 0; i < 20; i++) await Promise.resolve(); // the loop's first frame finishes
        const before = frames;

        await app.stepFrames(2);
        expect(frames).toBe(before + 2);

        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(frames).toBe(before + 2);

        app.quit();
    });
});
