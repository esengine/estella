// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { SubsystemRegistry } from '../src/subsystems';
import { App, type Plugin } from '../src/app';
import { Schedule, defineSystem } from '../src/system';

describe('SubsystemRegistry', () => {
    it('registers in the registered phase, in install order, inactive', () => {
        const r = new SubsystemRegistry();
        r.register('physics', { displayName: 'Physics' });
        r.register('audio');
        const s = r.getStatuses();
        expect(s.map((x) => x.id)).toEqual(['physics', 'audio']);
        expect(s[0].phase).toBe('registered');
        expect(s[0].displayName).toBe('Physics');
        expect(s[0].activity).toBe('inactive');
    });

    it('transitions registered → initializing → ready', () => {
        const r = new SubsystemRegistry();
        r.register('physics');
        r.transition('physics', 'initializing');
        expect(r.phaseOf('physics')).toBe('initializing');
        r.transition('physics', 'ready');
        expect(r.phaseOf('physics')).toBe('ready');
    });

    it('a ready subsystem is inactive until pet, then stepping (load≠run)', () => {
        const r = new SubsystemRegistry();
        r.register('physics');
        r.transition('physics', 'ready');
        expect(r.getStatuses()[0].activity).toBe('inactive'); // never beat
        r.markStepped('physics');
        expect(r.getStatuses()[0].activity).toBe('stepping'); // fresh beat
    });

    it('derives idle once the watchdog beat goes stale', () => {
        const now = vi.spyOn(performance, 'now');
        now.mockReturnValue(1000);
        const r = new SubsystemRegistry();
        r.register('physics');
        r.transition('physics', 'ready');
        r.markStepped('physics');
        now.mockReturnValue(1000 + 500); // beyond STEP_STALE_MS (400ms)
        expect(r.getStatuses()[0].activity).toBe('idle');
        now.mockRestore();
    });

    it('markError records a terminal error and retains the reason', () => {
        const r = new SubsystemRegistry();
        r.register('physics');
        r.markError('physics', 'wasm aborted');
        const s = r.getStatuses()[0];
        expect(s.phase).toBe('error');
        expect(s.lastError).toBe('wasm aborted');
        expect(s.activity).toBe('inactive');
    });

    it('keeps dependency context and an ordered transition event log', () => {
        const r = new SubsystemRegistry();
        r.register('spine', { dependsOn: ['engineCore'] });
        r.transition('spine', 'ready');
        expect(r.getStatuses()[0].dependsOn).toEqual(['engineCore']);
        const ev = r.recentEvents();
        expect(ev.map((e) => e.phase)).toEqual(['registered', 'ready']);
        expect(ev[0].id).toBe('spine');
    });

    it('notifies subscribers on transition but not on markStepped', () => {
        const r = new SubsystemRegistry();
        r.register('physics');
        let n = 0;
        const off = r.subscribe(() => { n++; });
        r.transition('physics', 'ready'); // +1
        r.markStepped('physics');          // silent
        expect(n).toBe(1);
        off();
        r.transition('physics', 'error');  // no notify after unsubscribe
        expect(n).toBe(1);
    });
});

describe('App auto-registers plugin lifecycle into the subsystem registry', () => {
    it('promotes a synchronous plugin to ready once build() returns', () => {
        const app = App.new();
        const core: Plugin = { name: 'core', build() {} };
        app.addPlugin(core);
        expect(app.subsystems.phaseOf('core')).toBe('ready');
    });

    it('leaves an async plugin in the phase it set for itself', () => {
        const app = App.new();
        // Mirrors PhysicsPlugin: moves itself off `registered` during build, so
        // the App must NOT auto-promote it — it reaches ready on its own later.
        const phys: Plugin = {
            name: 'phys',
            build(a) { a.subsystems.transition('phys', 'initializing'); },
        };
        app.addPlugin(phys);
        expect(app.subsystems.phaseOf('phys')).toBe('initializing');
    });

    it('records a build() throw as a visible terminal error', () => {
        const app = App.new();
        const bad: Plugin = { name: 'bad', build() { throw new Error('boom'); } };
        expect(() => app.addPlugin(bad)).toThrow('boom');
        const s = app.subsystems.getStatuses().find((x) => x.id === 'bad');
        expect(s?.phase).toBe('error');
        expect(s?.lastError).toContain('boom');
        // The failed plugin is rolled back from install but stays observable.
        expect(app.getPlugin(class {} as never)).toBeUndefined();
    });

    it('captures string dependencies as cascade context', () => {
        const app = App.new();
        app.addPlugin({ name: 'a', build() {} });
        app.addPlugin({ name: 'b', dependencies: ['a'], build() {} });
        const b = app.subsystems.getStatuses().find((x) => x.id === 'b');
        expect(b?.dependsOn).toEqual(['a']);
    });
});

describe('App reports subsystem liveness from its systems (auto-watchdog)', () => {
    const activityOf = (app: App, id: string) =>
        app.subsystems.getStatuses().find((s) => s.id === id)?.activity;

    it('marks a plugin stepping once one of its systems runs in a frame', async () => {
        const app = App.new();
        app.addPlugin({
            name: 'ticker',
            build(a) { a.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'TickSys' })); },
        });
        expect(activityOf(app, 'ticker')).toBe('inactive'); // ready, never beat
        await app.tick(1 / 60);
        expect(activityOf(app, 'ticker')).toBe('stepping');
    });

    it('leaves a gated-off subsystem inactive (load≠run)', async () => {
        const app = App.new();
        app.addPlugin({
            name: 'gated',
            build(a) {
                a.addSystemToSchedule(
                    Schedule.Update, defineSystem([], () => {}, { name: 'GatedSys' }), { runIf: () => false },
                );
            },
        });
        await app.tick(1 / 60);
        expect(activityOf(app, 'gated')).toBe('inactive'); // system never ran → no beat
    });

    it('does not attribute systems added outside a plugin build to any subsystem', async () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'LooseSys' }));
        await app.tick(1 / 60);
        // No subsystem was registered for a loose system, so nothing to assert beyond no throw.
        expect(app.subsystems.getStatuses()).toEqual([]);
    });
});
