import {
    defineSystem, Query, Mut, Res, Time, Input, Transform,
} from 'esengine';
import { PlayerControl } from '../components';

export const keyboardMoveSystem = defineSystem(
    [Query(Mut(Transform), PlayerControl), Res(Input), Res(Time)],
    (query, input, time) => {
        for (const [_entity, transform, player] of query) {
            let dx = 0;
            let dy = 0;

            if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dy += 1;
            if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dy -= 1;
            if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx -= 1;
            if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx += 1;

            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx * dx + dy * dy);
                transform.position.x += (dx / len) * player.speed * time.delta;
                transform.position.y += (dy / len) * player.speed * time.delta;
            }

            const scale = input.isKeyDown('Space') ? 1.5 : 1;
            transform.scale = { x: scale, y: scale, z: 1 };
        }
    },
    { name: 'KeyboardMoveSystem' }
);
