import { defineSystem, Query, Mut, Res, Time, Input, Transform } from 'esengine';
import { Player } from '../components';
import { WALK_HALF_W, WALK_HALF_H, DEPTH_FORESHORTEN } from '../config';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const playerMoveSystem = defineSystem(
    [Query(Mut(Transform), Player), Res(Input), Res(Time)],
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
            const step = (player.speed * time.delta) / len;
            const p = transform.position;
            p.x = clamp(p.x + dx * step, -WALK_HALF_W, WALK_HALF_W);
            p.y = clamp(p.y + dy * step * DEPTH_FORESHORTEN, -WALK_HALF_H, WALK_HALF_H);
        }
    },
    { name: 'PlayerMoveSystem' },
);
