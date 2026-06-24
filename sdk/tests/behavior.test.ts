// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { App, flushPendingSystems } from '../src/app';
import { defineBehavior } from '../src/behavior';
import { AppContext, setDefaultContext } from '../src/context';
import { getUserComponents } from '../src/component';
import { Schedule } from '../src/system';

// Each test gets a fresh context so behaviors/components/pending-systems don't leak.
beforeEach(() => setDefaultContext(new AppContext()));

describe('defineBehavior', () => {
    it('registers a tunable component the editor can discover', () => {
        defineBehavior('Patrol', { state: { speed: 60 } });
        const comp = getUserComponents().get('Patrol');
        expect(comp).toBeDefined();
        expect(comp!._name).toBe('Patrol');
        // The component carries the state defaults → inspector renders a `speed` field.
        expect((comp as { _default: { speed: number } })._default.speed).toBe(60);
    });

    it('drives start (once) → update (each frame) → destroy (on despawn)', async () => {
        const events: string[] = [];
        const Bhv = defineBehavior<{ n: number }>('Lifecycle', {
            state: { n: 0 },
            start(ctx) { events.push(`start:${ctx.self.n}`); ctx.self.n = 100; },
            update(ctx) { ctx.self.n += 1; events.push(`update:${ctx.self.n}`); },
            destroy(ctx) { events.push(`destroy:${ctx.self.n}`); },
        });

        const app = App.new();
        flushPendingSystems(app);

        const e = app.world.spawn('e1');
        app.world.insert(e, Bhv, { n: 0 });

        await app.tick(1 / 60); // start (0→100) then update (→101)
        await app.tick(1 / 60); // update (→102)

        app.world.despawn(e);
        await app.tick(1 / 60); // entity gone → destroy with last data

        expect(events).toEqual(['start:0', 'update:101', 'update:102', 'destroy:102']);
    });

    it('fires start exactly once even across many frames', async () => {
        let starts = 0;
        const Bhv = defineBehavior('Once', { start() { starts++; } });
        const app = App.new();
        flushPendingSystems(app);
        const e = app.world.spawn();
        app.world.insert(e, Bhv, {});

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        await app.tick(1 / 60);

        expect(starts).toBe(1);
    });

    it('fires destroy when only the component is removed (entity survives)', async () => {
        let destroyed = 0;
        const Bhv = defineBehavior('OnRemove', { destroy() { destroyed++; } });
        const app = App.new();
        flushPendingSystems(app);
        const e = app.world.spawn();
        app.world.insert(e, Bhv, {});

        await app.tick(1 / 60);
        expect(destroyed).toBe(0);

        app.world.remove(e, Bhv);
        await app.tick(1 / 60);
        expect(destroyed).toBe(1);
        expect(app.world.valid(e)).toBe(true); // entity itself still alive
    });

    it('runs runtime-spawned entities (start fires when they appear)', async () => {
        const started: string[] = [];
        const Bhv = defineBehavior('Spawned', { start(ctx) { started.push(`e${ctx.entity}`); } });
        const app = App.new();
        flushPendingSystems(app);

        await app.tick(1 / 60); // nothing yet
        expect(started).toEqual([]);

        const e = app.world.spawn();
        app.world.insert(e, Bhv, {});
        await app.tick(1 / 60); // now it appears → start
        expect(started).toEqual([`e${e}`]);
    });

    it('honors a custom schedule', async () => {
        const order: string[] = [];
        defineBehavior('Fixed', { schedule: Schedule.FixedUpdate, update() { order.push('fixed'); } });
        const app = App.new();
        flushPendingSystems(app);
        const Other = defineBehavior('Var', { update() { order.push('var'); } });
        flushPendingSystems(app);
        const e = app.world.spawn();
        app.world.insert(e, getUserComponents().get('Fixed')!, {});
        app.world.insert(e, Other, {});

        await app.tick(1 / 60); // one fixed step (accumulator hits 1/60) + the Update step

        expect(order).toContain('fixed');
        expect(order).toContain('var');
    });
});
