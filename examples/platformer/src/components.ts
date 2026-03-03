import { defineComponent } from 'esengine';

export const Player = defineComponent('Player', {
    speed: 300,
    jumpForce: 600,
    velocityY: 0,
    isGrounded: false,
});

export const Coin = defineComponent('Coin', {
    baseY: 0,
    bobTimer: 0,
});

export const ScoreDisplay = defineComponent('ScoreDisplay', {
    score: 0,
});

export const Platform = defineComponent('Platform', {
    width: 0,
    height: 0,
});
