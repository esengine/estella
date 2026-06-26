// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  End-to-end gameplay-loop integration: a real App schedules a
 *        defineInputMap evaluation system (PreUpdate) AND a defineBehavior system
 *        (Update); simulated keyboard + gamepad input drives the behavior, proving
 *        the input → action-map → behavior → entity path works through the actual
 *        runtime scheduler (not just the per-unit tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App, flushPendingSystems } from '../src/app';
import { Input, InputState, GamepadButton, GamepadAxis } from '../src/input';
import { defineInputMap, Axis2D, Button, Keys2D, Stick, Key, GpButton } from '../src/inputMap';
import { defineBehavior } from '../src/behavior';
import { AppContext, setDefaultContext } from '../src/context';
import type { GamepadSnapshot } from '../src/platform/types';

beforeEach(() => setDefaultContext(new AppContext()));

function pad(o: { buttons?: Record<number, number>; axes?: Record<number, number> } = {}): GamepadSnapshot {
    const buttons = new Array(17).fill(0), axes = new Array(4).fill(0);
    for (const [k, v] of Object.entries(o.buttons ?? {})) buttons[+k] = v;
    for (const [k, v] of Object.entries(o.axes ?? {})) axes[+k] = v;
    return { index: 0, connected: true, buttons, axes, mapping: 'standard' };
}

describe('gameplay loop integration (input map + behavior + scheduler)', () => {
    it('drives a behavior from keyboard and gamepad through the real App', async () => {
        const Game = defineInputMap({
            Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'), Stick('left')),
            Fire: Button(Key('Space'), GpButton(GamepadButton.South)),
        });

        let fired = 0;
        const Player = defineBehavior<{ x: number; y: number; speed: number }>('Player', {
            state: { x: 0, y: 0, speed: 10 },
            update(ctx, dt) {
                const m = Game.axis2d('Move');
                ctx.self.x += m.x * ctx.self.speed * dt;
                ctx.self.y += m.y * ctx.self.speed * dt;
                if (Game.pressed('Fire')) fired++;
            },
        });

        const app = App.new();
        const input = new InputState();
        app.insertResource(Input, input); // no inputPlugin (no platform in tests) — drive the state directly
        flushPendingSystems(app);         // InputMapEval (PreUpdate) + Behavior:Player (Update)

        const e = app.world.spawn();
        app.world.insert(e, Player, { x: 0, y: 0, speed: 10 });
        const self = () => app.world.get(e, Player) as { x: number; y: number };

        // Frame 1 — hold D (move +x) and press Space (fire).
        input.keysDown.add('KeyD');
        input.keysDown.add('Space');
        await app.tick(0.1);
        expect(self().x).toBeCloseTo(1);  // 1 (right) * 10 * 0.1
        expect(self().y).toBe(0);
        expect(fired).toBe(1);            // Fire pressed this frame

        // Frame 2 — keep moving, release Space (no new fire).
        input.keysDown.delete('Space');
        await app.tick(0.1);
        expect(self().x).toBeCloseTo(2);
        expect(fired).toBe(1);

        // Frame 3 — switch to gamepad: left stick up, button South = fire.
        input.keysDown.delete('KeyD');
        input.updateGamepads([pad({ axes: { [GamepadAxis.LeftY]: -1 }, buttons: { [GamepadButton.South]: 1 } })]);
        await app.tick(0.1);
        expect(self().x).toBeCloseTo(2);   // no horizontal input
        expect(self().y).toBeCloseTo(1);   // stick up → +y
        expect(fired).toBe(2);             // gamepad South fired
    });

    it('runs behavior lifecycle (start/destroy) under the real schedule on despawn', async () => {
        const events: string[] = [];
        const Enemy = defineBehavior('Enemy', {
            start: () => events.push('start'),
            destroy: () => events.push('destroy'),
        });
        const app = App.new();
        app.insertResource(Input, new InputState());
        flushPendingSystems(app);

        const e = app.world.spawn();
        app.world.insert(e, Enemy, {});
        await app.tick(0.016);
        expect(events).toEqual(['start']);

        app.world.despawn(e);
        await app.tick(0.016);
        expect(events).toEqual(['start', 'destroy']);
    });
});
