import {
    defineSystem, Res, GetWorld,
    Time, Input, UICameraInfo, Transform, UIInteraction,
} from 'esengine';
import type { TransformData, UIInteractionData } from 'esengine';

import { SLIDER_W, PROGRESS_SPEED } from '../config';
import { state } from '../state';

// Per-frame wiring for the two widgets the factories don't self-drive:
//   • Slider — createSlider ships no input, so we drag it here. The engine's
//     hit-test already sets UIInteraction.hovered on the track; we only map the
//     pointer's world x (same space as the track's laid-out worldPosition) back
//     to a 0..100 value.
//   • Progress — a simple time-driven ping-pong, pausable via the toggle.
export const controlsSystem = defineSystem(
    [Res(Time), Res(Input), Res(UICameraInfo), GetWorld()],
    (time, input, camera, world) => {
        const slider = state.slider;
        if (slider && camera.valid && world.valid(slider.trackEntity)) {
            const inter = world.get(slider.trackEntity, UIInteraction) as UIInteractionData;
            if (input.isMouseButtonPressed(0) && inter.hovered) state.dragging = true;
            if (!input.isMouseButtonDown(0)) state.dragging = false;

            if (state.dragging) {
                const wt = world.get(slider.trackEntity, Transform) as TransformData;
                const width = SLIDER_W * wt.worldScale.x;          // px == world units, times canvas scale
                const left = wt.worldPosition.x - width / 2;
                slider.setValue(slider.valueAtLocalX(camera.worldMouseX - left, width));
            }
        }

        const progress = state.progress;
        if (progress && !state.paused) {
            state.progressT += time.delta * PROGRESS_SPEED * state.progressDir;
            if (state.progressT >= 1) { state.progressT = 1; state.progressDir = -1; }
            else if (state.progressT <= 0) { state.progressT = 0; state.progressDir = 1; }
            progress.setValue(state.progressT);
        }
    },
    { name: 'ControlsSystem' },
);
