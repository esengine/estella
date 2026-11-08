// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { App, setAppHostPaused } from '../src/app/app';
import { Time } from '../src/ecs/resource';
import { defineSystem, defineSystemSet, Schedule } from '../src/ecs/system';

describe('paused presentation', () => {
    it('prepares every variable phase before rendering without running simulation', async () => {
        const app = App.new(), trace: string[] = [];
        const phases = [Schedule.First, Schedule.PreUpdate, Schedule.Update, Schedule.PostUpdate];
        for (const phase of phases) {
            app.addSystemToSchedule(phase, defineSystem([], () => { trace.push(Schedule[phase]); },
                { name: `Present${phase}`, runWhenPaused: true }));
            app.addSystemToSchedule(phase, defineSystem([], () => { trace.push('simulation'); }));
        }
        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => { trace.push('physics'); },
            { runWhenPaused: true }));
        app.addSystemToSchedule(Schedule.Last, defineSystem([], () => { trace.push('render'); }));
        app.setPaused(true);
        await app.tick(0.2);
        expect(trace).toEqual(['First', 'PreUpdate', 'Update', 'PostUpdate', 'render']);
        expect(app.getResource(Time)).toMatchObject({ delta: 0, elapsed: 0, fixedTick: 0, unscaledDelta: 0.2 });
        app.quit();
    });

    it.each(['user', 'host'] as const)('preserves explicit stepping and resume after %s pause', async owner => {
        const app = App.new(), host = {};
        let simulation = 0, presentation = 0;
        app.addSystem(defineSystem([], () => { simulation++; }));
        app.addSystem(defineSystem([], () => { presentation++; }, { runWhenPaused: true }));
        await app.tick(0.01);
        if (owner === 'host') setAppHostPaused(app, host, true);
        else app.setPaused(true);
        await app.tick(2);
        expect(simulation).toBe(1);
        expect(presentation).toBe(2);
        expect(app.getResource(Time).elapsed).toBeCloseTo(0.01);
        await app.stepFrames(1, 0.02);
        expect(app.isPaused()).toBe(true);
        expect(simulation).toBe(2);
        expect(presentation).toBe(3);
        expect(app.getResource(Time).elapsed).toBeCloseTo(0.03);
        if (owner === 'host') setAppHostPaused(app, host, false);
        else app.setPaused(false);
        await app.tick(0.01);
        expect(simulation).toBe(3);
        expect(presentation).toBe(4);
        expect(app.getResource(Time).elapsed).toBeCloseTo(0.04);
        app.quit();
    });

    it('preserves system-set gates and asynchronous ordering while filtering simulation', async () => {
        const app = App.new(), trace: string[] = [];
        let enabled = false;
        app.addSystemSet(defineSystemSet('presentation', {
            runIf: () => enabled,
            systems: [
                defineSystem([], () => { trace.push('layout'); },
                    { name: 'layout', runAfter: ['viewport'], runWhenPaused: true }),
                defineSystem([], async () => { await Promise.resolve(); trace.push('viewport'); },
                    { name: 'viewport', runWhenPaused: true }),
                defineSystem([], () => { trace.push('gameplay'); }, { name: 'gameplay' }),
            ],
        }));
        app.setPaused(true);
        await app.tick(0.1);
        expect(trace).toEqual([]);
        enabled = true;
        await app.tick(0.1);
        expect(trace).toEqual(['viewport', 'layout']);
        app.quit();
    });

    it('an execution hold still stops presentation and rendering', async () => {
        const app = App.new();
        let prepared = 0, rendered = 0;
        app.addSystem(defineSystem([], () => { prepared++; }, { runWhenPaused: true }));
        app.addSystemToSchedule(Schedule.Last, defineSystem([], () => { rendered++; }));
        app.setPaused(true);
        const release = app.holdExecution();
        await app.tick(0.1);
        expect([prepared, rendered]).toEqual([0, 0]);
        release();
        await app.tick(0.1);
        expect([prepared, rendered]).toEqual([1, 1]);
        app.quit();
    });
});
