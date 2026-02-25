import { describe, it, expect } from 'vitest';
import { App } from '../src/app';
import { Schedule, defineSystem } from '../src/system';
import { Time } from '../src/resource';
import { defineResource, Res } from '../src/resource';

describe('App.tick()', () => {
    it('should lazily initialize runner and Time resource', () => {
        const app = App.new();
        expect(app.hasResource(Time)).toBe(false);

        app.tick(1 / 60);

        expect(app.hasResource(Time)).toBe(true);
        const time = app.getResource(Time);
        expect(time.frameCount).toBe(1);
        expect(time.delta).toBeCloseTo(1 / 60);
    });

    it('should run Startup schedule only once', () => {
        const app = App.new();
        let startupCount = 0;

        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [], () => { startupCount++; }, { name: 'TestStartup' }
        ));

        app.tick(1 / 60);
        app.tick(1 / 60);
        app.tick(1 / 60);

        expect(startupCount).toBe(1);
    });

    it('should execute schedules in correct order', () => {
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

        app.tick(1 / 60);

        expect(order).toEqual(['First', 'PreUpdate', 'Update', 'PostUpdate', 'Last']);
    });

    it('should skip Fixed schedules', () => {
        const app = App.new();
        let fixedRan = false;

        app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
            [], () => { fixedRan = true; }, { name: 'S_FixedUpdate' }
        ));

        app.tick(1 / 60);

        expect(fixedRan).toBe(false);
    });

    it('should accumulate elapsed time across ticks', () => {
        const app = App.new();

        app.tick(0.1);
        app.tick(0.2);
        app.tick(0.05);

        const time = app.getResource(Time);
        expect(time.elapsed).toBeCloseTo(0.35);
        expect(time.frameCount).toBe(3);
        expect(time.delta).toBeCloseTo(0.05);
    });

    it('should pass resources to systems via Res()', () => {
        const app = App.new();
        const MyRes = defineResource({ value: 42 }, 'MyRes');
        app.insertResource(MyRes, { value: 42 });

        let capturedValue = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(MyRes)],
            (res: { value: number }) => { capturedValue = res.value; },
            { name: 'S_ReadRes' }
        ));

        app.tick(1 / 60);

        expect(capturedValue).toBe(42);
    });
});
