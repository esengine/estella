import type { Entity, SliderHandle, ProgressHandle } from 'esengine';

// Handles the build system hands to the per-frame controls system. Widget
// callbacks (button/toggle/dropdown/dialog) are self-wired at build time and
// need nothing here; only the slider (pointer drag) and the progress bar
// (time-driven animation) are ticked each frame.
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
