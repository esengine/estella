/**
 * @file    system-set.test.ts
 * @brief   SystemSet grouping, shared runIf, and set-name dep expansion.
 */
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import { Schedule, defineSystem, defineSystemSet } from '../src/system';

function namedSystem(name: string, trace: string[]) {
    return defineSystem([], () => { trace.push(name); }, { name });
}

describe('SystemSet', () => {
    it('runs every member system in the set', async () => {
        const app = App.new();
        const trace: string[] = [];

        app.addSystemSetToSchedule(Schedule.Update, defineSystemSet('physics', {
            systems: [
                namedSystem('ApplyForces', trace),
                namedSystem('IntegrateVelocity', trace),
            ],
        }));

        await app.tick(1 / 60);
        expect(trace.sort()).toEqual(['ApplyForces', 'IntegrateVelocity']);
    });

    it('runIf on the set gates every member', async () => {
        const app = App.new();
        const trace: string[] = [];
        let enabled = false;

        app.addSystemSetToSchedule(Schedule.Update, defineSystemSet('physics', {
            systems: [
                namedSystem('ApplyForces', trace),
                namedSystem('IntegrateVelocity', trace),
            ],
            runIf: () => enabled,
        }));

        await app.tick(1 / 60);
        expect(trace).toEqual([]);

        enabled = true;
        await app.tick(1 / 60);
        expect(trace.sort()).toEqual(['ApplyForces', 'IntegrateVelocity']);
    });

    it('other systems can reference the set name in runAfter', async () => {
        const app = App.new();
        const trace: string[] = [];

        app.addSystemSetToSchedule(Schedule.Update, defineSystemSet('physics', {
            systems: [
                namedSystem('ApplyForces', trace),
                namedSystem('IntegrateVelocity', trace),
            ],
        }));

        app.addSystemToSchedule(Schedule.Update, namedSystem('RenderSync', trace), {
            runAfter: ['physics'],
        });

        await app.tick(1 / 60);

        // Both set members must have run before RenderSync.
        const renderIdx = trace.indexOf('RenderSync');
        expect(trace.indexOf('ApplyForces')).toBeLessThan(renderIdx);
        expect(trace.indexOf('IntegrateVelocity')).toBeLessThan(renderIdx);
    });

    it('other systems can reference the set name in runBefore', async () => {
        const app = App.new();
        const trace: string[] = [];

        app.addSystemSetToSchedule(Schedule.Update, defineSystemSet('physics', {
            systems: [
                namedSystem('ApplyForces', trace),
                namedSystem('IntegrateVelocity', trace),
            ],
        }));

        app.addSystemToSchedule(Schedule.Update, namedSystem('Input', trace), {
            runBefore: ['physics'],
        });

        await app.tick(1 / 60);

        const inputIdx = trace.indexOf('Input');
        expect(inputIdx).toBeLessThan(trace.indexOf('ApplyForces'));
        expect(inputIdx).toBeLessThan(trace.indexOf('IntegrateVelocity'));
    });

    it('set runBefore makes every member run before the external target', async () => {
        const app = App.new();
        const trace: string[] = [];

        app.addSystemToSchedule(Schedule.Update, namedSystem('Render', trace));

        app.addSystemSetToSchedule(Schedule.Update, defineSystemSet('physics', {
            systems: [
                namedSystem('ApplyForces', trace),
                namedSystem('IntegrateVelocity', trace),
            ],
            runBefore: ['Render'],
        }));

        await app.tick(1 / 60);

        const renderIdx = trace.indexOf('Render');
        expect(trace.indexOf('ApplyForces')).toBeLessThan(renderIdx);
        expect(trace.indexOf('IntegrateVelocity')).toBeLessThan(renderIdx);
    });

    it('defineSystemSet rejects empty names', () => {
        expect(() => defineSystemSet('', { systems: [] })).toThrow(/name/i);
    });
});
