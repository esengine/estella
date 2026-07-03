import type { Entity, SliderHandle, ProgressHandle } from 'esengine';

// What buildSystem hands to the per-frame controls system (only the slider and
// progress bar are ticked; the other widgets self-wire their callbacks).
export const state = {
    slider: null as SliderHandle | null,
    progress: null as ProgressHandle | null,
    /** Left label of the slider row — updated with the live "Volume  N%". */
    volumeLabel: 0 as Entity,

    /** True while the pointer is dragging the slider track. */
    dragging: false,
    /** Progress animation phase 0..1 and its ping-pong direction. */
    progressT: 0,
    progressDir: 1,
    /** Toggle-controlled pause for the progress animation. */
    paused: false,
};
