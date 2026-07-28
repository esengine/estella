import { defineComponent } from 'esengine';

/** Which animation an armature is on, and how long it has held it. */
export const AnimState = defineComponent('AnimState', {
    timer: 0,
    index: 0,
});

/** Tags the label that names the animation currently playing. */
export const Readout = defineComponent('Readout', {});
