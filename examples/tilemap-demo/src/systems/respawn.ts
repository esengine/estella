import {
    defineSystem, Query, Mut, Transform, CharacterController,
} from 'esengine';
import { Player } from '../components';

// World is y-down here (the map spans y ∈ [0, -324]); anything past this has
// fallen through the water pit and off the bottom of the screen.
const DEATH_Y = -360;

// Each player's entry point, captured on the first frame it's seen — so respawn
// works in any scene without hard-coded coordinates.
const homes = new Map<number, { x: number; y: number }>();

export const respawnSystem = defineSystem(
    [Query(Mut(Transform), Mut(CharacterController), Player)],
    (players) => {
        for (const [entity, tf, cc] of players) {
            let home = homes.get(entity);
            if (!home) {
                home = { x: tf.position.x, y: tf.position.y };
                homes.set(entity, home);
            }
            if (tf.position.y < DEATH_Y) {
                tf.position.x = home.x;
                tf.position.y = home.y;
                cc.velocity.x = 0;
                cc.velocity.y = 0;
            }
        }
    },
    { name: 'RespawnSystem' },
);
