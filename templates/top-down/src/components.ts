import { defineComponent } from 'esengine';

/** The one entity the input drives. `speed` is world units per second. */
export const Player = defineComponent('Player', {
    speed: 260,
});
