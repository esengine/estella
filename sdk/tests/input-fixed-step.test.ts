// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { App } from '../src/app';
import { Schedule, defineSystem } from '../src/system';
import { Res } from '../src/resource';
import { Input, InputState } from '../src/input';

/**
 * Edge input (isKeyPressed / isMouseButtonPressed) read from a FixedUpdate-family
 * schedule must reach exactly one fixed step — the render-frame edge lifecycle
 * (cleared in Schedule.Last) otherwise drops presses on sub-timestep frames and
 * replays them on catch-up frames. See InputState fixed-edge mirrors.
 */
describe('input edges in fixed timestep', () => {
    // fixedTimestep defaults to 1/60. tick(1/120) advances the accumulator by half
    // a step, so two of them equal one step — lets us build sub-timestep frames.
    const HALF = 1 / 120;
    const STEP = 1 / 60;

    function harness() {
        const app = App.new();
        const input = new InputState();
        app.insertResource(Input, input);

        let fixedPressed = 0;
        let updatePressed = 0;
        let fixedHeld = 0;

        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem(
            [Res(Input)],
            (i: InputState) => {
                if (i.isKeyPressed('Space')) fixedPressed++;
                if (i.isKeyDown('KeyD')) fixedHeld++;
            },
            { name: 'FixedRead' },
        ));
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input)],
            (i: InputState) => { if (i.isKeyPressed('Space')) updatePressed++; },
            { name: 'UpdateRead' },
        ));
        // Mirrors InputPlugin's InputClearSystem (clears render edges each frame).
        app.addSystemToSchedule(Schedule.Last, defineSystem(
            [Res(Input)],
            (i: InputState) => { i.clearFrameState(); },
            { name: 'ClearRender' },
        ));

        return {
            app, input,
            counts: () => ({ fixedPressed, updatePressed, fixedHeld }),
        };
    }

    it('delivers a press from a sub-timestep frame to the next fixed step, once', async () => {
        const h = harness();

        // Frame 1: the press arrives on a frame too short to run a fixed step.
        h.input.noteKeyDown('Space');
        await h.app.tick(HALF);
        expect(h.counts().fixedPressed).toBe(0); // no fixed step ran this frame

        // Frame 2: accumulator now reaches one step, which consumes the buffered press.
        await h.app.tick(HALF);
        expect(h.counts().fixedPressed).toBe(1);

        // Later steps must not replay it.
        await h.app.tick(STEP);
        await h.app.tick(STEP);
        expect(h.counts().fixedPressed).toBe(1);
    });

    it('delivers a press only once even when a frame runs multiple fixed steps', async () => {
        const h = harness();

        h.input.noteKeyDown('Space');
        // A long frame: two steps' worth of accumulator in one tick.
        await h.app.tick(2 * STEP);
        expect(h.counts().fixedPressed).toBe(1);
    });

    it('still delivers the press to render-context systems once per frame', async () => {
        const h = harness();

        h.input.noteKeyDown('Space');
        await h.app.tick(STEP);
        expect(h.counts().updatePressed).toBe(1);

        // Edge is gone next frame (render edge cleared in Last).
        await h.app.tick(STEP);
        expect(h.counts().updatePressed).toBe(1);
    });

    it('reads held keys in fixed context every step, regardless of frame timing', async () => {
        const h = harness();

        h.input.noteKeyDown('KeyD'); // held down
        await h.app.tick(STEP); // 1 step
        await h.app.tick(2 * STEP); // 2 steps
        expect(h.counts().fixedHeld).toBe(3);

        h.input.noteKeyUp('KeyD');
        await h.app.tick(STEP);
        expect(h.counts().fixedHeld).toBe(3);
    });
});
