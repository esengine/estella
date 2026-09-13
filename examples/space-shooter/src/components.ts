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

// A tag in all but name: what a star DOES is drift, and that is `Velocity` on
// the prefab. This marks the ones the wrap belongs to.
export const Star = defineComponent('Star', {});

export const Explosion = defineComponent('Explosion', {
    timer: 0.3,
});

export const Hull = defineComponent('Hull', {
    value: 3,
    maxValue: 3,
});

export const ScoreDisplay = defineTag('ScoreDisplay');
export const HealthHeart = defineTag('HealthHeart');
/** The mask whose width IS the hull bar's fill — see the HUD system. */
export const HullBarMask = defineTag('HullBarMask');
export const GameOverScreen = defineTag('GameOverScreen');
