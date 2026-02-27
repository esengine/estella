import {
    defineSystem, Query, Mut, Res, Commands,
    Transform, Time,
} from 'esengine';
import { Explosion, Star, Bullet, Enemy } from '../components';
import { HALF_HEIGHT, HALF_WIDTH, DESTROY_Y, SPAWN_Y } from '../resources';

export const bulletMoveSystem = defineSystem(
    [Res(Time), Query(Mut(Transform), Bullet)],
    (time, query) => {
        const dt = time.delta;

        for (const [_entity, transform, bullet] of query) {
            const dir = bullet.fromPlayer ? 1 : -1;
            transform.position.y += bullet.speed * dt * dir;
        }
    },
    { name: 'BulletMoveSystem' }
);

export const explosionSystem = defineSystem(
    [Res(Time), Commands(), Query(Mut(Transform), Mut(Explosion))],
    (time, cmds, query) => {
        const dt = time.delta;

        for (const [entity, transform, explosion] of query) {
            explosion.timer -= dt;

            const progress = 1 - explosion.timer / 0.3;
            const scale = 0.5 + progress * 1.0;
            transform.scale = { x: scale, y: scale, z: 1 };

            if (explosion.timer <= 0) {
                cmds.despawn(entity);
            }
        }
    },
    { name: 'ExplosionSystem' }
);

export const starScrollSystem = defineSystem(
    [Res(Time), Query(Mut(Transform), Star)],
    (time, query) => {
        const dt = time.delta;

        for (const [_entity, transform, star] of query) {
            transform.position.y -= star.speed * dt;

            if (transform.position.y < -HALF_HEIGHT - 10) {
                transform.position.y = HALF_HEIGHT + 10;
                transform.position.x = (Math.random() - 0.5) * HALF_WIDTH * 2;
            }
        }
    },
    { name: 'StarScrollSystem' }
);

export const boundarySystem = defineSystem(
    [Commands(), Query(Transform, Bullet), Query(Transform, Enemy)],
    (cmds, bulletQuery, enemyQuery) => {
        for (const [entity, transform] of bulletQuery) {
            if (transform.position.y > SPAWN_Y || transform.position.y < DESTROY_Y) {
                cmds.despawn(entity);
            }
        }

        for (const [entity, transform] of enemyQuery) {
            if (transform.position.y < DESTROY_Y) {
                cmds.despawn(entity);
            }
        }
    },
    { name: 'BoundarySystem' }
);
