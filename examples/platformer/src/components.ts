import { defineComponent } from 'esengine';

export const Coin = defineComponent('Coin', {
    baseY: 0,
    bobTimer: 0,
});

export const ScoreDisplay = defineComponent('ScoreDisplay', {
    score: 0,
});
