import {
    defineSystem, Query, Mut, Res, Time, Input, Transform,
} from 'esengine';
import { PlayerControl } from './components';

export const keyboardMoveSystem = defineSystem(
    [Query(Mut(Transform), PlayerControl), Res(Input), Res(Time)],
    (query, input, time) => {
        for (const [, transform, player] of query) {
            let dx = 0;
            let dy = 0;
            if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dy += 1;
            if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dy -= 1;
            if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx -= 1;
            if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx += 1;
            if (dx === 0 && dy === 0) continue;
            const len = Math.sqrt(dx * dx + dy * dy);
            transform.position.x += (dx / len) * player.speed * time.delta;
            transform.position.y += (dy / len) * player.speed * time.delta;
        }
    },
    { name: 'PlayerMoveSystem' },
);
