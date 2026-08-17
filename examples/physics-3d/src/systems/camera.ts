import {
    defineSystem, Query, Mut, Res, Time, Transform, Camera, CharacterController3D,
} from 'esengine';

const OFFSET = { x: 0, y: 300, z: 700 };
/** Fraction of the remaining distance closed per second — a lag the eye reads as
 *  weight rather than as the camera being late. */
const CATCH_UP = 4;

export const cameraFollowSystem = defineSystem(
    [Query(Mut(Transform), Camera), Query(Transform, CharacterController3D), Res(Time)],
    (cameras, heroes, time) => {
        let target: { x: number; y: number; z: number } | null = null;
        for (const [, transform] of heroes) {
            target = transform.position;
            break;
        }
        if (!target) return;

        const t = Math.min(1, CATCH_UP * time.delta);
        for (const [, transform] of cameras) {
            const p = transform.position;
            p.x += (target.x + OFFSET.x - p.x) * t;
            p.y += (target.y + OFFSET.y - p.y) * t;
            p.z += (target.z + OFFSET.z - p.z) * t;
        }
    },
    { name: 'CameraFollowSystem' },
);
