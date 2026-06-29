// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app';
import { defineSystem, Schedule } from '../src/system';
import { defineComponent, clearUserComponents, getUserComponentFingerprint, getUserComponents } from '../src/component';
import { setDefaultContext, AppContext } from '../src/context';
import { addSystemToSchedule } from '../src/system';
import { probeRegistrations } from '../src/hotReload';

// RC10 P3: the state-preserving hot-reload core — App.hotSwapSystems replaces user
// system bodies in place (keeping the live World), and the component fingerprint gates
// hot-swap (logic-only) vs full-reload (a component's fields changed).
describe('App.hotSwapSystems', () => {
    let app: App;
    let log: string[];
    beforeEach(() => { app = App.new(); log = []; });

    async function runUpdate(): Promise<void> {
        (app as unknown as { runner_: unknown }).runner_ = { run: (sys: { _fn: () => void }) => sys._fn() };
        await (app as unknown as { runSchedule: (s: Schedule) => Promise<void> }).runSchedule(Schedule.Update);
    }

    it('swaps a named system body in place, keeping it scheduled', async () => {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => log.push('old'), { name: 'S' }));
        await runUpdate();
        expect(log).toEqual(['old']);

        const ok = app.hotSwapSystems([
            { schedule: Schedule.Update, system: defineSystem([], () => log.push('new'), { name: 'S' }) },
        ]);
        expect(ok).toBe(true);

        log.length = 0;
        await runUpdate();
        expect(log).toEqual(['new']);
    });

    it('rejects an added system (count change) → caller full-reloads', () => {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'S' }));
        expect(app.hotSwapSystems([
            { schedule: Schedule.Update, system: defineSystem([], () => {}, { name: 'S' }) },
            { schedule: Schedule.Update, system: defineSystem([], () => {}, { name: 'T' }) },
        ])).toBe(false);
    });

    it('rejects a rename → full-reload', () => {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'S' }));
        expect(app.hotSwapSystems([
            { schedule: Schedule.Update, system: defineSystem([], () => {}, { name: 'Renamed' }) },
        ])).toBe(false);
    });

    it('matches unnamed systems positionally (System_N ⇔ unnamed)', async () => {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => log.push('a-old')));
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => log.push('b-old')));
        expect(app.hotSwapSystems([
            { schedule: Schedule.Update, system: defineSystem([], () => log.push('a-new')) },
            { schedule: Schedule.Update, system: defineSystem([], () => log.push('b-new')) },
        ])).toBe(true);

        await runUpdate();
        expect(log.sort()).toEqual(['a-new', 'b-new']);
    });
});

describe('getUserComponentFingerprint', () => {
    beforeEach(() => setDefaultContext(new AppContext()));

    it('is stable when only default values change (logic-only edit)', () => {
        defineComponent('Patrol', { speed: 60, range: 120 });
        const before = getUserComponentFingerprint();
        clearUserComponents();
        defineComponent('Patrol', { speed: 80, range: 200 }); // values differ, shape same
        expect(getUserComponentFingerprint()).toBe(before);
    });

    it('changes when a field is added (schema change → must full-reload)', () => {
        defineComponent('Patrol', { speed: 60 });
        const before = getUserComponentFingerprint();
        clearUserComponents();
        defineComponent('Patrol', { speed: 60, accel: 5 });
        expect(getUserComponentFingerprint()).not.toBe(before);
    });

    it('is order-independent across components', () => {
        defineComponent('A', { x: 0 });
        defineComponent('B', { y: '' });
        const f1 = getUserComponentFingerprint();
        clearUserComponents();
        defineComponent('B', { y: '' });
        defineComponent('A', { x: 0 });
        expect(getUserComponentFingerprint()).toBe(f1);
    });
});

describe('probeRegistrations', () => {
    beforeEach(() => setDefaultContext(new AppContext()));

    it('collects a re-import\'s registrations in isolation and restores the live context', async () => {
        defineComponent('Live', { a: 0 });
        const liveBefore = [...getUserComponents().keys()];

        const { fingerprint, pending } = await probeRegistrations(async () => {
            defineComponent('Probe', { b: 0 });
            addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'PS' }));
        });

        expect(fingerprint).toContain('Probe');
        expect(pending).toHaveLength(1);
        expect((pending[0].system as { _name: string })._name).toBe('PS');

        // The probe registrations must NOT have leaked into the live context.
        expect([...getUserComponents().keys()]).toEqual(liveBefore);
        expect(getUserComponents().has('Probe')).toBe(false);
    });
});
