import { defineComponent } from 'esengine';

/**
 * A player-steered pawn. `player` is the owning connection id (0 = the host
 * player) and is AUTHORITY-side only: provisioning matches pawns to players
 * with it, and a ghost learns the same fact as `Replicated.owner`, which the
 * spawn carries as protocol identity. `speed` comes from the `pawn` archetype
 * on both ends, which is what lets client prediction run the same rule.
 */
export const Pawn = defineComponent('Pawn', {
    player: 0,
    speed: 260,
});
