import { defineComponent, defineTag } from 'esengine';

export const Wave = defineComponent('Wave', {
    amplitude: 20,
    frequency: 2,
    phase: 0,
});

export const Orbit = defineComponent('Orbit', {
    centerX: 0,
    centerY: 0,
    radius: 80,
    speed: 1,
    angle: 0,
});

export const FlipDemo = defineTag('FlipDemo');
