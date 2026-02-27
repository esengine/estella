import {
    defineSystem, Query, Mut, Res, ResMut,
    Transform, Time, Prefabs,
} from 'esengine';
import { Enemy } from '../components';
import {
    GameState, HALF_WIDTH, SPAWN_Y,
    ENEMY_SPAWN_INTERVAL_BASE, ENEMY_SPAWN_INTERVAL_MIN, DIFFICULTY_RAMP_RATE,
    PREFAB_ENEMY_A, PREFAB_ENEMY_B, PREFAB_ENEMY_BULLET,
    positionOverride, propOverride,
} from '../resources';

export const enemySpawnSystem = defineSystem(
    [Res(Time), ResMut(GameState), Res(Prefabs)],
    (time, stateMut, prefabServer) => {
        const state = stateMut.get();
        if (state.gameOver) return;

        state.difficulty += DIFFICULTY_RAMP_RATE * time.delta;
        state.spawnTimer -= time.delta;

        if (state.spawnTimer > 0) return;

        const interval = Math.max(
            ENEMY_SPAWN_INTERVAL_MIN,
            ENEMY_SPAWN_INTERVAL_BASE / state.difficulty
        );
        state.spawnTimer = interval;

        const spawnX = (Math.random() - 0.5) * (HALF_WIDTH * 2 - 60);
        const isTypeB = Math.random() < 0.35;

        if (isTypeB) {
            prefabServer.instantiate(PREFAB_ENEMY_B, {
                overrides: [
                    positionOverride(spawnX, SPAWN_Y),
                    propOverride('Enemy', 'speed', 100 + state.difficulty * 10),
                    propOverride('Enemy', 'shootTimer', 2 + Math.random() * 2),
                    propOverride('Enemy', 'phase', Math.random() * Math.PI * 2),
                ],
            });
        } else {
            prefabServer.instantiate(PREFAB_ENEMY_A, {
                overrides: [
                    positionOverride(spawnX, SPAWN_Y),
                    propOverride('Enemy', 'speed', 120 + state.difficulty * 15),
                    propOverride('Enemy', 'shootTimer', 1.5 + Math.random() * 2),
                ],
            });
        }
    },
    { name: 'EnemySpawnSystem' }
);

export const enemyAISystem = defineSystem(
    [Res(Time), Res(GameState), Res(Prefabs), Query(Mut(Transform), Mut(Enemy))],
    (time, state, prefabServer, query) => {
        if (state.gameOver) return;
        const dt = time.delta;

        for (const [_entity, transform, enemy] of query) {
            transform.position.y -= enemy.speed * dt;

            if (enemy.type === 'B') {
                enemy.phase += dt * 3;
                transform.position.x += Math.sin(enemy.phase) * 120 * dt;
                transform.position.x = Math.max(
                    -HALF_WIDTH + 30,
                    Math.min(HALF_WIDTH - 30, transform.position.x)
                );
            }

            enemy.shootTimer -= dt;
            if (enemy.shootTimer <= 0) {
                enemy.shootTimer = 2 + Math.random() * 2;
                prefabServer.instantiate(PREFAB_ENEMY_BULLET, {
                    overrides: [
                        positionOverride(transform.position.x, transform.position.y - 30),
                    ],
                });
            }
        }
    },
    { name: 'EnemyAISystem' }
);
