import { defineComponent, defineTag } from 'esengine';

export const Mover = defineComponent('Mover', {
    speed: 100,
    directionX: 1,
    directionY: 0,
});

export const Lifetime = defineComponent('Lifetime', {
    remaining: 5,
});

export const Spawner = defineComponent('Spawner', {
    interval: 0.8,
    timer: 0,
});

export const Bouncer = defineTag('Bouncer');
