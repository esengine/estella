import { defineComponent } from 'esengine';

/**
 * A player-steered pawn. `player` is the owning connection id (0 = the host
 * player). The pawn's pose replicates through Transform's built-in `replicated`
 * annotation; `player` rides the spawn payload, so ghosts know who they are.
 */
export const Pawn = defineComponent('Pawn', {
    player: 0,
    speed: 260,
});
