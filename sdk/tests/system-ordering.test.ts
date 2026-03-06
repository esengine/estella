import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app';
import { defineSystem, Schedule } from '../src/system';

describe('System Dependency Ordering', () => {
    let app: App;
    const executionOrder: string[] = [];

    beforeEach(() => {
        app = App.new();
        executionOrder.length = 0;
    });

    describe('runAfter', () => {
        it('should run systems in dependency order', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            app.addSystemToSchedule(Schedule.Update, systemB, { runAfter: ['SystemA'] });
            app.addSystemToSchedule(Schedule.Update, systemA);

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            await (app as any).runSchedule(Schedule.Update);

            expect(executionOrder).toEqual(['A', 'B']);
        });

        it('should handle multiple runAfter dependencies', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            const systemC = defineSystem([], () => {
                executionOrder.push('C');
            }, { name: 'SystemC' });

            app.addSystemToSchedule(Schedule.Update, systemC, { runAfter: ['SystemA', 'SystemB'] });
            app.addSystemToSchedule(Schedule.Update, systemB);
            app.addSystemToSchedule(Schedule.Update, systemA);

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            await (app as any).runSchedule(Schedule.Update);

            const aIndex = executionOrder.indexOf('A');
            const bIndex = executionOrder.indexOf('B');
            const cIndex = executionOrder.indexOf('C');

            expect(aIndex).toBeLessThan(cIndex);
            expect(bIndex).toBeLessThan(cIndex);
        });
    });

    describe('runBefore', () => {
        it('should run system before specified target', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            app.addSystemToSchedule(Schedule.Update, systemB);
            app.addSystemToSchedule(Schedule.Update, systemA, { runBefore: ['SystemB'] });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            await (app as any).runSchedule(Schedule.Update);

            expect(executionOrder).toEqual(['A', 'B']);
        });
    });

    describe('mixed dependencies', () => {
        it('should handle runBefore and runAfter together', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            const systemC = defineSystem([], () => {
                executionOrder.push('C');
            }, { name: 'SystemC' });

            app.addSystemToSchedule(Schedule.Update, systemB, { runAfter: ['SystemA'] });
            app.addSystemToSchedule(Schedule.Update, systemC, { runBefore: ['SystemB'] });
            app.addSystemToSchedule(Schedule.Update, systemA);

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            await (app as any).runSchedule(Schedule.Update);

            const aIndex = executionOrder.indexOf('A');
            const bIndex = executionOrder.indexOf('B');
            const cIndex = executionOrder.indexOf('C');

            expect(aIndex).toBeLessThan(bIndex);
            expect(cIndex).toBeLessThan(bIndex);
        });
    });

    describe('circular dependency detection', () => {
        it('should throw on circular dependencies', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            app.addSystemToSchedule(Schedule.Update, systemA, { runAfter: ['SystemB'] });
            app.addSystemToSchedule(Schedule.Update, systemB, { runAfter: ['SystemA'] });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };

            await expect((app as any).runSchedule(Schedule.Update)).rejects.toThrow('Circular dependency');
        });
    });

    describe('systems without dependencies', () => {
        it('should run in registration order when no dependencies specified', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            const systemC = defineSystem([], () => {
                executionOrder.push('C');
            }, { name: 'SystemC' });

            app.addSystemToSchedule(Schedule.Update, systemA);
            app.addSystemToSchedule(Schedule.Update, systemB);
            app.addSystemToSchedule(Schedule.Update, systemC);

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            await (app as any).runSchedule(Schedule.Update);

            expect(executionOrder).toEqual(['A', 'B', 'C']);
        });
    });

    describe('timeline system ordering in PostUpdate', () => {
        it('should run TimelineSystem after UILayoutLateSystem and before UITransformFinalSystem', async () => {
            const uiLayoutLate = defineSystem([], () => {
                executionOrder.push('UILayoutLateSystem');
            }, { name: 'UILayoutLateSystem' });

            const timeline = defineSystem([], () => {
                executionOrder.push('TimelineSystem');
            }, { name: 'TimelineSystem' });

            const transformFinal = defineSystem([], () => {
                executionOrder.push('UITransformFinalSystem');
            }, { name: 'UITransformFinalSystem' });

            app.addSystemToSchedule(Schedule.PostUpdate, uiLayoutLate, { runBefore: ['UIRenderOrderSystem'] });
            app.addSystemToSchedule(Schedule.PostUpdate, timeline, {
                runAfter: ['UILayoutLateSystem'],
                runBefore: ['UITransformFinalSystem'],
            });
            app.addSystemToSchedule(Schedule.PostUpdate, transformFinal, {
                runAfter: ['ScrollViewSystem', 'ListViewSystem'],
                runBefore: ['UIRenderOrderSystem'],
            });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            await (app as any).runSchedule(Schedule.PostUpdate);

            const layoutIdx = executionOrder.indexOf('UILayoutLateSystem');
            const timelineIdx = executionOrder.indexOf('TimelineSystem');
            const transformIdx = executionOrder.indexOf('UITransformFinalSystem');

            expect(layoutIdx).toBeLessThan(timelineIdx);
            expect(timelineIdx).toBeLessThan(transformIdx);
        });
    });

    describe('non-existent dependencies', () => {
        it('should ignore dependencies on non-existent systems', async () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            app.addSystemToSchedule(Schedule.Update, systemA, { runAfter: ['NonExistent'] });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };

            await expect((app as any).runSchedule(Schedule.Update)).resolves.not.toThrow();

            expect(executionOrder).toEqual(['A']);
        });
    });
});
