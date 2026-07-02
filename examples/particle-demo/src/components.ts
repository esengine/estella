import { defineComponent, defineTag } from 'esengine';

// The one emitter that tracks the mouse and whose preset the player switches.
export const Follow = defineTag('Follow');

// A one-shot firework emitter spawned on click. `age` gates the getAliveCount
// despawn check so it isn't removed on the first frame, before it has emitted.
export const Burst = defineComponent('Burst', {
    age: 0,
});
