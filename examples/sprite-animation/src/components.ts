import { defineComponent } from 'esengine';

// The controllable character. `vx` is the eased horizontal velocity (its
// magnitude feeds the Animator's `speed` parameter); `hopTime` tracks the
// vertical arc while the Hop state plays.
export const Player = defineComponent('Player', {
    vx: 0,
    hopTime: 0,
});

// A footstep dust puff — fades and rises over its short life.
export const Puff = defineComponent('Puff', {
    life: 0.5,
});

// Walk-clip frame events land here (the listener fires inside the animation
// update, so spawning is deferred to puffSystem's Commands the same frame).
export const footsteps = { pending: 0 };
