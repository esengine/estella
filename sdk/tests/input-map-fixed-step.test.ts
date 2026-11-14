// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { Button, Key, MouseButton, Axis1D, Virtual, defineInputMap } from '../src/input/inputMap';

let context: AppContext;
beforeEach(() => {
    context = new AppContext(); setDefaultContext(context);
    vi.spyOn(performance, 'now').mockReturnValue(0);
});
afterEach(() => { vi.restoreAllMocks(); });

function harness() {
    const map = defineInputMap({ Jump: Button(Key('Space'), MouseButton(0)), Move: Axis1D(Virtual('move')) });
    const app = App.new(), input = new InputState();
    app.insertResource(Input, input);
    app.addBundleSystems(context.drainPendingSystems() as Parameters<App['addBundleSystems']>[0]);
    const fixed: boolean[] = [], rendered: boolean[] = [], released: boolean[] = [], held: boolean[] = [], movement: number[] = [];
    app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => {
        fixed.push(map.pressed('Jump')); released.push(map.released('Jump')); held.push(map.down('Jump')); movement.push(map.value('Move'));
    }));
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { rendered.push(map.pressed('Jump')); }));
    app.addSystemToSchedule(Schedule.Last, defineSystem([], () => input.clearFrameState()));
    return { app, input, map, fixed, rendered, released, held, movement };
}

describe('named actions in fixed timestep', () => {
    it('delivers current input once on a catch-up frame and independently to Update', async () => {
        const h = harness();
        h.input.noteKeyDown('Space');
        await h.app.tick(2 / 60);
        expect(h.fixed).toEqual([true, false]);
        expect(h.rendered).toEqual([true]);
        await h.app.tick(1 / 60);
        expect(h.fixed).toEqual([true, false, false]);
    });
    it('retains a short tap across render frames with no fixed step', async () => {
        const h = harness();
        h.input.noteKeyDown('Space'); h.input.noteKeyUp('Space');
        await h.app.tick(1 / 120);
        expect(h.fixed).toEqual([]);
        expect(h.rendered).toEqual([true]);
        await h.app.tick(1 / 120);
        expect(h.fixed).toEqual([true]);
        expect(h.rendered).toEqual([true, false]);
        await h.app.tick(1 / 60);
        expect(h.fixed).toEqual([true, false]);
    });
    it('does not repeat a buffered tap on catch-up steps', async () => {
        const h = harness();
        h.input.noteKeyDown('Space'); h.input.noteKeyUp('Space');
        await h.app.tick(1 / 120);
        await h.app.tick(3 / 120);
        expect(h.fixed).toEqual([true, false]);
        expect(h.released).toEqual([true, false]);
        expect(h.held).toEqual([false, false]);
    });
    it('delivers mouse release/repress independently to both cadences', async () => {
        const h = harness();
        h.input.noteMouseDown(0); await h.app.tick(1 / 60);
        h.input.noteMouseUp(0); h.input.noteMouseDown(0); await h.app.tick(2 / 60);
        expect(h.fixed).toEqual([true, true, false]);
        expect(h.released).toEqual([false, true, false]);
        expect(h.rendered).toEqual([true, true]);
        expect(h.held).toEqual([true, true, true]);
    });
    it('cancels a rendered pulse before the next simulation step', async () => {
        const h = harness();
        h.input.noteKeyDown('Space'); h.input.noteKeyUp('Space');
        await h.app.tick(1 / 120);
        inputEventCallbacks(h.input).onInputCancel!();
        await h.app.tick(1 / 120);
        expect(h.fixed).toEqual([false]);
        expect(h.released).toEqual([false]);
    });
    it('samples axes on the current step rather than the previous render frame', async () => {
        const h = harness();
        h.input.setVirtual('move', .75); await h.app.tick(2 / 60);
        h.input.setVirtual('move', -.25); await h.app.tick(1 / 60);
        expect(h.movement).toEqual([.75, .75, -.25]);
        expect(h.map.value('Move')).toBe(-.25);
    });
    it('retains pending edges while scaled simulation is stopped', async () => {
        const h = harness();
        h.input.noteKeyDown('Space'); h.input.noteKeyUp('Space');
        for (let frame = 0; frame < 200; frame++) await h.app.tick(0);
        expect(h.fixed).toEqual([]);
        await h.app.tick(2 / 60);
        expect(h.fixed).toEqual([true, false]);
        expect(h.rendered.filter(Boolean)).toHaveLength(1);
    });
});
