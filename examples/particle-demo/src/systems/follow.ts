import {
    defineSystem, Query, Mut, Res, Transform, UICameraInfo,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { Follow } from '../components';

// Pin the follow emitter to the world-space cursor. Because it simulates in
// World space, particles stay where they were born and streak out behind the
// moving cursor.
export const followSystem = defineSystem(
    [Query(Mut(Transform), Follow), Res(UICameraInfo)],
    (follows, camera: UICameraData) => {
        if (!camera.valid) return;
        for (const [, transform] of follows) {
            transform.position.x = camera.worldMouseX;
            transform.position.y = camera.worldMouseY;
        }
    },
    { name: 'FollowSystem' },
);
