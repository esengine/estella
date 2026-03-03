import { defineComponent, defineTag } from 'esengine';

export const PlayerControl = defineComponent('PlayerControl', {
    speed: 250,
});

export const MouseFollower = defineTag('MouseFollower');

export const Trail = defineComponent('Trail', {
    lifetime: 0.6,
});
