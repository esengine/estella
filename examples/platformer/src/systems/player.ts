import {
    defineSystem, Query, Mut, Res, Time, Transform, Input,
} from 'esengine';
import { Player, Platform } from '../components';

const GRAVITY = -1200;
const PLAYER_HALF_W = 16;
const PLAYER_HALF_H = 24;

export const playerSystem = defineSystem(
    [Query([Mut(Transform), Mut(Player)]), Query([Transform, Platform]), Res(Time), Res(Input)],
    (players, platforms, time, input) => {
        for (const [_entity, transform, player] of players) {
            let moveX = 0;
            if (input.isKeyDown('ArrowLeft') || input.isKeyDown('KeyA')) {
                moveX = -1;
            }
            if (input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD')) {
                moveX = 1;
            }

            transform.position.x += moveX * player.speed * time.delta;

            player.velocityY += GRAVITY * time.delta;
            transform.position.y += player.velocityY * time.delta;

            player.isGrounded = false;

            for (const [_e, platTransform, plat] of platforms) {
                const px = platTransform.position.x;
                const py = platTransform.position.y;
                const platHalfW = plat.width / 2;
                const platHalfH = plat.height / 2;

                const overlapX = Math.abs(transform.position.x - px) < platHalfW + PLAYER_HALF_W;
                const playerBottom = transform.position.y - PLAYER_HALF_H;
                const platTop = py + platHalfH;

                if (overlapX && playerBottom < platTop && playerBottom > py - platHalfH && player.velocityY <= 0) {
                    transform.position.y = platTop + PLAYER_HALF_H;
                    player.velocityY = 0;
                    player.isGrounded = true;
                }
            }

            if (player.isGrounded && (input.isKeyPressed('Space') || input.isKeyPressed('ArrowUp') || input.isKeyPressed('KeyW'))) {
                player.velocityY = player.jumpForce;
            }

            const BOUNDARY = 400;
            if (transform.position.x < -BOUNDARY) transform.position.x = -BOUNDARY;
            if (transform.position.x > BOUNDARY) transform.position.x = BOUNDARY;
            if (transform.position.y < -300) {
                transform.position.y = -200;
                transform.position.x = -200;
                player.velocityY = 0;
            }
        }
    },
    { name: 'PlayerSystem' }
);
