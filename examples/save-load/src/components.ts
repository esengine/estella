import { defineComponent } from 'esengine';

export const Player = defineComponent('Player', {
    speed: 260,
});

export const Coin = defineComponent('Coin', {
    index: 0,
    phase: 0,
});
