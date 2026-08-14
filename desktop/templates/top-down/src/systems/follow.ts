import {
    defineSystem, Query, Mut, Res, Time,
    Transform, Camera,
} from 'esengine';
import { Player } from '../components';

/** How fast the camera closes the gap, per second. */
const FOLLOW = 6;

/**
 * The camera eases toward the player rather than snapping to it: a camera that
 * is exactly on the player makes every step look like the world jerking.
 */
export const followSystem = defineSystem(
    [Query(Mut(Transform), Camera), Query(Transform, Player), Res(Time)],
    (cameras, players, time) => {
        const target = [...players][0];
        if (!target) return;
        const [, to] = target;
        const k = Math.min(1, FOLLOW * time.delta);
        for (const [, camera] of cameras) {
            camera.position.x += (to.position.x - camera.position.x) * k;
            camera.position.y += (to.position.y - camera.position.y) * k;
        }
    },
    { name: 'FollowSystem' },
);
