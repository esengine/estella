import { defineComponent } from 'esengine';

// The project's declaration entry: user component/tag definitions only, no
// systems. The editor extracts schemas from here so the inspector knows their
// fields without running project code.

/** Lyra. `speed` is world units per second on the ground plane. */
export const Player = defineComponent('Player', {
    speed: 380,
});
