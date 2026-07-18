import { defineComponent } from 'esengine';

export const Heart = defineComponent('Heart', {
    beatScale: 1.35,
});

export const Spark = defineComponent('Spark', {
    vx: 0,
    vy: 0,
});

export const Drifter = defineComponent('Drifter', {
    vy: -110,
    baseX: 0,
    phase: 0,
});
