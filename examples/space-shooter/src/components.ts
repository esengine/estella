import { defineComponent, defineTag } from 'esengine';

export const Player = defineComponent('Player', {
    speed: 400,
});

export const Enemy = defineComponent('Enemy', {
    speed: 150,
    type: 'A',
    shootTimer: 2,
    phase: 0,
});

export const Bullet = defineComponent('Bullet', {
    speed: 600,
    fromPlayer: true,
});

export const Star = defineComponent('Star', {
    speed: 30,
    layer: 0,
});

export const Explosion = defineComponent('Explosion', {
    timer: 0.3,
});

export const Health = defineComponent('Health', {
    value: 3,
    maxValue: 3,
});

export const ScoreDisplay = defineTag('ScoreDisplay');
export const HealthHeart = defineTag('HealthHeart');
export const GameOverScreen = defineTag('GameOverScreen');
