import {
    defineSystem, Query, Mut, Res, ResMut,
    Transform, Input, Time, Prefabs,
} from 'esengine';
import { Player } from '../components';
import {
    GameState, HALF_WIDTH, PLAYER_SIZE, SHOOT_COOLDOWN,
    PREFAB_PLAYER_BULLET, positionOverride,
} from '../resources';

export const playerMoveSystem = defineSystem(
    [Res(Input), Res(Time), Res(GameState), Query(Mut(Transform), Player)],
    (input, time, state, query) => {
        if (state.gameOver) return;
        const dt = time.delta;

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

            transform.position.x += dx * player.speed * dt;
            transform.position.y += dy * player.speed * dt;

            const bound = HALF_WIDTH - PLAYER_SIZE / 2;
            transform.position.x = Math.max(-bound, Math.min(bound, transform.position.x));
            transform.position.y = Math.max(-500, Math.min(-300, transform.position.y));
        }
    },
    { name: 'PlayerMoveSystem' }
);

export const playerShootSystem = defineSystem(
    [Res(Input), Res(Time), ResMut(GameState), Res(Prefabs), Query(Transform, Player)],
    (input, time, stateMut, prefabServer, query) => {
        const state = stateMut.get();
        if (state.gameOver) return;

        state.shootCooldown -= time.delta;

        if (input.isKeyDown('Space') && state.shootCooldown <= 0) {
            for (const [_entity, transform] of query) {
                prefabServer.instantiate(PREFAB_PLAYER_BULLET, {
                    overrides: [
                        positionOverride(
                            transform.position.x,
                            transform.position.y + PLAYER_SIZE / 2 + 4,
                        ),
                    ],
                });
            }
            state.shootCooldown = SHOOT_COOLDOWN;
        }
    },
    { name: 'PlayerShootSystem' }
);
