// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  app-lifecycle-vocabulary.test.ts — the frozen surface a game's loop is
 *        registered through.
 *
 * Every golden project imports Schedule and addSystemToSchedule; nine of eleven
 * import Time. Freezing those freezes claims about *when* a system runs and what
 * the clock says, so each claim is asserted here rather than left to the phase
 * numbers looking sensible.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App, addPlugin, flushPendingRegistrations } from '../src/app/app';
import {
    Schedule, defineSystem, defineSystemSet, addStartupSystem,
    addSystemToSchedule, addSystemSetToSchedule,
} from '../src/ecs/system';
import { Res, ResMut, Time } from '../src/core';
import { getDefaultContext } from '../src/ecs/context';
import type { RunCondition, SystemSet, SystemSetOptions, TimeData } from '../src/core';

function trace(name: string, into: string[]) {
    return defineSystem([], () => { into.push(name); }, { name });
}

beforeEach(() => {
    // Module-level registration is app-scoped state, so a leftover from one test
    // would run inside the next one's app.
    getDefaultContext().drainPendingSystems();
});

describe('schedule vocabulary', () => {
    it('the per-frame phases run in the order the enum lists them', async () => {
        const app = App.new();
        const order: string[] = [];
        // Registered back to front, so passing cannot come from insertion order.
        for (const phase of [Schedule.Last, Schedule.PostUpdate, Schedule.Update, Schedule.PreUpdate, Schedule.First]) {
            app.addSystemToSchedule(phase, trace(Schedule[phase], order));
        }

        await app.tick(1 / 60);
        expect(order).toEqual(['First', 'PreUpdate', 'Update', 'PostUpdate', 'Last']);
    });

    it('Startup runs once, before the first frame, however many frames follow', async () => {
        const app = App.new();
        const order: string[] = [];
        app.addSystemToSchedule(Schedule.Update, trace('update', order));
        app.addSystemToSchedule(Schedule.Startup, trace('startup', order));

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(order).toEqual(['startup', 'update', 'update']);
    });

    it('a Fixed phase runs as many times as the accumulated step allows', async () => {
        const app = App.new();
        const steps: string[] = [];
        app.addSystemToSchedule(Schedule.FixedUpdate, trace('fixed', steps));

        // Three steps' worth of time in one frame; the frame runs once.
        await app.tick(3 / 60);
        expect(steps.length).toBe(3);
    });
});

describe('module-level registration', () => {
    it('carries a project bundle\'s systems into the app that flushes them', async () => {
        const order: string[] = [];
        addStartupSystem(trace('bundle-startup', order));
        addSystemToSchedule(Schedule.PostUpdate, trace('bundle-post', order));

        const app = App.new();
        flushPendingRegistrations(app);
        await app.tick(1 / 60);

        expect(order).toEqual(['bundle-startup', 'bundle-post']);
    });

    it('registers a set, so one runIf gates every member', async () => {
        const order: string[] = [];
        let running = false;
        const gate: RunCondition = () => running;
        const options: SystemSetOptions = {
            systems: [trace('a', order), trace('b', order)],
            runIf: gate,
        };
        const set: SystemSet = defineSystemSet('vocab-gated', options);
        addSystemSetToSchedule(Schedule.Update, set);

        const app = App.new();
        flushPendingRegistrations(app);
        await app.tick(1 / 60);
        expect(order).toEqual([]);

        running = true;
        await app.tick(1 / 60);
        expect(order).toEqual(['a', 'b']);
    });

    it('drains, so a second app does not inherit the first one\'s systems', async () => {
        const order: string[] = [];
        addSystemToSchedule(Schedule.Update, trace('once', order));

        const first = App.new();
        flushPendingRegistrations(first);
        const second = App.new();
        flushPendingRegistrations(second);

        await first.tick(1 / 60);
        await second.tick(1 / 60);
        expect(order).toEqual(['once']);
    });

    it('carries a project bundle PLUGIN too, before its own systems run', async () => {
        // A plugin package is installed from the bundle, which is imported before
        // an App exists — the same reason systems have a module-level door. And a
        // project system may read what the plugin inserted, so plugins go first.
        const order: string[] = [];
        addPlugin({
            name: 'FromBundle',
            build: (app) => {
                order.push('plugin-built');
                app.addStartupSystem(trace('plugin-startup', order));
            },
        });
        addStartupSystem(trace('bundle-startup', order));

        const app = App.new();
        flushPendingRegistrations(app);
        await app.tick(1 / 60);

        expect(order[0]).toBe('plugin-built');
        expect(order).toContain('plugin-startup');
        expect(order).toContain('bundle-startup');
    });

    it('drains the plugins, so a second app does not build them again', async () => {
        const built: string[] = [];
        addPlugin({ name: 'Once', build: () => built.push('built') });

        flushPendingRegistrations(App.new());
        flushPendingRegistrations(App.new());

        expect(built).toEqual(['built']);
    });
});

/** Sets `Time.scale` once, on the frame whose number it is given. */
function scaleOnFrame(app: App, frame: number, to: number) {
    app.addSystemToSchedule(Schedule.Update, defineSystem([ResMut(Time)], (time) => {
        time.modify((t) => { if (t.frameCount === frame) t.scale = to; });
    }));
}

describe('Time vocabulary', () => {
    it('delta arrives scaled and unscaledDelta does not', async () => {
        const app = App.new();
        const seen: Array<Pick<TimeData, 'delta' | 'unscaledDelta'>> = [];
        scaleOnFrame(app, 1, 0.5);
        app.addSystemToSchedule(Schedule.Last, defineSystem([Res(Time)], (time) => {
            seen.push({ delta: time.delta, unscaledDelta: time.unscaledDelta });
        }));

        await app.tick(1 / 30);
        await app.tick(1 / 30);
        expect(seen[1].delta).toBeCloseTo(1 / 60, 6);
        expect(seen[1].unscaledDelta).toBeCloseTo(1 / 30, 6);
    });

    it('a write to scale lands on the next frame, because the clock is read before any system runs', async () => {
        const app = App.new();
        const deltas: number[] = [];
        scaleOnFrame(app, 1, 0);
        app.addSystemToSchedule(Schedule.Last, defineSystem([Res(Time)], (time) => {
            deltas.push(time.delta);
        }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        // The frame that asked for the pause still integrates fully; the next one
        // does not. A game pausing in Update overshoots by exactly one frame.
        expect(deltas[0]).toBeCloseTo(1 / 60, 6);
        expect(deltas[1]).toBe(0);
    });

    it('scale 0 still runs the frame, and advances nothing that integrates delta', async () => {
        const app = App.new();
        let frames = 0;
        let advanced = 0;
        scaleOnFrame(app, 1, 0);
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([Res(Time)], (time) => {
            if (time.frameCount > 1) { frames += 1; advanced += time.delta; }
        }));
        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([Res(Time)], (time) => {
            if (time.frameCount > 1) advanced += 1;
        }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(frames).toBe(2);
        expect(advanced).toBe(0);
    });

    it('fixedTick counts simulation steps where frameCount counts frames', async () => {
        const app = App.new();
        let ticks = 0;
        let frameCount = 0;
        app.addSystemToSchedule(Schedule.Last, defineSystem([Res(Time)], (time) => {
            ticks = time.fixedTick;
            frameCount = time.frameCount;
        }));

        await app.tick(3 / 60);
        expect(ticks).toBe(3);
        expect(frameCount).toBe(1);
    });
});
