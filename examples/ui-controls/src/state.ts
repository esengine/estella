import type { SliderHandle, ProgressHandle } from 'esengine';

export const state = {
    slider: null as SliderHandle | null,
    progress: null as ProgressHandle | null,
    dragging: false,
    progressT: 0,
    progressDir: 1,
    paused: false,
};
