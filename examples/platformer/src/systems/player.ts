import {
    defineSystem, Query, Mut, Res, Time, Input,
    CharacterController,
} from 'esengine';
import { Player } from '../components';

const GRAVITY = -1600;

export const playerSystem = defineSystem(
    [Query(Mut(CharacterController), Player), Res(Time), Res(Input)],
    (players, time, input) => {
        for (const [_entity, cc, player] of players) {
            let moveX = 0;
            if (input.isKeyDown('ArrowLeft') || input.isKeyDown('KeyA')) moveX -= 1;
            if (input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD')) moveX += 1;
            cc.velocity.x = moveX * player.speed;

            cc.velocity.y += GRAVITY * time.fixedDelta;

            const jump = input.isKeyPressed('Space')
                || input.isKeyPressed('ArrowUp')
                || input.isKeyPressed('KeyW');
            if (cc.isOnFloor && jump) cc.velocity.y = player.jumpForce;
        }
    },
    { name: 'PlayerSystem' }
);
