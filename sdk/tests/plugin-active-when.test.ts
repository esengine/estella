// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A plugin's systems run only while some entity has one of the components its work
 * is about (Plugin.activeWhen), and for one frame after the last one goes, so it can
 * let go of what it held. A game without water pays nothing for the water plugin.
 */
import { describe, it, expect } from 'vitest';
import { App, type Plugin } from '../src/app/app';
import { defineSystem, Schedule } from '../src/ecs/system';
import { defineComponent } from '../src/ecs/component';

describe('Plugin.activeWhen', () => {
    it('skips the plugin while its components are absent, and runs one frame past the last', async () => {
        const Pond = defineComponent('ActiveWhenPond', { depth: 1 });
        let runs = 0;
        const plugin: Plugin = {
            name: 'pond',
            activeWhen: [Pond],
            build(app) { app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { runs++; }, { name: 'PondSystem' })); },
        };
        const app = App.new();
        app.addPlugin(plugin);
        await app.tick(1 / 60);   // the first frame is the one-past of "present" until decided otherwise
        runs = 0;
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(runs).toBe(0);

        const e = app.world.spawn();
        app.world.insert(e, Pond, { depth: 2 });
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(runs).toBe(2);

        app.world.despawn(e);
        await app.tick(1 / 60);   // the frame after: still runs, to release
        expect(runs).toBe(3);
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(runs).toBe(3);
    });

    it('leaves a plugin without activeWhen running every frame', async () => {
        let runs = 0;
        const app = App.new();
        app.addPlugin({ name: 'always', build(a) { a.addSystemToSchedule(Schedule.Update, defineSystem([], () => { runs++; }, { name: 'Always' })); } });
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(runs).toBe(2);
    });

    it('gates one system on its own, inside a plugin that is not gated', async () => {
        const Lamp = defineComponent('ActiveWhenLamp', { on: true });
        let gated = 0, always = 0;
        const app = App.new();
        app.addPlugin({ name: 'mixed', build(a) {
            a.addSystemToSchedule(Schedule.Update, defineSystem([], () => { always++; }, { name: 'Always2' }));
            a.addSystemToSchedule(Schedule.Update, defineSystem([], () => { gated++; }, { name: 'LampSystem' }), { activeWhen: [Lamp] });
        } });
        await app.tick(1 / 60);
        gated = 0; always = 0;
        await app.tick(1 / 60);
        expect([gated, always]).toEqual([0, 1]);
        const e = app.world.spawn();
        app.world.insert(e, Lamp, { on: true });
        await app.tick(1 / 60);
        expect([gated, always]).toEqual([1, 2]);
    });
});
