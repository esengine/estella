import { defineComponent } from 'esengine';

export const Collectible = defineComponent('Collectible', {
    points: 10,
    pulseSpeed: 3,
});

export const ScoreLabel = defineComponent('ScoreLabel', {
    dummy: 0,
});
