import { defineSystem, Res, Time } from 'esengine';

import { PROGRESS_SPEED } from '../config';
import { state } from '../state';

export const controlsSystem = defineSystem(
    [Res(Time)],
    (time) => {
        // Slider input (drag + arrow keys) is built into the UISlider system.
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
