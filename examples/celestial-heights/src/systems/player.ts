import {
    defineSystem, Query, Mut, Res, Input, CharacterController,
} from 'esengine';
import { Player, Facing, MeleeAttack } from '../components';
import { DEPTH_FORESHORTEN } from '../config';

/**
 * Writes the desired velocity and lets the engine's character controller do the
 * moving — it collides the capsule and resolves the slide, so walls are the
 * physics world's business and not this system's.
 */
export const playerMoveSystem = defineSystem(
    [Query(Mut(CharacterController), Mut(Facing), Player), Res(Input)],
    (players, input) => {
        for (const [, cc, facing, player] of players) {
            let dx = 0;
            let dy = 0;
            if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dy += 1;
            if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dy -= 1;
            if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx -= 1;
            if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx += 1;

            if (dx === 0 && dy === 0) {
                cc.velocity.x = 0;
                cc.velocity.y = 0;
                continue;
            }
            const len = Math.hypot(dx, dy);
            cc.velocity.x = (dx / len) * player.speed;
            cc.velocity.y = (dy / len) * player.speed * DEPTH_FORESHORTEN;
            // Facing follows input rather than resolved motion, so sliding along
            // a wall does not turn Lyra to face it.
            facing.x = dx / len;
            facing.y = dy / len;
        }
    },
    { name: 'PlayerMoveSystem' },
);

/** Turns the attack key into the same `pending` flag the wisps' brain sets. */
export const playerAttackSystem = defineSystem(
    [Query(Mut(MeleeAttack), Player), Res(Input)],
    (players, input) => {
        if (!input.isKeyPressed('Space')) return;
        for (const [, attack] of players) attack.pending = true;
    },
    { name: 'PlayerAttackSystem' },
);
