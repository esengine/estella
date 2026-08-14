import {
    defineSystem, Query, Mut, Res, Input,
    CharacterController,
} from 'esengine';
import { Player } from '../components';

/**
 * Eight-way movement. The diagonal is normalised, or holding two keys would be
 * ~1.4× faster than holding one — the oldest bug in top-down movement.
 */
export const moveSystem = defineSystem(
    [Query(Mut(CharacterController), Player), Res(Input)],
    (players, input) => {
        let x = 0;
        let y = 0;
        if (input.isKeyDown('ArrowLeft') || input.isKeyDown('KeyA')) x -= 1;
        if (input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD')) x += 1;
        if (input.isKeyDown('ArrowDown') || input.isKeyDown('KeyS')) y -= 1;
        if (input.isKeyDown('ArrowUp') || input.isKeyDown('KeyW')) y += 1;
        const length = Math.hypot(x, y);
        for (const [, cc, player] of players) {
            cc.velocity.x = length === 0 ? 0 : (x / length) * player.speed;
            cc.velocity.y = length === 0 ? 0 : (y / length) * player.speed;
        }
    },
    { name: 'MoveSystem' },
);
