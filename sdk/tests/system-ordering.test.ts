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
        it('should run systems in dependency order', () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            app.addSystemToSchedule(Schedule.Update, systemB, { runAfter: ['SystemA'] });
            app.addSystemToSchedule(Schedule.Update, systemA);

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            (app as any).runSchedule(Schedule.Update);

            expect(executionOrder).toEqual(['A', 'B']);
        });

        it('should handle multiple runAfter dependencies', () => {
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
            (app as any).runSchedule(Schedule.Update);

            const aIndex = executionOrder.indexOf('A');
            const bIndex = executionOrder.indexOf('B');
            const cIndex = executionOrder.indexOf('C');

            expect(aIndex).toBeLessThan(cIndex);
            expect(bIndex).toBeLessThan(cIndex);
        });
    });

    describe('runBefore', () => {
        it('should run system before specified target', () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            app.addSystemToSchedule(Schedule.Update, systemB);
            app.addSystemToSchedule(Schedule.Update, systemA, { runBefore: ['SystemB'] });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };
            (app as any).runSchedule(Schedule.Update);

            expect(executionOrder).toEqual(['A', 'B']);
        });
    });

    describe('mixed dependencies', () => {
        it('should handle runBefore and runAfter together', () => {
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
            (app as any).runSchedule(Schedule.Update);

            const aIndex = executionOrder.indexOf('A');
            const bIndex = executionOrder.indexOf('B');
            const cIndex = executionOrder.indexOf('C');

            expect(aIndex).toBeLessThan(bIndex);
            expect(cIndex).toBeLessThan(bIndex);
        });
    });

    describe('circular dependency detection', () => {
        it('should throw on circular dependencies', () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            const systemB = defineSystem([], () => {
                executionOrder.push('B');
            }, { name: 'SystemB' });

            app.addSystemToSchedule(Schedule.Update, systemA, { runAfter: ['SystemB'] });
            app.addSystemToSchedule(Schedule.Update, systemB, { runAfter: ['SystemA'] });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };

            expect(() => {
                (app as any).runSchedule(Schedule.Update);
            }).toThrow('Circular dependency');
        });
    });

    describe('systems without dependencies', () => {
        it('should run in registration order when no dependencies specified', () => {
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
            (app as any).runSchedule(Schedule.Update);

            expect(executionOrder).toEqual(['A', 'B', 'C']);
        });
    });

    describe('non-existent dependencies', () => {
        it('should ignore dependencies on non-existent systems', () => {
            const systemA = defineSystem([], () => {
                executionOrder.push('A');
            }, { name: 'SystemA' });

            app.addSystemToSchedule(Schedule.Update, systemA, { runAfter: ['NonExistent'] });

            (app as any).runner_ = { run: (sys: any) => sys._fn() };

            expect(() => {
                (app as any).runSchedule(Schedule.Update);
            }).not.toThrow();

            expect(executionOrder).toEqual(['A']);
        });
    });
});
