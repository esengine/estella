import {
    defineSystem, Query, Mut, Res,
    Transform, Input, Time,
} from 'esengine';
import { Player } from '../components';

const X_BOUND = 380;
const Y_MIN = -280;
const Y_MAX = 60;

export const moveSystem = defineSystem(
    [Res(Input), Res(Time), Query(Mut(Transform), Player)],
    (input, time, query) => {
        for (const [_entity, transform, player] of query) {
            let dx = 0;
            let dy = 0;

            if (input.isKeyDown('ArrowLeft') || input.isKeyDown('KeyA')) dx -= 1;
            if (input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD')) dx += 1;
            if (input.isKeyDown('ArrowUp') || input.isKeyDown('KeyW')) dy += 1;
            if (input.isKeyDown('ArrowDown') || input.isKeyDown('KeyS')) dy -= 1;

            if (dx !== 0 && dy !== 0) {
                const inv = 1 / Math.SQRT2;
                dx *= inv;
                dy *= inv;
            }

            transform.position.x += dx * player.speed * time.delta;
            transform.position.y += dy * player.speed * time.delta;

            transform.position.x = Math.max(-X_BOUND, Math.min(X_BOUND, transform.position.x));
            transform.position.y = Math.max(Y_MIN, Math.min(Y_MAX, transform.position.y));
        }
    },
    { name: 'MoveSystem' }
);
