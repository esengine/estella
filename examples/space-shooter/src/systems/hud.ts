import {
    defineSystem, Query, Mut, Res, ResMut, Commands,
    Input, Text, Image, Transform,
} from 'esengine';
import { Player, Health, ScoreDisplay, HealthHeart, GameOverScreen, Enemy, Bullet, Explosion } from '../components';
import { GameState, PLAYER_START_Y } from '../resources';

export const hudSystem = defineSystem(
    [Res(GameState), Query(Mut(Text), ScoreDisplay), Query(Health, Player), Query(Mut(Image), HealthHeart)],
    (state, scoreQuery, playerQuery, heartQuery) => {
        for (const [_entity, text] of scoreQuery) {
            text.content = `SCORE: ${state.score}`;
        }

        for (const [_entity, health] of playerQuery) {
            let heartIndex = 0;
            for (const [_hEntity, image] of heartQuery) {
                image.color = heartIndex < health.value
                    ? { r: 1, g: 1, b: 1, a: 1 }
                    : { r: 0.3, g: 0.3, b: 0.3, a: 0.4 };
                heartIndex++;
            }
        }
    },
    { name: 'HUDSystem' }
);

export const gameOverSystem = defineSystem(
    [
        Res(Input), ResMut(GameState), Commands(),
        Query(Mut(Transform), Mut(Health), Player),
        Query(Mut(Text), GameOverScreen),
        Query(Enemy),
        Query(Bullet),
        Query(Explosion),
    ],
    (input, stateMut, cmds, playerQuery, gameOverQuery, enemyQuery, bulletQuery, explosionQuery) => {
        const state = stateMut.get();

        for (const [_entity, _transform, health] of playerQuery) {
            if (health.value <= 0 && !state.gameOver) {
                state.gameOver = true;

                for (const [_goEntity, text] of gameOverQuery) {
                    text.content = `GAME OVER\nSCORE: ${state.score}\nPress R to restart`;
                }
            }
        }

        if (state.gameOver && input.isKeyPressed('KeyR')) {
            state.score = 0;
            state.gameOver = false;
            state.spawnTimer = 0;
            state.difficulty = 1;
            state.shootCooldown = 0;

            for (const [_entity, transform, health] of playerQuery) {
                health.value = health.maxValue;
                transform.position.x = 0;
                transform.position.y = PLAYER_START_Y;
            }

            for (const [_goEntity, text] of gameOverQuery) {
                text.content = '';
            }

            for (const [entity] of enemyQuery) {
                cmds.despawn(entity);
            }
            for (const [entity] of bulletQuery) {
                cmds.despawn(entity);
            }
            for (const [entity] of explosionQuery) {
                cmds.despawn(entity);
            }
        }
    },
    { name: 'GameOverSystem' }
);
