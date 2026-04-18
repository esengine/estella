/**
 * @file    scheduler-cycles.test.ts
 * @brief   Cycle detection quality + re-sort idempotence after sortSystems.
 */
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import { Schedule, defineSystem } from '../src/system';

function trackedSystem(name: string, trace: string[]) {
    return defineSystem([], () => { trace.push(name); }, { name });
}

describe('sortSystems cycle detection', () => {
    async function runUpdate(app: App) {
        (app as any).runner_ = { run: (sys: any) => sys._fn() };
        await (app as any).runSchedule(Schedule.Update);
    }

    it('reports the full cycle path, not just one member', async () => {
        const app = App.new();
        const trace: string[] = [];
        app.addSystemToSchedule(Schedule.Update, trackedSystem('A', trace), { runAfter: ['C'] });
        app.addSystemToSchedule(Schedule.Update, trackedSystem('B', trace), { runAfter: ['A'] });
        app.addSystemToSchedule(Schedule.Update, trackedSystem('C', trace), { runAfter: ['B'] });

        let caught: Error | null = null;
        try { await runUpdate(app); } catch (e) { caught = e as Error; }
        expect(caught).not.toBeNull();
        expect(caught!.message).toMatch(/Circular system dependency:/);
        // DFS may traverse in either direction; either rotation is acceptable
        // so long as all three systems appear with a self-closing edge.
        expect(caught!.message).toContain('A');
        expect(caught!.message).toContain('B');
        expect(caught!.message).toContain('C');
        // The first node must repeat at the end, closing the loop.
        const path = caught!.message.split('Circular system dependency: ')[1].split(' → ');
        expect(path[0]).toBe(path[path.length - 1]);
        expect(path).toHaveLength(4);
    });

    it('catches cycles introduced through runBefore (asymmetry regression)', async () => {
        const app = App.new();
        const trace: string[] = [];
        app.addSystemToSchedule(Schedule.Update, trackedSystem('A', trace), { runBefore: ['B'] });
        app.addSystemToSchedule(Schedule.Update, trackedSystem('B', trace), { runBefore: ['A'] });

        await expect(runUpdate(app)).rejects.toThrow(/A → B → A|B → A → B/);
    });

    it('produces the same order on two consecutive sorts of the same schedule', async () => {
        const app = App.new();
        const trace: string[] = [];
        app.addSystemToSchedule(Schedule.Update, trackedSystem('A', trace), { runBefore: ['B'] });
        app.addSystemToSchedule(Schedule.Update, trackedSystem('B', trace), { runAfter: ['A'] });
        app.addSystemToSchedule(Schedule.Update, trackedSystem('C', trace), { runAfter: ['B'] });

        (app as any).runner_ = { run: (sys: any) => sys._fn() };
        await (app as any).runSchedule(Schedule.Update);
        await (app as any).runSchedule(Schedule.Update);

        // Two runs → same order twice → A,B,C,A,B,C (no edge duplication
        // artifacts that would skew a second sort).
        expect(trace).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });

    it('does not mutate registered SystemEntry objects across sorts', async () => {
        const app = App.new();
        const trace: string[] = [];
        app.addSystemToSchedule(Schedule.Update, trackedSystem('A', trace), { runBefore: ['B'] });
        app.addSystemToSchedule(Schedule.Update, trackedSystem('B', trace));

        const entries = (app as any).systems_.get(Schedule.Update) as Array<{
            system: { _name: string };
            runBefore?: string[];
            runAfter?: string[];
        }>;
        const entryB = entries.find(e => e.system._name === 'B')!;
        const runAfterBeforeSort = entryB.runAfter;

        (app as any).runner_ = { run: (sys: any) => sys._fn() };
        await (app as any).runSchedule(Schedule.Update);
        await (app as any).runSchedule(Schedule.Update);

        // B's runAfter must be unchanged after multiple sorts. Previously the
        // scheduler pushed 'A' onto B.runAfter as a side effect of resolving
        // A.runBefore, leaving duplicated edges in persistent state.
        expect(entryB.runAfter).toBe(runAfterBeforeSort);
    });
});
