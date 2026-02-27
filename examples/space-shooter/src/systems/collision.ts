import {
    defineSystem, Query, Mut, ResMut, Res, Commands,
    Transform, Prefabs, type Entity,
} from 'esengine';
import { Bullet, Enemy, Player, Health } from '../components';
import {
    GameState, PREFAB_EXPLOSION, positionOverride,
    ENEMY_A_SIZE, ENEMY_B_SIZE, PLAYER_SIZE,
    BULLET_PLAYER_W, BULLET_PLAYER_H,
    BULLET_ENEMY_W, BULLET_ENEMY_H,
} from '../resources';

function aabb(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
): boolean {
    return Math.abs(ax - bx) < (aw + bw) / 2
        && Math.abs(ay - by) < (ah + bh) / 2;
}

export const collisionSystem = defineSystem(
    [
        Commands(),
        ResMut(GameState),
        Res(Prefabs),
        Query(Transform, Bullet),
        Query(Transform, Enemy),
        Query(Transform, Mut(Health), Player),
    ],
    (cmds, stateMut, prefabServer, bulletQuery, enemyQuery, playerQuery) => {
        const state = stateMut.get();
        if (state.gameOver) return;

        const destroyed = new Set<Entity>();

        for (const [bulletEntity, bulletTf, bullet] of bulletQuery) {
            if (!bullet.fromPlayer) continue;
            if (destroyed.has(bulletEntity)) continue;

            for (const [enemyEntity, enemyTf, enemy] of enemyQuery) {
                if (destroyed.has(enemyEntity)) continue;

                const enemySize = enemy.type === 'B' ? ENEMY_B_SIZE : ENEMY_A_SIZE;

                if (aabb(
                    bulletTf.position.x, bulletTf.position.y,
                    BULLET_PLAYER_W, BULLET_PLAYER_H,
                    enemyTf.position.x, enemyTf.position.y,
                    enemySize, enemySize,
                )) {
                    cmds.despawn(bulletEntity);
                    cmds.despawn(enemyEntity);
                    destroyed.add(bulletEntity);
                    destroyed.add(enemyEntity);

                    state.score += enemy.type === 'B' ? 20 : 10;

                    prefabServer.instantiate(PREFAB_EXPLOSION, {
                        overrides: [
                            positionOverride(enemyTf.position.x, enemyTf.position.y),
                        ],
                    });
                    break;
                }
            }
        }

        for (const [bulletEntity, bulletTf, bullet] of bulletQuery) {
            if (bullet.fromPlayer) continue;
            if (destroyed.has(bulletEntity)) continue;

            for (const [_playerEntity, playerTf, health] of playerQuery) {
                if (aabb(
                    bulletTf.position.x, bulletTf.position.y,
                    BULLET_ENEMY_W, BULLET_ENEMY_H,
                    playerTf.position.x, playerTf.position.y,
                    PLAYER_SIZE * 0.6, PLAYER_SIZE * 0.6,
                )) {
                    cmds.despawn(bulletEntity);
                    destroyed.add(bulletEntity);
                    health.value -= 1;

                    prefabServer.instantiate(PREFAB_EXPLOSION, {
                        overrides: [
                            positionOverride(playerTf.position.x, playerTf.position.y),
                        ],
                    });
                    break;
                }
            }
        }
    },
    { name: 'CollisionSystem' }
);
