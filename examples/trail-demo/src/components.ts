import { defineComponent, defineTag } from 'esengine';

// The project's declaration entry (src/components.ts): user component/tag
// definitions only — no systems. (TrailRenderer is an engine built-in, so it
// isn't declared here.)

/** Marks the emitter riding the Lissajous figure. */
export const Comet = defineTag('Comet');

/** Marks the emitter that eases toward the mouse cursor. */
export const Follower = defineTag('Follower');

/** The click-to-dash emitter and its in-flight dash state. */
export const Dasher = defineComponent('Dasher', {
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    t: 0,
    active: false,
});

/** Pins a floating world-space label to its emitter (`target` entity id). */
export const LabelOf = defineComponent('LabelOf', {
    target: -1,
    offsetY: 34,
});
