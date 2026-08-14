import { defineComponent } from 'esengine';

export const Player = defineComponent('Player', {
    speed: 320,
    jumpForce: 640,
});

export const Coin = defineComponent('Coin', {
    baseY: 0,
    bobTimer: 0,
});

export const ScoreDisplay = defineComponent('ScoreDisplay', {
    score: 0,
});
